import {supabaseDB} from "../_shared/supabase-db.js";
async function auth(request,env){
 const supplied=request.headers.get("x-factory-cron")||"";
 if(!supplied)return false;
 if(env.FACTORY_CRON_SECRET && supplied===env.FACTORY_CRON_SECRET)return true;
 await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_scheduler_auth (id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
 const row=await supabaseDB(env).prepare("SELECT token FROM factory_scheduler_auth WHERE id=1").first();
 return !!row?.token&&supplied===row.token;
}
export async function onRequestPost({request,env}){
 try{
  if(!await auth(request,env))return Response.json({error:"Cron authentication failed."},{status:401});
  await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_retry_schedule (job_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,next_retry_at TEXT NOT NULL,reason TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_queue_lock (id INTEGER PRIMARY KEY CHECK(id=1),lock_token TEXT,lock_until TEXT)").run();
  const settings=await supabaseDB(env).prepare("SELECT enabled FROM factory_settings WHERE id=1").first();
  if(!settings?.enabled)return Response.json({ok:true,skipped:true,reason:"factory_disabled"});
  const due=await supabaseDB(env).prepare("SELECT job_id FROM factory_retry_schedule WHERE datetime(next_retry_at)<=CURRENT_TIMESTAMP ORDER BY next_retry_at LIMIT 10").all();
  let released=0;
  for(const item of (due.results||[])){
   const r=await supabaseDB(env).prepare("UPDATE factory_jobs SET status='queued',stage='queued',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='deferred'").bind(item.job_id).run();
   if(Number(r.meta?.changes||0)>0)released++;
   await supabaseDB(env).prepare("DELETE FROM factory_retry_schedule WHERE job_id=?").bind(item.job_id).run();
  }
  await supabaseDB(env).prepare("UPDATE factory_jobs SET status='queued',stage='queued',error='Recovered automatically after a stale running lease.',updated_at=CURRENT_TIMESTAMP WHERE status='running' AND updated_at<datetime('now','-10 minutes')").run();
  if(env.FACTORY_CRON_SECRET){
   await supabaseDB(env).prepare("INSERT INTO factory_scheduler_auth (id,token,created_at) VALUES (1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET token=excluded.token").bind(env.FACTORY_CRON_SECRET).run();
  }
  const schedulerAuth=await supabaseDB(env).prepare("SELECT token FROM factory_scheduler_auth WHERE id=1").first();
  if(!schedulerAuth?.token)return Response.json({error:"Factory scheduler token is missing from Supabase. Configure FACTORY_CRON_SECRET in Cloudflare Pages Production."},{status:503});
  // Refresh curated and live trend opportunities before refilling the rolling queue.
  // This makes production replenishment ongoing instead of relying on a one-time manual seed.
  const opportunitiesUrl=new URL(request.url);opportunitiesUrl.pathname="/api/factory-opportunities";opportunitiesUrl.search="";
  const opportunitiesResponse=await fetch(opportunitiesUrl.toString(),{method:"GET",headers:{"x-factory-cron":schedulerAuth.token}});
  const opportunitiesBody=await opportunitiesResponse.json().catch(()=>({}));
  if(!opportunitiesResponse.ok){console.log("FACTORY_CRON_OPPORTUNITY_ERROR",JSON.stringify({status:opportunitiesResponse.status,body:opportunitiesBody}));return Response.json({error:"Factory opportunity refresh failed.",opportunities:opportunitiesBody},{status:502});}
  console.log("FACTORY_CRON_OPPORTUNITIES",JSON.stringify({count:opportunitiesBody.opportunities?.length||0,ingested:opportunitiesBody.ingested||0}));
  // Refill the rolling queue on every five-minute scheduler tick. Existing opportunity/language
  // pairs are idempotent, so this never recreates jobs that were already attempted.
  const planUrl=new URL(request.url);planUrl.pathname="/api/factory-run";planUrl.search="";
  const planResponse=await fetch(planUrl.toString(),{method:"POST",headers:{"content-type":"application/json","x-factory-cron":schedulerAuth.token},body:"{}"});
  const planBody=await planResponse.json().catch(()=>({}));
  if(!planResponse.ok){console.log("FACTORY_CRON_PLANNER_ERROR",JSON.stringify({status:planResponse.status,body:planBody}));return Response.json({error:"Factory queue planner failed.",planner:planBody},{status:502});}
  console.log("FACTORY_CRON_PLAN",JSON.stringify(planBody));
  // Do not create repeated failed attempts while all three Gemini free-tier keys are
  // in their quota cooldown. The cron keeps checking; the first reset key is tested
  // automatically as soon as its blocked_until time passes.
  const quotaState=await supabaseDB(env).prepare("SELECT COUNT(*) AS n,MIN(blocked_until) AS next_reset FROM factory_provider_state WHERE provider_key IN ('GEMINI_EN_API_KEY','GEMINI_FR_API_KEY','GEMINI_ES_API_KEY') AND state='exhausted' AND blocked_until IS NOT NULL AND datetime(blocked_until)>CURRENT_TIMESTAMP").first();
  const queued=await supabaseDB(env).prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  if(Number(quotaState?.n||0)>=3&&!env.AI){
   return Response.json({ok:true,paused:true,reason:"all_gemini_quotas_exhausted_no_fallback",next_retry_at:quotaState.next_reset,queued:Number(queued?.n||0),message:"All Gemini free quotas are exhausted and Workers AI fallback is not bound. The scheduler will retry after quota reset."});
  }
  if(Number(quotaState?.n||0)>=3&&env.AI){
   console.log("FACTORY_CRON_USING_WORKERS_AI_FALLBACK",JSON.stringify({next_gemini_reset:quotaState.next_reset,queued:Number(queued?.n||0)}));
  }
  const lock=await supabaseDB(env).prepare("SELECT lock_token,lock_until FROM factory_queue_lock WHERE id=1").first();
  const lockUntil=lock?.lock_until?Date.parse(String(lock.lock_until).replace(" ","T")+"Z"):0;
  if(Number(queued?.n||0)===0)return Response.json({ok:true,released,queued:0,message:"No due jobs."});
  if(lock?.lock_token&&lockUntil>Date.now())return Response.json({ok:true,released,queued:Number(queued.n),busy:true,message:"A production task still owns the queue lease."});
  const url=new URL(request.url);url.pathname="/api/factory-process";url.search="";
  const result=await fetch(url.toString(),{method:"POST",headers:{"content-type":"application/json","x-factory-cron":schedulerAuth.token},body:"{}"});
  const body=await result.json().catch(()=>({}));
  console.log("FACTORY_CRON_PROCESS_RESULT",JSON.stringify({status:result.status,released,queued:Number(queued.n),result:body}));
  return Response.json({ok:result.ok,released,queued:Number(queued.n),process_status:result.status,result:body},{status:result.ok?200:502});
 }catch(e){
  console.log("FACTORY_CRON_ERROR",String(e?.stack||e));
  return Response.json({error:String(e?.message||e)},{status:500});
 }
}
