export async function onRequest({ env }) {
  const projectUrl = env.SUPABASE_URL || "https://ssnjoflgkkimrcapeglg.supabase.co";
  const publicKey = env.SUPABASE_ANON_KEY || "sb_publishable_mq0IavMqSE_2xctRz9CD-A_rH4X6PMb";
  const query = new URLSearchParams({
    select: "id,name,slug,short_description,description,category,website_url,pricing,logo_url,creator_name,social_url,contact_email,featured,status,created_at",
    status: "eq.published",
    order: "created_at.desc",
    limit: "5000"
  });

  try {
    const response = await fetch(projectUrl.replace(/\\/$/, "") + "/rest/v1/tools?" + query.toString(), {
      headers: {
        apikey: publicKey,
        Authorization: "Bearer " + publicKey,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      return Response.json({ error: "Unable to load published tools" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" }
      });
    }
    const rows = await response.json();
    return Response.json(Array.isArray(rows) ? rows : [], {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=60",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return Response.json({ error: "Unable to reach tool database" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
