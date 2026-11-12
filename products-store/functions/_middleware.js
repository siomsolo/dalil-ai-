function harden(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

import {supabaseDB} from "./_shared/supabase-db.js";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[char]));

function renderProduct(product) {
  const slug = encodeURIComponent(product.slug);
  const image = product.image_url
    ? `<img loading="lazy" src="${esc(product.image_url)}" alt="${esc(product.title)} cover">`
    : '<span class="placeholder">✦</span>';
  const description = String(product.description || "").slice(0, 160);
  const priceValue = Number(product.price);
  const price = Number.isFinite(priceValue) ? priceValue.toFixed(2) : "";

  return `<a class="product-card" data-product-slug="${esc(product.slug)}" href="/product/${slug}">
    <div class="cover">${image}</div>
    <div class="product-info">
      <div class="tags">
        <span class="tag">${esc(product.category || "Digital resource")}</span>
        <span class="tag">${esc(product.language || "English")}</span>
      </div>
      <h3>${esc(product.title)}</h3>
      <p>${esc(description)}</p>
      <div class="price-row">
        <span class="price">${price ? "$ " + price : ""}</span>
        <span class="view">View product →</span>
      </div>
    </div>
  </a>`;
}

export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);

  if (url.pathname !== "/" || !response.ok) return harden(response);

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return harden(response);

  const fallback = response.clone();

  try {
    const { results = [] } = await supabaseDB(context.env).prepare(
      "SELECT slug,title,description,category,language,price,image_url FROM products WHERE status='published' ORDER BY created_at DESC LIMIT 500"
    ).all();

    if (!results.length) return harden(response);

    const html = await response.text();
    const cards = results.map(renderProduct).join("\n");
    const markerPattern = /<!-- PRODUCTS_SSR_START -->[^]*?<!-- PRODUCTS_SSR_END -->/;

    if (!markerPattern.test(html)) return harden(fallback);

    const updated = html.replace(
      markerPattern,
      `<!-- PRODUCTS_SSR_START -->${cards}<!-- PRODUCTS_SSR_END -->`
    );

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control", "public, max-age=60");
    return harden(new Response(updated, {
      status: response.status,
      statusText: response.statusText,
      headers
    }));
  } catch (error) {
    return harden(fallback);
  }
}
