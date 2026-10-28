const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[char]));

export async function onRequest({ request, params, env }) {
  const slug = String(params.slug || "");
  if (!slug || slug.length > 180) {
    return new Response("Not found", { status: 404 });
  }

  const projectUrl = env.SUPABASE_URL || "https://ssnjoflgkkimrcapeglg.supabase.co";
  const publicKey = env.SUPABASE_ANON_KEY || "sb_publishable_mq0IavMqSE_2xctRz9CD-A_rH4X6PMb";
  const query = new URLSearchParams({
    select: "name,slug,category,short_description,description,website_url,pricing,logo_url,creator_name",
    slug: "eq." + slug,
    status: "eq.published",
    limit: "1"
  });

  let response;
  try {
    response = await fetch(projectUrl.replace(/\/$/, "") + "/rest/v1/tools?" + query.toString(), {
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + publicKey,
        Accept: "application/json"
      }
    });
  } catch {
    return new Response("Service temporarily unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  if (!response.ok) {
    return new Response("Service temporarily unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const rows = await response.json();
  const tool = Array.isArray(rows) ? rows[0] : null;
  if (!tool) {
    return new Response("<!doctype html><html lang=\"ar\" dir=\"rtl\"><meta charset=\"utf-8\"><title>الأداة غير موجودة</title><h1>الأداة غير موجودة أو لم تعد منشورة</h1><p><a href=\"/\">العودة إلى دليل أدوات الذكاء الاصطناعي</a></p></html>", {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" }
    });
  }

  const url = new URL(request.url);
  const canonical = url.origin + "/tools/" + encodeURIComponent(tool.slug);
  const title = tool.name + " - " + tool.category + " | دليل أدوات الذكاء الاصطناعي";
  const description = (tool.short_description || tool.description || ("اكتشف " + tool.name + " ضمن دليل أدوات الذكاء الاصطناعي.")).slice(0, 300);
  const logo = tool.logo_url ? '<img class="logo" src="' + escapeHtml(tool.logo_url) + '" alt="' + escapeHtml(tool.name) + '">' : "";
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": tool.name,
    "description": description,
    "url": canonical,
    "applicationCategory": tool.category,
    "inLanguage": "ar",
    "offers": tool.pricing ? { "@type": "Offer", "description": tool.pricing } : undefined
  }).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_AR">
<meta property="og:site_name" content="دليل أدوات الذكاء الاصطناعي">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<title>${escapeHtml(title)}</title>
<script type="application/ld+json">${structuredData}</script>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#17243b;background:#f5f7fb}*{box-sizing:border-box}body{margin:0;line-height:1.9}.wrap{max-width:900px;margin:0 auto;padding:24px 18px}.top,.panel{background:#fff;border:1px solid #e4e9f2;border-radius:18px;padding:24px;margin-bottom:18px}.brand{font-weight:800;color:#17315b;text-decoration:none}.eyebrow{color:#8a641f;font-size:13px;font-weight:800}.title-row{display:flex;gap:18px;align-items:center}.logo{width:78px;height:78px;object-fit:contain;border-radius:16px;border:1px solid #e4e9f2}.category{color:#65738b;font-size:13px}h1{font-size:clamp(25px,4vw,36px);line-height:1.4;margin:6px 0 12px}h2{font-size:20px;margin-top:0}p{color:#48566d}.actions{display:flex;gap:10px;flex-wrap:wrap}.btn{display:inline-block;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:800}.primary{background:#17315b;color:#fff}.secondary{border:1px solid #cbd4e2;color:#17315b}.facts{display:flex;gap:20px;flex-wrap:wrap}.facts div{min-width:130px}.facts small{display:block;color:#69768a}.facts strong{display:block}.footer{color:#69768a;font-size:12px;text-align:center;padding:14px}
</style>
</head>
<body>
<div class="wrap">
<header class="top"><a class="brand" href="/">دليل أدوات الذكاء الاصطناعي</a><p>اكتشف الأدوات الرقمية حسب احتياجك.</p></header>
<main>
<article class="panel">
<div class="title-row">${logo}<div><span class="eyebrow">${escapeHtml(tool.category || "أداة ذكاء اصطناعي")}</span><h1>${escapeHtml(tool.name)}</h1><p>${escapeHtml(description)}</p></div></div>
<div class="facts"><div><small>التصنيف</small><strong>${escapeHtml(tool.category || "غير محدد")}</strong></div><div><small>التسعير</small><strong>${escapeHtml(tool.pricing || "راجع الموقع الرسمي")}</strong></div>${tool.creator_name ? '<div><small>المطور أو الشركة</small><strong>' + escapeHtml(tool.creator_name) + '</strong></div>' : ""}</div>
</article>
<section class="panel"><h2>عن ${escapeHtml(tool.name)}</h2><p>${escapeHtml(tool.description || tool.short_description || "لم يضف وصف تفصيلي لهذه الأداة بعد.")}</p><div class="actions"><a class="btn primary" href="${escapeHtml(tool.website_url)}" target="_blank" rel="noopener noreferrer">زيارة الموقع الرسمي</a><a class="btn secondary" href="/">العودة إلى الدليل</a></div></section>
</main>
<footer class="footer">دليل أدوات الذكاء الاصطناعي — دليل لاكتشاف الأدوات الرقمية.</footer>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
