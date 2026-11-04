const PAYPAL_API = "https://api-m.paypal.com";

async function accessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal Live credentials are not configured on this deployment.");
  }
  const credentials = new TextEncoder().encode(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET);
  let binaryCredentials = "";
  for (const byte of credentials) binaryCredentials += String.fromCharCode(byte);
  const auth = btoa(binaryCredentials);
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

function amountInCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

async function paypalRequest(path, token, options = {}) {
  const response = await fetch(PAYPAL_API + path, {
    ...options,
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
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
    if (!orderId || orderId.length > 64) {
      return Response.json({ error: "PayPal order ID is required." }, { status: 400 });
    }

    const order = await env.DB.prepare(
      "SELECT paypal_order_id,product_slug,status,amount,currency FROM product_orders WHERE paypal_order_id=?"
    ).bind(orderId).first();
    if (!order) {
      return Response.json({ error: "Order was not created by this store." }, { status: 404 });
    }

    if (order.status !== "COMPLETED") {
      const token = await accessToken(env);

      // Verify the PayPal order's server-side product and amount before attempting capture.
      const orderResult = await paypalRequest(
        "/v2/checkout/orders/" + encodeURIComponent(orderId),
        token
      );
      if (!orderResult.response.ok) {
        return Response.json({ error: "Could not verify this PayPal order. Please restart checkout." }, { status: 502 });
      }

      const paypalOrder = orderResult.data;
      const paypalUnit = paypalOrder.purchase_units?.[0];
      const expectedCents = amountInCents(order.amount);
      const orderCents = amountInCents(paypalUnit?.amount?.value);
      if (
        paypalUnit?.custom_id !== order.product_slug ||
        paypalUnit?.amount?.currency_code !== order.currency ||
        !Number.isFinite(expectedCents) ||
        orderCents !== expectedCents
      ) {
        return Response.json({
          error: "The PayPal order amount or product does not match this store order. No download was released."
        }, { status: 402 });
      }

      let captureData = paypalOrder;
      if (paypalOrder.status !== "COMPLETED") {
        if (paypalOrder.status !== "APPROVED") {
          return Response.json({
            error: "PayPal has not approved this payment yet. Please complete the PayPal approval step and try again."
          }, { status: 409 });
        }

        const captureResult = await paypalRequest(
          "/v2/checkout/orders/" + encodeURIComponent(orderId) + "/capture",
          token,
          {
            method: "POST",
            headers: { "PayPal-Request-Id": "capture-" + orderId },
            body: "{}"
          }
        );
        captureData = captureResult.data;

        // If capture returned an error (for example, a retry after capture), re-read
        // PayPal's order state instead of assuming that the payment failed.
        if (!captureResult.response.ok) {
          const refreshed = await paypalRequest(
            "/v2/checkout/orders/" + encodeURIComponent(orderId),
            token
          );
          if (refreshed.response.ok && refreshed.data.status === "COMPLETED") {
            captureData = refreshed.data;
          } else {
            return Response.json({
              error: "PayPal did not confirm the capture. Check your PayPal activity and restart checkout if it remains unpaid."
            }, { status: 502 });
          }
        }
      }

      const capturedUnit = captureData.purchase_units?.[0];
      const captures = capturedUnit?.payments?.captures || [];
      const capture = captures.find(item =>
        item.status === "COMPLETED" &&
        item.amount?.currency_code === order.currency &&
        amountInCents(item.amount?.value) === expectedCents
      );

      if (captureData.status !== "COMPLETED" || !capture) {
        return Response.json({
          error: "PayPal has not confirmed a completed capture for the expected amount. The download remains locked."
        }, { status: 402 });
      }

      await env.DB.prepare(
        "UPDATE product_orders SET status='COMPLETED',capture_id=?,paid_at=CURRENT_TIMESTAMP WHERE paypal_order_id=?"
      ).bind(capture.id || null, orderId).run();
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
