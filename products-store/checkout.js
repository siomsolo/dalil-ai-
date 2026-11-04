(async function () {
  const container = document.getElementById("paypal-button-container");
  const status = document.getElementById("paypal-status");
  if (!container) return;
  const slug = container.dataset.productSlug;
  const say = (message) => { if (status) status.textContent = message; };

  try {
    const configResponse = await fetch("/api/paypal/config", { cache: "no-store" });
    const config = await configResponse.json();
    if (!configResponse.ok || !config.enabled || !config.clientId) {
      say("PayPal Sandbox is not configured yet. Please check back shortly.");
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.paypal.com/sdk/js?client-id=" +
      encodeURIComponent(config.clientId) + "&currency=USD&intent=capture";
    script.async = true;
    script.onload = () => {
      if (!window.paypal) { say("PayPal checkout could not load. Please refresh."); return; }
      window.paypal.Buttons({
        style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },
        createOrder: async function () {
          say("Preparing your secure PayPal order…");
          const response = await fetch("/api/paypal/create-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug })
          });
          const data = await response.json();
          if (!response.ok || !data.id) throw new Error(data.error || "Could not create the PayPal order.");
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
        onCancel: function () { say("Payment cancelled. No charge was completed."); },
        onError: function (error) {
          console.error("PayPal checkout error", error);
          say("Checkout could not be completed. Please try again.");
        }
      }).render("#paypal-button-container");
      say("Choose PayPal to continue with secure checkout.");
    };
    script.onerror = () => say("Could not load PayPal checkout. Please check your connection and refresh.");
    document.head.appendChild(script);
  } catch (error) {
    console.error("Checkout setup error", error);
    say(error.message || "Checkout is temporarily unavailable.");
  }
})();
