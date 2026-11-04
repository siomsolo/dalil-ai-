(function () {
  const container = document.getElementById("paypal-button-container");
  const status = document.getElementById("paypal-status");
  if (!container) return;

  const slug = container.dataset.productSlug;
  const say = (message) => {
    if (status) status.textContent = message;
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
      if (!configResponse.ok) {
        throw new Error("The store could not read its PayPal configuration.");
      }

      const config = await configResponse.json();
      if (!config.enabled || !config.clientId) {
        say("PayPal Sandbox is not configured yet. Please check the store settings.");
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
        createOrder: async function () {
          say("Preparing your secure PayPal order…");
          const response = await fetch("/api/paypal/create-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug })
          });
          const data = await response.json();
          if (!response.ok || !data.id) {
            throw new Error(data.error || "Could not create the PayPal order.");
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
          const result = await response.json();
          if (!response.ok || !result.ok || !result.downloadUrl) {
            throw new Error(result.error || "PayPal did not confirm this payment.");
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
          say("PayPal checkout could not be completed. Please try again.");
        }
      });

      await buttons.render("#paypal-button-container");
      say("Choose PayPal to continue with secure checkout.");
    } catch (error) {
      console.error("PayPal checkout initialization failed", error);
      if (String(error.message || "").includes("download the PayPal SDK")) {
        say("PayPal could not be reached from this browser or network. Please open this page in Chrome, disable VPN or ad blocking temporarily, and reload.");
      } else {
        say(error.message || "Checkout is temporarily unavailable. Please refresh the page.");
      }
    }
  }

  startCheckout();
})();
