import {getPublishedSupabaseProduct} from "../_shared/supabase-products.js";
function decodeBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function verifyToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC", key, decodeBase64url(parts[1]), new TextEncoder().encode(parts[0])
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64url(parts[0])));
    if (!payload.orderId || !Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.PAYPAL_CLIENT_SECRET || !env.DB || !env.FILES) {
    return new Response("Download service is not configured.", { status: 503 });
  }
  const token = new URL(request.url).searchParams.get("token") || "";
  const payload = await verifyToken(token, env.PAYPAL_CLIENT_SECRET);
  if (!payload) return new Response("This download link is invalid or has expired.", { status: 403 });

  const order = await env.DB.prepare(
    "SELECT status,product_slug FROM product_orders WHERE paypal_order_id=?"
  ).bind(payload.orderId).first();
  if (!order || order.status !== "COMPLETED") return new Response("A confirmed payment is required.", { status: 403 });
  let product=await env.DB.prepare("SELECT file_key,file_name,file_type FROM products WHERE slug=? AND status='published'").bind(order.product_slug).first();
  if(!product)product=await getPublishedSupabaseProduct(env,order.product_slug);
  if(!product)return new Response("The purchased product could not be found.",{status:404});
  const object = await env.FILES.get(product.file_key);
  if (!object) return new Response("The purchased file could not be found.", { status: 404 });

  const safeName = String(product.file_name || "digital-download").replace(/[\r\n"]/g, "").slice(0, 150);
  const headers = new Headers();
  headers.set("Content-Type", product.file_type || "application/octet-stream");
  headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(safeName));
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
