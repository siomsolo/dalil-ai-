export async function onRequestGet({ env }) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return Response.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    { enabled: true, clientId: env.PAYPAL_CLIENT_ID, currency: "USD" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
