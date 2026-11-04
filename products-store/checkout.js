(function () {
  const container = document.getElementById("paypal-button-container");
  const status = document.getElementById("paypal-status");
  if (!container) return;

  const slug = container.dataset.productSlug;
  const say = (message) => {
    if (status) {
      status.textContent = message;
      status.style.whiteSpace = "pre-wrap";
      status.style.overflowWrap = "anywhere";
    }
  };

  const errorText = (error) => {
    if (!error) return "No error details were provided by PayPal.";
    const parts = [];
    if (error.name) parts.push("Type: " + String(error.name));
    if (error.code) parts.push("Code: " + String(error.code));
    if (error.debug_id) parts.push("PayPal debug ID: " + String(error.debug_id));
    if (error.message) parts.push("Message: " + String(error.message));
    if (Array.isArray(error.details)) {
      for (const detail of error.details.slice(0, 3)) {
        if (detail && detail.description) parts.push("Detail: " + String(detail.description));
        if (detail && detail.issue) parts.push("Issue: " + String(detail.issue));
      }
    }
    return parts.length ? parts.join("\\n") : String(error);
  };

  const readJsonResponse = async (response, stage) => {
    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(stage + " returned HTTP " + response.status + " but not valid JSON.");
    }
    if (!response.ok) {
      const reason = data.error || data.message || data.details || response.statusText;
      throw new Error(stage + " failed (HTTP " + response.status + "): " + String(reason || "Unknown server error"));
    }
    return data;
  };

  const loadPayPalSdk = (clientId) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const sdkUrl = new URL("https://www.paypal.com/sdk/js");
    sdkUrl.searchParams.set("client-id", clientId);
    sdkUrl.searchParams.set("currency", "USD");
    sdkUrl.searchParams.set("intent", "capture");
    sdkUrl.searchParams.set("components", "buttons");

    script.src = sdkUrl.toString();
    script.async = true;
    script.onload = () => {
      if (window.paypal && typeof window.paypal.Buttons === "function") {
        resolve(window.paypal);
      } else {
        reject(new Error("PayPal SDK loaded, but the Buttons component is unavailable."));
      }
    };
    script.onerror = () => reject(new Error("The browser could not download the PayPal SDK from www.paypal.com."));
    document.head.appendChild(script);
  });

  async function startCheckout() {
    try {
      say("Connecting securely to PayPal…");
      const configResponse = await fetch("/api/paypal/config", { cache: "no-store" });
      const config = await readJsonResponse(configResponse, "PayPal configuration");
      if (!config.enabled || !config.clientId) {
        say("PayPal is not configured yet. Please check the store settings.");
        return;
      }

      // Remove accidental line breaks or spaces introduced when a credential
      // is copied into an environment variable. Do not alter any other characters.
      const clientId = String(config.clientId).replace(/\s+/g, "");
      if (!clientId) {
        say("PayPal is temporarily unavailable because its Client ID is empty.");
        return;
      }

      const paypal = await loadPayPalSdk(clientId);
      say("Preparing the secure PayPal checkout…");

      const buttons = paypal.Buttons({
        style: {
          layout: "vertical",
          color: "gold",
          shape: "rect",
          label: "paypal"
        },
        onClick: function () {
          say("PayPal button clicked. Waiting for the secure PayPal window…");
        },
        createOrder: async function () {
          say("Preparing your secure PayPal order…");
          const response = await fetch("/api/paypal/create-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug })
          });
          const data = await readJsonResponse(response, "Create PayPal order");
          if (!data.id) {
            throw new Error("Create PayPal order succeeded but the server returned no order ID.");
          }
          return data.id;
        },
        onApprove: async function (data) {
          say("Confirming your payment with PayPal…");
          const response = await fetch("/api/paypal/capture-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderID: data.orderID })
          });
          const result = await readJsonResponse(response, "Capture PayPal payment");
          if (!result.ok || !result.downloadUrl) {
            throw new Error(result.error || "PayPal did not confirm this payment or no download URL was returned.");
          }

          say("Payment confirmed. Your download is ready.");
          const link = document.createElement("a");
          link.href = result.downloadUrl;
          link.className = "button";
          link.textContent = "Download your purchase";
          link.style.display = "inline-block";
          link.style.marginTop = "12px";
          container.replaceChildren(link);
        },
        onCancel: function () {
          say("Payment cancelled. No charge was completed.");
        },
        onError: function (error) {
          console.error("PayPal checkout error", error);
          say("PAYPAL ERROR\\n" + errorText(error));
        }
      });

      await buttons.render("#paypal-button-container");
      say("Choose PayPal to continue with secure checkout.");
    } catch (error) {
      console.error("PayPal checkout initialization failed", error);
      say("CHECKOUT INITIALIZATION ERROR\\n" + errorText(error));
      if (String(error.message || "").includes("download the PayPal SDK")) {
        say("PayPal SDK load failed. Check whether this browser or network blocks www.paypal.com.\\n" + errorText(error));
      } else {
        say(error.message || "Checkout is temporarily unavailable. Please refresh the page.");
      }
    }
  }

  startCheckout();
})();
