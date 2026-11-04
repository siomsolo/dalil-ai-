const PAYPAL_API = "https://api-m.sandbox.paypal.com";

async function accessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal Sandbox credentials are not configured on this deployment.");
  }
  const auth = btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET);
  const response = await fetch(PAYPAL_API + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + auth,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("PayPal authentication failed.");
  return data.access_token;
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function makeDownloadToken(orderId, env) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    orderId,
    exp: Math.floor(Date.now() / 1000) + 48 * 60 * 60
  })));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.PAYPAL_CLIENT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return payload + "." + base64url(new Uint8Array(signature));
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const orderId = String(body.orderID || "").trim();
    if (!orderId || orderId.length > 64) return Response.json({ error: "PayPal order ID is required." }, { status: 400 });

    const order = await env.DB.prepare(
      "SELECT paypal_order_id,product_slug,status,amount,currency FROM product_orders WHERE paypal_order_id=?"
    ).bind(orderId).first();
    if (!order) return Response.json({ error: "Order was not created by this store." }, { status: 404 });

    if (order.status !== "COMPLETED") {
      const token = await accessToken(env);
      const response = await fetch(PAYPAL_API + "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "PayPal-Request-Id": "capture-" + orderId
        },
        body: "{}"
      });
      const data = await response.json();
      const unit = data.purchase_units?.[0];
      const capture = unit?.payments?.captures?.[0];
      const paidAmount = capture?.amount;
      const customId = unit?.custom_id;
      if (!response.ok || data.status !== "COMPLETED" || capture?.status !== "COMPLETED" ||
          customId !== order.product_slug ||
          paidAmount?.currency_code !== order.currency ||
          paidAmount?.value !== Number(order.amount).toFixed(2)) {
        return Response.json({ error: "PayPal payment details did not match this order. The download has not been released." }, { status: 402 });
      }
      const captureId = capture.id || null;
      await env.DB.prepare(
        "UPDATE product_orders SET status='COMPLETED',capture_id=?,paid_at=CURRENT_TIMESTAMP WHERE paypal_order_id=?"
      ).bind(captureId, orderId).run();
    }

    const downloadToken = await makeDownloadToken(orderId, env);
    return Response.json({
      ok: true,
      status: "COMPLETED",
      downloadUrl: "/api/download?token=" + encodeURIComponent(downloadToken),
      expiresInHours: 48
    });
  } catch (error) {
    return Response.json({ error: error.message || "Could not confirm the PayPal payment." }, { status: 500 });
  }
}
