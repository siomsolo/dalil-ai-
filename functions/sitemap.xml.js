const xmlEscape = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;"
}[char]));

export async function onRequest({ env }) {
  const origin = "https://dalil-ai-f03.pages.dev";
  const projectUrl = env.SUPABASE_URL || "https://ssnjoflgkkimrcapeglg.supabase.co";
  const publicKey = env.SUPABASE_ANON_KEY || "sb_publishable_mq0IavMqSE_2xctRz9CD-A_rH4X6PMb";
  const query = new URLSearchParams({
    select: "slug,updated_at,created_at",
    status: "eq.published",
    order: "created_at.desc",
    limit: "5000"
  });

  let tools;
  try {
    const response = await fetch(projectUrl.replace(/\/$/, "") + "/rest/v1/tools?" + query.toString(), {
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + publicKey,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      return new Response("Unable to generate sitemap", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
    const rows = await response.json();
    tools = Array.isArray(rows) ? rows : [];
  } catch {
    return new Response("Unable to generate sitemap", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const staticPages = [
    { path: "/", changefreq: "daily", priority: "1.0" },
    { path: "/all-tools.html", changefreq: "daily", priority: "0.9" },
  ];

  const toolPages = tools
    .filter((tool) => typeof tool.slug === "string" && tool.slug.trim().length > 0)
    .map((tool) => ({
      path: "/tools/" + encodeURIComponent(tool.slug),
      lastmod: tool.updated_at || tool.created_at || null,
      changefreq: "weekly",
      priority: "0.7"
    }));

  const pages = new Map();
  for (const page of [...staticPages, ...toolPages]) {
    if (!pages.has(page.path)) pages.set(page.path, page);
  }

  const urls = [...pages.values()].map((page) => {
    const lastmod = page.lastmod && !Number.isNaN(Date.parse(page.lastmod))
      ? "<lastmod>" + xmlEscape(new Date(page.lastmod).toISOString().slice(0, 10)) + "</lastmod>"
      : "";
    return "  <url><loc>" + xmlEscape(origin + page.path) + "</loc>" + lastmod +
      "<changefreq>" + page.changefreq + "</changefreq><priority>" + page.priority + "</priority></url>";
  }).join("\n");

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls + "\n</urlset>\n";

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
