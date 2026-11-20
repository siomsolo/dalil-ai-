import {supabaseDB} from "./supabase-db.js";
import {listPublishedSupabaseProducts} from "./supabase-products.js";

const D1_QUERY = "SELECT id,slug,title,description,category,language,market,occasion,keywords,price,image_url,status,created_at,updated_at FROM products WHERE status='published' ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 50000";

/**
 * Read published products from both configured stores.
 * One healthy source is enough; only fail when every usable source fails.
 * Supabase REST returns [] when its secret is absent, so do not mistake that
 * deliberate no-op for a healthy source when the D1 RPC also failed.
 */
export async function listAllPublishedProducts(env, {limit = 50000} = {}) {
  const [d1Result, supabaseResult] = await Promise.allSettled([
    Promise.resolve().then(() => supabaseDB(env).prepare(D1_QUERY).all()),
    Promise.resolve().then(() => listPublishedSupabaseProducts(env))
  ]);

  if (d1Result.status === "rejected") {
    console.log("PUBLISHED_PRODUCTS_D1_FAILED", String(d1Result.reason?.message || d1Result.reason).slice(0, 300));
  }
  if (supabaseResult.status === "rejected") {
    console.log("PUBLISHED_PRODUCTS_SUPABASE_FAILED", String(supabaseResult.reason?.message || supabaseResult.reason).slice(0, 300));
  }

  const d1Products = d1Result.status === "fulfilled" ? (d1Result.value?.results || []) : [];
  const supabaseProducts = supabaseResult.status === "fulfilled" ? (supabaseResult.value || []) : [];
  const hasUsableD1 = d1Result.status === "fulfilled";
  const hasUsableSupabase = supabaseResult.status === "fulfilled" && Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

  if (!hasUsableD1 && !hasUsableSupabase) {
    throw new Error("All published-product data sources are unavailable.");
  }

  const seen = new Set();
  const combined = [...supabaseProducts, ...d1Products].filter(product => {
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
