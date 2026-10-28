const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[char]));

export async function onRequest({ env }) {
  const origin = "https://dalil-ai-f03.pages.dev";
  const projectUrl = env.SUPABASE_URL || "https://ssnjoflgkkimrcapeglg.supabase.co";
  const publicKey = env.SUPABASE_ANON_KEY || "sb_publishable_mq0IavMqSE_2xctRz9CD-A_rH4X6PMb";
  const query = new URLSearchParams({
    select: "name,slug,category,short_description,pricing",
    status: "eq.published",
    order: "created_at.desc",
    limit: "5000"
  });

  let tools;
  try {
    const response = await fetch(projectUrl.replace(/\/$/, "") + "/rest/v1/tools?" + query.toString(), {
      headers: { apikey: publicKey, Authorization: "Bearer " + publicKey, Accept: "application/json" }
    });
    if (!response.ok) {
      return new Response("Unable to load tool directory", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
    const rows = await response.json();
    tools = Array.isArray(rows) ? rows : [];
  } catch {
    return new Response("Unable to load tool directory", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const grouped = new Map();
  for (const tool of tools) {
    if (!tool || typeof tool.slug !== "string" || !tool.slug.trim() || !tool.name) continue;
    const category = tool.category || "أدوات أخرى";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(tool);
  }

  const sections = [...grouped.entries()].map(([category, items]) => `
    <section class="category">
      <h2>${escapeHtml(category)} <small>(${items.length})</small></h2>
      <ul>${items.map(tool => `
        <li>
          <h3><a href="/tools/${encodeURIComponent(tool.slug)}">${escapeHtml(tool.name)}</a></h3>
          ${tool.short_description ? `<p>${escapeHtml(tool.short_description)}</p>` : ""}
          <p class="meta">التسعير: ${escapeHtml(tool.pricing || "راجع الموقع الرسمي")}</p>
        </li>`).join("")}</ul>
    </section>`).join("");

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="description" content="تصفح قائمة أدوات الذكاء الاصطناعي المنشورة في الدليل العربي، حسب التصنيف، مع روابط مباشرة إلى صفحات كل أداة ووصفها.">
<link rel="canonical" href="${origin}/all-tools.html">
<title>جميع أدوات الذكاء الاصطناعي | دليل أدوات الذكاء الاصطناعي</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#17243b;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.8}.wrap{max-width:960px;margin:auto;padding:24px 16px}header,section{background:#fff;border:1px solid #e1e7f0;border-radius:16px;padding:20px;margin-bottom:16px}a{color:#164a8a;text-decoration-thickness:1px;text-underline-offset:3px}h1{line-height:1.4;font-size:clamp(26px,4vw,38px)}h2{font-size:22px;margin-top:0}h3{font-size:18px;margin:0 0 4px}ul{list-style:none;margin:0;padding:0}li{padding:14px 0;border-top:1px solid #edf0f5}li:first-child{border-top:0}p{margin:4px 0;color:#4b5870}.meta,small{font-size:13px;color:#69768a}.back{display:inline-block;margin-bottom:16px;font-weight:700}.count{font-weight:700}
</style>
</head>
<body><main class="wrap">
<header><a class="back" href="/">← العودة إلى الصفحة الرئيسية</a><h1>جميع أدوات الذكاء الاصطناعي في الدليل</h1><p>قائمة قابلة للتصفح للأدوات المنشورة، مرتبة حسب التصنيف. افتح صفحة أي أداة لقراءة وصفها وزيارة موقعها الرسمي.</p><p class="count">عدد الأدوات المعروضة: ${tools.length}</p></header>
${sections || "<section><p>لا توجد أدوات منشورة للعرض حالياً.</p></section>"}
<footer><p><a href="/">الصفحة الرئيسية</a> · <a href="/sitemap.xml">خريطة الموقع</a></p></footer>
</main></body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
