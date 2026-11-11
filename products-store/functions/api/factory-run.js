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
function parseLanguages(value){
 if(Array.isArray(value))return value.map(x=>String(x||"").trim()).filter(Boolean);
 if(typeof value!=="string"||!value.trim())return ["English"];
 try{
  const parsed=JSON.parse(value);
  return Array.isArray(parsed)?parsed.map(x=>String(x||"").trim()).filter(Boolean):["English"];
 }catch(error){
  console.log("FACTORY_LANGUAGES_INVALID_JSON",JSON.stringify({value:String(value).slice(0,180),error:String(error?.message||error)}));
  return ["English"];
 }
}
export async function onRequestPost({request,env}){
 if(!await auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 try{
  const db=supabaseDB(env);
  const settings=await db.prepare("SELECT * FROM factory_settings WHERE id=1").first();
  if(!settings?.enabled)return Response.json({error:"Enable the factory first in its settings."},{status:409});
  const languages=[...new Set(parseLanguages(settings.languages))];
  if(!languages.length)return Response.json({error:"Select at least one production language."},{status:409});
  const usage=await db.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status IN ('queued','running','deferred')").first();
  const reserved=Number(usage?.n||0),queueTarget=500,remaining=Math.max(0,queueTarget-reserved);
  const pendingRow=await db.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  const pendingBefore=Number(pendingRow?.n||0);
  if(remaining===0)return Response.json({ok:true,queued:0,retried:0,pending:pendingBefore,skipped:0,queueTarget,reserved,remaining:0,queueTargetReached:true,batchLimit:100,message:"Rolling queue target is already filled. The scheduler will replenish it as jobs complete."});
  const reservedAfterRetry=reserved,remainingAfterRetry=remaining;
  const {results:opportunities=[]}=await db.prepare("SELECT id,product_type,market,language,occasion FROM factory_opportunities WHERE status IN ('candidate','in_progress') AND (season_end IS NULL OR season_end>=CURRENT_DATE::text) ORDER BY opportunity_score DESC,created_at DESC LIMIT 150").all();
  const candidates=[];
  for(const opportunity of opportunities)for(const language of languages)candidates.push({id:crypto.randomUUID(),opportunity_id:opportunity.id,product_type:opportunity.product_type,market:opportunity.market,language,occasion:opportunity.occasion});
  const batchLimit=Math.min(100,remainingAfterRetry);
  let queued=0;
  if(candidates.length&&batchLimit>0){
   const payload=JSON.stringify(candidates);
   const inserted=await db.prepare("INSERT INTO factory_jobs (id,opportunity_id,product_type,market,language,occasion,status,stage,estimated_neurons) SELECT x.id,x.opportunity_id,x.product_type,x.market,x.language,x.occasion,'queued','queued',0 FROM jsonb_to_recordset(?::jsonb) AS x(id text,opportunity_id text,product_type text,market text,language text,occasion text) WHERE NOT EXISTS (SELECT 1 FROM factory_jobs j WHERE j.opportunity_id=x.opportunity_id AND lower(j.language)=lower(x.language)) ORDER BY x.opportunity_id,x.language LIMIT ?").bind(JSON.stringify(candidates),batchLimit).run();
   queued=Number(inserted.meta?.changes||0);
  }
  const pending=await db.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  const totalReserved=reservedAfterRetry+queued,skipped=Math.max(0,candidates.length-queued);
  const message=queued?"Queued "+queued+" new opportunity/language job(s). Existing failed jobs are left untouched; published products are never re-created.":"No new opportunity/language pairs are currently available. Existing queued jobs can still be processed.";
  return Response.json({ok:true,queued,retried:0,pending:Number(pending?.n||0),skipped,queueTarget,reserved:totalReserved,remaining:Math.max(0,queueTarget-totalReserved),queueTargetReached:totalReserved>=queueTarget,batchLimit,candidatePairs:candidates.length,message});
 }catch(error){
  console.log("FACTORY_PLANNER_ERROR",String(error?.stack||error));
  return Response.json({error:error?.message||"Factory planning failed."},{status:500});
 }
}
