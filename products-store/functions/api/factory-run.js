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

  // Bound both the rolling queue and the work done by one Worker invocation.
  // The previous implementation issued one database subrequest per opportunity/language pair,
  // which could exceed Cloudflare's per-invocation subrequest limit.
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
    batchLimit:100,message:"Rolling queue target is already filled. The scheduler will replenish it as jobs complete."
   });
  }

  // A single bounded read, followed by one bulk INSERT ... SELECT.
  // Keep opportunity/language pairs unique across all historical job states.
  const {results:opportunities=[]}=await supabaseDB(env).prepare(
   "SELECT id,product_type,market,language,occasion FROM factory_opportunities WHERE status IN ('candidate','in_progress') AND (season_end IS NULL OR season_end>=CURRENT_DATE::text) ORDER BY opportunity_score DESC,created_at DESC LIMIT 150"
  ).all();

  const candidates=[];
  for(const opportunity of opportunities){
   for(const language of languages){
    candidates.push({
     id:crypto.randomUUID(),opportunity_id:opportunity.id,product_type:opportunity.product_type,
     market:opportunity.market,language,occasion:opportunity.occasion
    });
   }
  }

  const batchLimit=Math.min(100,remaining);
  let queued=0;
  if(candidates.length){
   const payload=JSON.stringify(candidates);
   const inserted=await supabaseDB(env).prepare(
    "INSERT INTO factory_jobs (id,opportunity_id,product_type,market,language,occasion,status,stage,estimated_neurons) " +
    "SELECT x.id,x.opportunity_id,x.product_type,x.market,x.language,x.occasion,'queued','queued',0 " +
    "FROM jsonb_to_recordset(?::jsonb) AS x(id text,opportunity_id text,product_type text,market text,language text,occasion text) " +
    "WHERE NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.opportunity_id=x.opportunity_id AND lower(j.language)=lower(x.language)) " +
    "ORDER BY x.opportunity_id,x.language LIMIT ?"
   ).bind(payload,batchLimit).run();
   queued=Number(inserted.meta?.changes||0);
  }

  const pending=await supabaseDB(env).prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  const totalReserved=reserved+queued;
  const skipped=Math.max(0,candidates.length-queued);
  return Response.json({
   ok:true,queued,pending:Number(pending?.n||0),skipped,queueTarget,reserved:totalReserved,
   remaining:Math.max(0,queueTarget-totalReserved),queueTargetReached:queued===remaining,
   batchLimit,candidatePairs:candidates.length,
   message:queued
    ?"Queued "+queued+" product job(s) in one bounded database batch. Existing opportunity/language pairs are not recreated."
    :"No unprocessed opportunity/language pairs are available. Existing queued jobs can still be processed."
  });
 }catch(error){
  console.log("FACTORY_PLANNER_ERROR",String(error?.stack||error));
  return Response.json({error:error?.message||"Factory planning failed."},{status:500});
 }
}
