import {supabaseDB} from "./_shared/supabase-db.js";
import {listPublishedSupabaseProducts} from "./_shared/supabase-products.js";

function harden(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}


const META_PIXEL_ID = "1182976757735669";
const META_PIXEL_SCRIPT = `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');</script>`;
const META_PIXEL_NOSCRIPT = `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1" alt=""></noscript>`;
const META_PRODUCT_EVENT_SCRIPT = `<script>
(function(){
  function sendProductView(){
    if(typeof window.fbq!=="function") return;
    var nodes=document.querySelectorAll('script[type="application/ld+json"]');
    for(var i=0;i<nodes.length;i++){
      try{
        var data=JSON.parse(nodes[i].textContent||"null");
        var graph=Array.isArray(data&&data["@graph"])?data["@graph"]:[data];
        var product=graph.find(function(item){return item&&item["@type"]==="Product";});
        if(!product) continue;
        var offer=Array.isArray(product.offers)?product.offers[0]:(product.offers||{});
        var id=product.sku||product.productID||product["@id"]||product.url;
        var payload={content_type:"product",content_ids:[String(id)]};
        if(product.name) payload.content_name=product.name;
        if(offer.price!==undefined&&offer.price!==null) payload.value=Number(offer.price);
        if(offer.priceCurrency) payload.currency=offer.priceCurrency;
        window.fbq("track","ViewContent",payload);
        return;
      }catch(e){}
    }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",sendProductView,{once:true});
  else sendProductView();
})();
</script>`;

async function withMetaPixel(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  if (!html.includes(META_PIXEL_ID)) {
    const headEnd = html.toLowerCase().indexOf("</head>");
    html = headEnd >= 0
      ? html.slice(0, headEnd) + META_PIXEL_SCRIPT + html.slice(headEnd)
      : META_PIXEL_SCRIPT + html;
    html = html.replace(/<body[^>]*>/i, match => match + META_PIXEL_NOSCRIPT);
  }

  if (html.includes('application/ld+json') && !html.includes('META_PRODUCT_VIEW_EVENT')) {
    const bodyEnd = html.toLowerCase().lastIndexOf("</body>");
    if (bodyEnd >= 0) html = html.slice(0, bodyEnd) + META_PRODUCT_EVENT_SCRIPT.replace("<script>", '<script id="META_PRODUCT_VIEW_EVENT">') + html.slice(bodyEnd);
  }

  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

async function finish(response) {
  return harden(await withMetaPixel(response));
}

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function renderProduct(product) {
  const slug = encodeURIComponent(String(product.slug || ""));
  const image = product.image_url
    ? `<img loading="lazy" src="${esc(product.image_url)}" alt="${esc(product.title)} cover">`
    : '<span class="placeholder">✦</span>';
  const description = String(product.description || "").slice(0, 160);

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
        <span class="price">$5.00</span>
        <span class="view">View product →</span>
      </div>
    </div>
  </a>`;
}

export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);

  if (url.pathname !== "/" || !response.ok) return finish(response);

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return finish(response);

  const fallback = response.clone();

  try {
    const sources = await Promise.allSettled([
      Promise.resolve().then(() => supabaseDB(context.env).prepare(
        "SELECT slug,title,description,category,language,price,image_url,created_at FROM products WHERE status='published' ORDER BY created_at DESC LIMIT 500"
      ).all()),
      Promise.resolve().then(() => listPublishedSupabaseProducts(context.env))
    ]);

    const d1Result = sources[0];
    const supabaseResult = sources[1];
    if (d1Result.status === "rejected") {
      console.log("HOMEPAGE_D1_PRODUCTS_FAILED", String(d1Result.reason?.message || d1Result.reason).slice(0, 250));
    }
    if (supabaseResult.status === "rejected") {
      console.log("HOMEPAGE_SUPABASE_PRODUCTS_FAILED", String(supabaseResult.reason?.message || supabaseResult.reason).slice(0, 250));
    }
    if (d1Result.status === "rejected" && supabaseResult.status === "rejected") return finish(fallback);

    const d1Products = d1Result.status === "fulfilled" ? (d1Result.value.results || []) : [];
    const supabaseProducts = supabaseResult.status === "fulfilled" ? (supabaseResult.value || []) : [];
    const seen = new Set();
    const products = [...supabaseProducts, ...d1Products].filter(product => {
      const slug = String(product.slug || "").trim();
      if (!slug || seen.has(slug)) return false;
      seen.add(slug);
      return true;
    }).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 500);

    if (!products.length) return finish(fallback);

    const html = await response.text();
    const cards = products.map(renderProduct).join("\n");
    const markerPattern = /<!-- PRODUCTS_SSR_START -->[^]*?<!-- PRODUCTS_SSR_END -->/;

    if (!markerPattern.test(html)) return finish(fallback);

    const updated = html.replace(
      markerPattern,
      `<!-- PRODUCTS_SSR_START -->${cards}<!-- PRODUCTS_SSR_END -->`
    );

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control", "public, max-age=60");
    return finish(new Response(updated, {
      status: response.status,
      statusText: response.statusText,
      headers
    }));
  } catch (error) {
    console.log("HOMEPAGE_PRODUCT_SSR_FAILED", String(error?.message || error).slice(0, 300));
    return finish(fallback);
  }
}
