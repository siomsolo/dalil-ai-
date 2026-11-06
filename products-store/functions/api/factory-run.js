function auth(request,env){return (!!env.ADMIN_PASSWORD&&(request.headers.get("x-admin-token")||"")===env.ADMIN_PASSWORD)|| (!!env.FACTORY_CRON_SECRET&&(request.headers.get("x-factory-cron")||"")===env.FACTORY_CRON_SECRET)}
export async function onRequestPost({request,env}){
 if(!auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 try{
  const s=await env.DB.prepare("SELECT * FROM factory_settings WHERE id=1").first();
  if(!s?.enabled)return Response.json({error:"Enable the factory first in its settings."},{status:409});
  const {results:opps=[]}=await env.DB.prepare("SELECT * FROM factory_opportunities WHERE status='candidate' AND (season_end IS NULL OR season_end>=date('now')) ORDER BY opportunity_score DESC LIMIT 500").all();
  if(!opps.length){const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();return Response.json({ok:true,queued:Number(pending?.n||0),message:"No unused opportunities remain; queued jobs can still be processed."})}
  const languages=JSON.parse(s.languages||'["English","French","Spanish"]');
  let queued=0,skipped=0;
  for(const o of opps){
   for(const language of languages){
    const duplicate=await env.DB.prepare("SELECT 1 FROM factory_jobs WHERE opportunity_id=? AND language=? AND status IN ('queued','running','published','review','deferred')").bind(o.id,language).first();
    if(duplicate){skipped++;continue}
    await env.DB.prepare("INSERT INTO factory_jobs (id,opportunity_id,product_type,market,language,occasion,status,stage,estimated_neurons) VALUES (?,?,?,?,?,?, 'queued','queued',0)").bind(crypto.randomUUID(),o.id,o.product_type,o.market,language,o.occasion).run();
    queued++;
   }
  }
  const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  return Response.json({ok:true,queued,pending:Number(pending?.n||0),skipped,message:queued?"Queued every available opportunity in every selected language. No daily cap or scheduled release is applied.":"No new unused opportunity-language pairs remain."});
 }catch(e){return Response.json({error:e.message},{status:500})}
}