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
  if (!response.ok || !data.access_token) {
    throw new Error("PayPal authentication failed: " + (data.error_description || data.error || response.status));
  }
  return data.access_token;
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB || !env.FILES) {
    return Response.json({ error: "Store database or private file storage is not configured." }, { status: 503 });
  }
  try {
    const body = await request.json();
    const slug = String(body.slug || "").trim().slice(0, 120);
    if (!slug) return Response.json({ error: "Product is missing." }, { status: 400 });

    const product = await env.DB.prepare(
      "SELECT slug,title,price,status FROM products WHERE slug=? AND status='published'"
    ).bind(slug).first();
    if (!product) return Response.json({ error: "This product is not available." }, { status: 404 });

    const amount = Number(product.price);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
      return Response.json({ error: "The product price is invalid." }, { status: 400 });
    }

    const token = await accessToken(env);
    const response = await fetch(PAYPAL_API + "/v2/checkout/orders", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "PayPal-Request-Id": crypto.randomUUID()
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: product.slug,
          custom_id: product.slug,
          description: String(product.title).slice(0, 127),
          amount: { currency_code: "USD", value: amount.toFixed(2) }
        }],
        application_context: {
          brand_name: "DigitalNest",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW"
        }
      })
    });
    const data = await response.json();
    if (!response.ok || !data.id) {
      return Response.json({ error: data.message || "PayPal could not create the order.", details: data.details || [] }, { status: 502 });
    }

    await env.DB.prepare(
      "INSERT INTO product_orders (id,paypal_order_id,product_slug,amount,currency,status) VALUES (?,?,?,?,?,'CREATED')"
    ).bind(crypto.randomUUID(), data.id, product.slug, amount.toFixed(2), "USD").run();

    return Response.json({ id: data.id });
  } catch (error) {
    return Response.json({ error: error.message || "Could not start PayPal checkout." }, { status: 500 });
  }
}
