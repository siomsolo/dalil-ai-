import {supabaseDB} from "./_shared/supabase-db.js";
import {listPublishedSupabaseProducts} from "./_shared/supabase-products.js";

const origin = "https://digital-products-store-4yt.pages.dev";
const MAX_URLS = 50000;

function xmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  }[char]));
}

function productUrl(slug) {
  return origin + "/product/" + encodeURIComponent(String(slug || ""));
}

export async function onRequest({env}) {
  const sourceResults = await Promise.allSettled([
    supabaseDB(env).prepare(
      "SELECT slug,updated_at,created_at FROM products WHERE status='published' ORDER BY updated_at DESC LIMIT 50000"
    ).all(),
    listPublishedSupabaseProducts(env)
  ]);

  const d1Result = sourceResults[0];
  const supabaseResult = sourceResults[1];
  const d1Products = d1Result.status === "fulfilled" ? (d1Result.value.results || []) : [];
  const supabaseProducts = supabaseResult.status === "fulfilled" ? (supabaseResult.value || []) : [];

  if (d1Result.status === "rejected") {
    console.log("SITEMAP_D1_SOURCE_FAILED", String(d1Result.reason?.message || d1Result.reason).slice(0, 300));
  }
  if (supabaseResult.status === "rejected") {
    console.log("SITEMAP_SUPABASE_SOURCE_FAILED", String(supabaseResult.reason?.message || supabaseResult.reason).slice(0, 300));
  }

  if (d1Result.status === "rejected" && supabaseResult.status === "rejected") {
    return new Response("Sitemap temporarily unavailable", {
      status: 503,
      headers: {"content-type": "text/plain;charset=UTF-8", "cache-control": "no-store"}
    });
  }

  const seen = new Set();
  const products = [...supabaseProducts, ...d1Products].filter(product => {
    const slug = String(product.slug || "").trim();
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  }).slice(0, MAX_URLS - 1);

  const urls = [
    "<url><loc>" + origin + "/</loc></url>",
    ...products.map(product => {
      const lastmodValue = product.updated_at || product.created_at;
      const lastmodDate = lastmodValue ? new Date(lastmodValue) : null;
      const lastmod = lastmodDate && Number.isFinite(lastmodDate.getTime())
        ? "<lastmod>" + lastmodDate.toISOString().slice(0, 10) + "</lastmod>"
        : "";
      return "<url><loc>" + xmlEscape(productUrl(product.slug)) + "</loc>" + lastmod + "</url>";
    })
  ];

  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.join("") +
    "</urlset>";

  return new Response(xml, {
    headers: {
      "content-type": "application/xml;charset=UTF-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "x-robots-tag": "noindex"
    }
  });
}
