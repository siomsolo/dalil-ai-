function auth(request,env){
 return (!!env.ADMIN_PASSWORD&&(request.headers.get("x-admin-token")||"")===env.ADMIN_PASSWORD)||
  (!!env.FACTORY_CRON_SECRET&&(request.headers.get("x-factory-cron")||"")===env.FACTORY_CRON_SECRET);
}

export async function onRequestPost({request,env}){
 if(!auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 try{
  const settings=await env.DB.prepare("SELECT * FROM factory_settings WHERE id=1").first();
  if(!settings?.enabled)return Response.json({error:"Enable the factory first in its settings."},{status:409});

  const languages=[...new Set(JSON.parse(settings.languages||'["English"]')
   .map(value=>String(value||"").trim()).filter(Boolean))];
  if(!languages.length)return Response.json({error:"Select at least one production language."},{status:409});

  // Reserve capacity for every unfinished job, including jobs carried over from yesterday.
  // Count all jobs created today as well, so failures cannot trigger an unlimited retry loop.
  const usage=await env.DB.prepare(
   "SELECT COUNT(DISTINCT id) AS n FROM factory_jobs WHERE created_at>=datetime('now','start of day') OR status IN ('queued','running','deferred')"
  ).first();
  const reserved=Number(usage?.n||0);
  const dailyCap=Math.max(1,Math.min(50,Number(settings.daily_product_cap)||1));
  const remaining=Math.max(0,dailyCap-reserved);
  const pendingRow=await env.DB.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  const pendingBefore=Number(pendingRow?.n||0);

  if(remaining===0){
   return Response.json({
    ok:true,queued:0,pending:pendingBefore,skipped:0,dailyCap,reserved,remaining:0,dailyLimitReached:true,
    message:"Daily product cap reached or already reserved by queued jobs. The scheduler will plan again after capacity becomes available."
   });
  }

  // An opportunity remains eligible while its language variants are being produced.
  // This lets the planner fill one language at a time without reopening completed ideas.
  const {results:opportunities=[]}=await env.DB.prepare(
   "SELECT * FROM factory_opportunities WHERE status IN ('candidate','in_progress') AND (season_end IS NULL OR season_end>=date('now')) ORDER BY opportunity_score DESC,created_at DESC LIMIT 500"
  ).all();

  let queued=0,skipped=0;
  for(const opportunity of opportunities){
   for(const language of languages){
    if(queued>=remaining)break;
    // Never recreate a previously attempted opportunity/language pair, even if its job failed.
    const existing=await env.DB.prepare(
     "SELECT 1 FROM factory_jobs WHERE opportunity_id=? AND lower(language)=lower(?) LIMIT 1"
    ).bind(opportunity.id,language).first();
    if(existing){skipped++;continue;}

    const inserted=await env.DB.prepare(
     "INSERT OR IGNORE INTO factory_jobs (id,opportunity_id,product_type,market,language,occasion,status,stage,estimated_neurons) VALUES (?,?,?,?,?,?, 'queued','queued',0)"
    ).bind(crypto.randomUUID(),opportunity.id,opportunity.product_type,opportunity.market,language,opportunity.occasion).run();

    if(Number(inserted.meta?.changes||0)>0)queued++;
    else skipped++;
   }
   if(queued>=remaining)break;
  }

  const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  const totalReserved=reserved+queued;
  return Response.json({
   ok:true,queued,pending:Number(pending?.n||0),skipped,dailyCap,reserved:totalReserved,
   remaining:Math.max(0,dailyCap-totalReserved),dailyLimitReached:queued===remaining,
   message:queued
    ?"Queued "+queued+" new product job(s) within the daily cap. Existing opportunity/language pairs are not recreated."
    :"No unprocessed opportunity/language pairs are available. Existing queued jobs can still be processed."
  });
 }catch(error){
  return Response.json({error:error?.message||"Factory planning failed."},{status:500});
 }
}
