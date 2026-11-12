import {adminAuthorized,cronAuthorized,mutationGuard} from "../_shared/security.js";
import {supabaseDB} from "../_shared/supabase-db.js";
function auth(request,env){return adminAuthorized(request,env)||cronAuthorized(request,env)}
export async function onRequestPost({request,env}){
 const blocked=mutationGuard(request);if(blocked)return blocked;
 if(!auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 try{
  const s=await supabaseDB(env).prepare("SELECT enabled FROM factory_settings WHERE id=1").first();
  if(!s?.enabled)return Response.json({error:"Enable the factory before resuming production."},{status:409});
  await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_provider_state (provider_key TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'active',last_error TEXT,blocked_until TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await supabaseDB(env).prepare("UPDATE factory_provider_state SET state='active',blocked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE state IN ('exhausted','fallback','invalid')").run();
  const reset=await supabaseDB(env).prepare("UPDATE factory_jobs SET status='queued',stage='queued',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='deferred'").run();
  const pending=await supabaseDB(env).prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  return Response.json({ok:true,requeued:reset.meta?.changes||0,pending:Number(pending?.n||0),message:"Quota state cleared for a fresh check. The next processing attempt will verify provider availability and pause again if quotas remain exhausted."});
 }catch(e){return Response.json({error:e.message},{status:500})}
}