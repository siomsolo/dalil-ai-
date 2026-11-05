export default {
  async scheduled(controller, env) {
    const base = env.FACTORY_PAGES_URL || "https://digital-products-store-4yt.pages.dev";
    if (!env.FACTORY_CRON_SECRET) throw new Error("FACTORY_CRON_SECRET secret is not configured.");
    const headers = { "content-type": "application/json", "x-factory-cron": env.FACTORY_CRON_SECRET };
    const settingsRes = await fetch(base + "/api/factory-settings", { method: "GET", headers });
    if (!settingsRes.ok) throw new Error("Factory settings check failed " + settingsRes.status);
    const settings = await settingsRes.json();
    if (!settings.enabled) {
      console.log("Factory disabled; scheduled run skipped.");
      return;
    }

    const opportunitiesRes = await fetch(base + "/api/factory-opportunities", { method: "GET", headers });
    const opportunitiesText = await opportunitiesRes.text();
    if (!opportunitiesRes.ok) throw new Error("Opportunity ingestion failed " + opportunitiesRes.status + ": " + opportunitiesText.slice(0, 300));
    console.log("Factory opportunities", opportunitiesText.slice(0, 500));

    let completed = 0;
    const failures = [];
    // Re-plan after each attempt so a failed opportunity can be replaced.
    for (let attempt = 0; attempt < 9 && completed < 3; attempt++) {
      const planRes = await fetch(base + "/api/factory-run", { method: "POST", headers, body: "{}" });
      const planText = await planRes.text();
      if (!planRes.ok) throw new Error("Planner failed " + planRes.status + ": " + planText.slice(0, 300));
      const plan = JSON.parse(planText);
      console.log("Factory plan", plan);
      if (!Number(plan.queued || 0)) break;

      const processRes = await fetch(base + "/api/factory-process", { method: "POST", headers, body: "{}" });
      const processText = await processRes.text();
      let result = {};
      try { result = JSON.parse(processText); } catch (_) {}
      if (!processRes.ok || !result.ok) {
        failures.push(result.error || processText.slice(0, 300) || "Factory processing failed.");
        console.error("Factory attempt failed", result);
        continue;
      }
      completed += Number(result.processed || 1);
      console.log("Factory product completed", result);
    }
    console.log("Factory daily run finished", { completed, failures });
    if (completed === 0 && failures.length) throw new Error("No products completed. " + failures.join(" | "));
  },
  async fetch() {
    return new Response("DigitalNest scheduled factory. Runs sequentially every 15 minutes; daily safety cap applies.", { status: 200 });
  }
};
