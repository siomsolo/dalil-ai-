import {supabaseDB} from "./supabase-db.js";
import {listPublishedSupabaseProducts} from "./supabase-products.js";

const RPC_QUERY = "SELECT id,slug,title,description,category,language,market,occasion,keywords,price,image_url,status,created_at,updated_at FROM products WHERE status='published' ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 50000";

/**
 * Read published products through the Supabase SQL RPC and Supabase REST table API.
 * One healthy source is enough; only fail when every usable source fails.
 * The REST helper returns [] when its secret is absent, so do not mistake that
 * deliberate no-op for a healthy source when the SQL RPC also failed.
 */
export async function listAllPublishedProducts(env, {limit = 50000} = {}) {
  const [rpcResult, restResult] = await Promise.allSettled([
    Promise.resolve().then(() => supabaseDB(env).prepare(RPC_QUERY).all()),
    Promise.resolve().then(() => listPublishedSupabaseProducts(env))
  ]);

  if (rpcResult.status === "rejected") {
    console.log("PUBLISHED_PRODUCTS_RPC_FAILED", String(rpcResult.reason?.message || rpcResult.reason).slice(0, 300));
  }
  if (restResult.status === "rejected") {
    console.log("PUBLISHED_PRODUCTS_REST_FAILED", String(restResult.reason?.message || restResult.reason).slice(0, 300));
  }

  const rpcProducts = rpcResult.status === "fulfilled" ? (rpcResult.value?.results || []) : [];
  const restProducts = restResult.status === "fulfilled" ? (restResult.value || []) : [];
  const hasUsableRpc = rpcResult.status === "fulfilled";
  const hasUsableRest = restResult.status === "fulfilled" && Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

  if (!hasUsableRpc && !hasUsableRest) {
    throw new Error("All published-product data sources are unavailable.");
  }

  const seen = new Set();
  const combined = [...restProducts, ...rpcProducts].filter(product => {
    const slug = String(product?.slug || "").trim();
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });

  combined.sort((a, b) => {
    const aDate = Date.parse(a.updated_at || a.created_at || "") || 0;
    const bDate = Date.parse(b.updated_at || b.created_at || "") || 0;
    return bDate - aDate;
  });

  return combined.slice(0, Math.max(0, Number(limit) || 0));
}
