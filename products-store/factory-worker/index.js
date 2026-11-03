export default {
  async scheduled(controller, env, ctx) {
    const base = env.FACTORY_PAGES_URL || "https://digital-products-store-4yt.pages.dev";
    if (!env.FACTORY_ADMIN_TOKEN) {
      console.error("FACTORY_ADMIN_TOKEN secret is not configured; scheduler skipped.");
      return;
    }
    const response = await fetch(base + "/api/factory-run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": env.FACTORY_ADMIN_TOKEN
      },
      body: "{}"
    });
    const body = await response.text();
    if (!response.ok) throw new Error("Factory planning endpoint failed: " + response.status + " " + body.slice(0,500));
    console.log("Factory scheduler result:", body);
  },
  async fetch() {
    return new Response("DigitalNest factory scheduler is active. Scheduled runs only.", { status: 200 });
  }
};
