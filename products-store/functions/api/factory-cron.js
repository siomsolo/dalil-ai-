async function auth(request,env){
 const supplied=request.headers.get("x-factory-cron")||"";
 if(!supplied)return false;
 const row=await env.DB.prepare("SELECT token FROM factory_scheduler_auth WHERE id=1").first();
 return !!row?.token&&supplied===row.token;
}
export async function onRequestPost({request,env}){
 if(!await auth(request,env))return Response.json({error:"Cron authentication failed."},{status:401});
 try{
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS factory_scheduler_auth (id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();\n  await env.DB.prepare("CREATE TABLE IF NOT EXISTS factory_retry_schedule (job_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,next_retry_at TEXT NOT NULL,reason TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS factory_queue_lock (id INTEGER PRIMARY KEY CHECK(id=1),lock_token TEXT,lock_until TEXT)").run();
  const settings=await env.DB.prepare("SELECT enabled FROM factory_settings WHERE id=1").first();
  if(!settings?.enabled)return Response.json({ok:true,skipped:true,reason:"factory_disabled"});
  const due=await env.DB.prepare("SELECT job_id FROM factory_retry_schedule WHERE datetime(next_retry_at)<=CURRENT_TIMESTAMP ORDER BY next_retry_at LIMIT 10").all();
  let released=0;
  for(const item of (due.results||[])){
   const r=await env.DB.prepare("UPDATE factory_jobs SET status='queued',stage='queued',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='deferred'").bind(item.job_id).run();
   if(Number(r.meta?.changes||0)>0)released++;
   await env.DB.prepare("DELETE FROM factory_retry_schedule WHERE job_id=?").bind(item.job_id).run();
  }
  await env.DB.prepare("UPDATE factory_jobs SET status='queued',stage='queued',error='Recovered automatically after a stale running lease.',updated_at=CURRENT_TIMESTAMP WHERE status='running' AND updated_at<datetime('now','-10 minutes')").run();
  const queued=await env.DB.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  const lock=await env.DB.prepare("SELECT lock_token,lock_until FROM factory_queue_lock WHERE id=1").first();
  const lockUntil=lock?.lock_until?Date.parse(String(lock.lock_until).replace(" ","T")+"Z"):0;
  if(Number(queued?.n||0)===0)return Response.json({ok:true,released,queued:0,message:"No due jobs."});
  if(lock?.lock_token&&lockUntil>Date.now())return Response.json({ok:true,released,queued:Number(queued.n),busy:true,message:"A production task still owns the queue lease."});
  const url=new URL(request.url);url.pathname="/api/factory-process";url.search="";
  const result=await fetch(url.toString(),{method:"POST",headers:{"content-type":"application/json","x-factory-cron":env.FACTORY_CRON_SECRET},body:"{}"});
  const body=await result.json().catch(()=>({}));
  return Response.json({ok:true,released,queued:Number(queued.n),process_status:result.status,result:body},{status:200});
 }catch(e){console.log("FACTORY_CRON_ERROR",String(e?.stack||e));return Response.json({error:String(e?.message||e)},{status:500})}
}