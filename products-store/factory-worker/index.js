export default {
  async scheduled(controller, env, ctx) {
    const base = env.FACTORY_PAGES_URL || "https://digital-products-store-4yt.pages.dev";
    if (!env.FACTORY_ADMIN_TOKEN) {
      console.error("FACTORY_ADMIN_TOKEN secret is not configured; scheduler skipped.");
      return;
    }
    const headers = {"content-type":"application/json","x-admin-token":env.FACTORY_ADMIN_TOKEN};
    const plan = await fetch(base + "/api/factory-run", {method:"POST",headers,body:"{}"});
    const planText = await plan.text();
    if (!plan.ok) throw new Error("Factory planner failed: "+plan.status+" "+planText.slice(0,500));
    console.log("Factory planning:",planText);
    let queued=0;
    try { queued=Number(JSON.parse(planText).queued||0); } catch {}
    if (queued>0) {
      const process = await fetch(base + "/api/factory-process", {method:"POST",headers,body:"{}"});
      const processText = await process.text();
      if (!process.ok) throw new Error("Factory processor failed: "+process.status+" "+processText.slice(0,500));
      console.log("Factory processing:",processText);
    }
  },
  async fetch() { return new Response("DigitalNest factory scheduler is active. Scheduled runs only.", {status:200}); }
};
