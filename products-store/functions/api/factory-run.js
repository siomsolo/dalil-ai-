import {supabaseDB} from "../_shared/supabase-db.js";
async function auth(request,env){
 const supplied=request.headers.get("x-factory-cron")||"";
 if((!!env.ADMIN_PASSWORD&&(request.headers.get("x-admin-token")||"")===env.ADMIN_PASSWORD)||
  (!!env.FACTORY_CRON_SECRET&&supplied===env.FACTORY_CRON_SECRET))return true;
 if(!supplied)return false;
 try{
  const row=await supabaseDB(env).prepare("SELECT token FROM factory_scheduler_auth WHERE id=1").first();
  return !!row?.token&&supplied===row.token;
 }catch(_){return false}
}

export async function onRequestPost({request,env}){
 if(!await auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 try{
  const settings=await supabaseDB(env).prepare("SELECT * FROM factory_settings WHERE id=1").first();
  if(!settings?.enabled)return Response.json({error:"Enable the factory first in its settings."},{status:409});

  const languages=[...new Set(JSON.parse(settings.languages||'["English"]')
   .map(value=>String(value||"").trim()).filter(Boolean))];
  if(!languages.length)return Response.json({error:"Select at least one production language."},{status:409});

  // Keep a deep rolling queue instead of imposing a daily product limit.
  // The queue target bounds planning while production continues until provider quotas are exhausted.
  const usage=await supabaseDB(env).prepare(
   "SELECT COUNT(*) AS n FROM factory_jobs WHERE status IN ('queued','running','deferred')"
  ).first();
  const reserved=Number(usage?.n||0);
  const queueTarget=500;
  const remaining=Math.max(0,queueTarget-reserved);
  const pendingRow=await supabaseDB(env).prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  const pendingBefore=Number(pendingRow?.n||0);

  if(remaining===0){
   return Response.json({
    ok:true,queued:0,pending:pendingBefore,skipped:0,queueTarget,reserved,remaining:0,queueTargetReached:true,
    message:"Rolling queue target is already filled. The scheduler will replenish it as jobs complete."
   });
  }

  // An opportunity remains eligible while its language variants are being produced.
  // This lets the planner fill one language at a time without reopening completed ideas.
  const {results:opportunities=[]}=await supabaseDB(env).prepare(
   "SELECT * FROM factory_opportunities WHERE status IN ('candidate','in_progress') AND (season_end IS NULL OR season_end>=CURRENT_DATE::text) ORDER BY opportunity_score DESC,created_at DESC LIMIT 500"
  ).all();

  let queued=0,skipped=0;
  for(const opportunity of opportunities){
   for(const language of languages){
    if(queued>=remaining)break;
    // Never recreate a previously attempted opportunity/language pair, even if its job failed.
    const existing=await supabaseDB(env).prepare(
     "SELECT 1 FROM factory_jobs WHERE opportunity_id=? AND lower(language)=lower(?) LIMIT 1"
    ).bind(opportunity.id,language).first();
    if(existing){skipped++;continue;}

    const inserted=await supabaseDB(env).prepare(
     "INSERT OR IGNORE INTO factory_jobs (id,opportunity_id,product_type,market,language,occasion,status,stage,estimated_neurons) VALUES (?,?,?,?,?,?, 'queued','queued',0)"
    ).bind(crypto.randomUUID(),opportunity.id,opportunity.product_type,opportunity.market,language,opportunity.occasion).run();

    if(Number(inserted.meta?.changes||0)>0)queued++;
    else skipped++;
   }
   if(queued>=remaining)break;
  }

  const pending=await supabaseDB(env).prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  const totalReserved=reserved+queued;
  return Response.json({
   ok:true,queued,pending:Number(pending?.n||0),skipped,queueTarget,reserved:totalReserved,
   remaining:Math.max(0,queueTarget-totalReserved),queueTargetReached:queued===remaining,
   message:queued
    ?"Queued "+queued+" new product job(s) in the rolling queue. Existing opportunity/language pairs are not recreated."
    :"No unprocessed opportunity/language pairs are available. Existing queued jobs can still be processed."
  });
 }catch(error){
  return Response.json({error:error?.message||"Factory planning failed."},{status:500});
 }
}
