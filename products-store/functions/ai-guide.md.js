import {supabaseDB} from "./_shared/supabase-db.js";
const origin = "https://digital-products-store-4yt.pages.dev";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function onRequest({ env }) {
  try {
    const { results = [] } = await supabaseDB(env).prepare(
      "SELECT slug,title,description,category,language,market,price FROM products WHERE status='published' ORDER BY created_at DESC LIMIT 50000"
    ).all();

    const lines = [
      "# DigitalNest — Digital Products Directory",
      "",
      "DigitalNest is an online store where visitors can discover ebooks, practical guides, templates and other downloadable digital resources.",
      "",
      "Visitors can open each product page to review its description, category, language and price. Payment and file delivery are handled on the individual product page.",
      "",
      "## Browse published products",
      ""
    ];

    for (const p of results) {
      const href = origin + "/product/" + encodeURIComponent(p.slug);
      lines.push("### " + clean(p.title));
      if (p.description) lines.push(clean(p.description));
      lines.push(
        "- Category: " + clean(p.category || "Digital resource"),
        "- Language: " + clean(p.language || "Not specified"),
        "- Market: " + clean(p.market || "Global"),
        "- Price: " + (Number.isFinite(Number(p.price)) ? "$" + Number(p.price).toFixed(2) : "See product page"),
        "- Product page: " + href,
        ""
      );
    }

    if (!results.length) lines.push("No published products are currently listed.", "");
    lines.push("## Main pages", "", "- Store homepage: " + origin + "/", "- XML sitemap: " + origin + "/sitemap.xml", "");

    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/markdown; charset=UTF-8",
        "cache-control": "public, max-age=300",
        "x-robots-tag": "index, follow"
      }
    });
  } catch (error) {
    return new Response("DigitalNest product guide is temporarily unavailable.", {
      status: 503,
      headers: { "content-type": "text/markdown; charset=UTF-8", "cache-control": "no-store" }
    });
  }
}
