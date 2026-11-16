export async function onRequest() {
  return new Response(
    "User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /factory.html\nSitemap: https://digital-products-store-4yt.pages.dev/sitemap-v2.xml\n",
    {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}
