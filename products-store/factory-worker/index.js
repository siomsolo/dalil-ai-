export default {
  async scheduled(controller, env) {
    const base=env.FACTORY_PAGES_URL||"https://digital-products-store-4yt.pages.dev";
    if(!env.FACTORY_ADMIN_TOKEN)throw new Error("FACTORY_ADMIN_TOKEN secret is not configured.");
    const headers={"content-type":"application/json","x-admin-token":env.FACTORY_ADMIN_TOKEN};
    const planRes=await fetch(base+"/api/factory-run",{method:"POST",headers,body:"{}"});
    const planText=await planRes.text();if(!planRes.ok)throw new Error("Planner failed "+planRes.status+": "+planText.slice(0,300));
    const plan=JSON.parse(planText);console.log("Factory plan",plan);
    const count=Math.min(10,Number(plan.queued||0));
    for(let i=0;i<count;i++){
      const res=await fetch(base+"/api/factory-process",{method:"POST",headers,body:"{}"});
      const txt=await res.text();if(!res.ok)throw new Error("Processor failed "+res.status+": "+txt.slice(0,300));
      const result=JSON.parse(txt);console.log("Factory item",i+1,result);
      if(!result.ok||result.status!=="published")break;
    }
  },
  async fetch(){return new Response("DigitalNest scheduled factory. Runs daily at 08:00 UTC.",{status:200});}
};
