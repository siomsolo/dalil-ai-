const origin = "https://digital-products-store-4yt.pages.dev";

function markdownText(value) {
  return String(value ?? "")
    .replace(/\\r?\\n/g, " ")
    .replace(/\\s+/g, " ")
    .replace(/([\\\\`*_{}\\[\\]()#+.!|>])/g, "\\\\$1")
    .trim();
}

export async function onRequest({ env }) {
  try {
    const { results = [] } = await env.DB.prepare(
      "SELECT slug,title,description,category,language,market,occasion,keywords,price FROM products WHERE status='published' ORDER BY created_at DESC LIMIT 50000"
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
      lines.push("### " + markdownText(p.title));
      if (p.description) lines.push(markdownText(p.description));
      lines.push(
        "- Category: " + markdownText(p.category || "Digital resource"),
        "- Language: " + markdownText(p.language || "Not specified"),
        "- Market: " + markdownText(p.market || "Global"),
        "- Price: " + (Number.isFinite(Number(p.price)) ? "$" + Number(p.price).toFixed(2) : "See product page"),
        "- Product page: " + href,
        ""
      );
    }

    if (!results.length) lines.push("No published products are currently listed.", "");

    lines.push("## Main pages", "", "- Store homepage: " + origin + "/", "- XML sitemap: " + origin + "/sitemap.xml", "");
    return new Response(lines.join("\\n"), {
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
