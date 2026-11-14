import {supabaseDB} from "./supabase-db.js";
let tablesReady=null;
async function ensureTables(env){
 if(!tablesReady){tablesReady=(async()=>{
  const db=supabaseDB(env);
  await db.prepare("CREATE TABLE IF NOT EXISTS factory_ai_call_log (id TEXT PRIMARY KEY,job_id TEXT,provider_key TEXT NOT NULL,model TEXT NOT NULL,task TEXT NOT NULL,success BOOLEAN NOT NULL,http_status INTEGER,input_tokens BIGINT,output_tokens BIGINT,input_chars INTEGER,output_chars INTEGER,duration_ms INTEGER,error TEXT,metadata TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_factory_ai_call_log_created ON factory_ai_call_log(created_at DESC)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS factory_ai_daily_limits (provider_key TEXT NOT NULL,usage_date DATE NOT NULL,used INTEGER NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(provider_key,usage_date))").run();
 })().catch(e=>{tablesReady=null;throw e})}
 return tablesReady;
}
function usageOf(r){return r?.usage||r?.meta?.usage||r?.result?.usage||r?.usageMetadata||{}}
function tokenCount(u,keys){for(const k of keys){const n=Number(u?.[k]);if(Number.isFinite(n)&&n>=0)return Math.round(n)}return null}
export async function logAiUsage(env,e){
 try{
  await ensureTables(env);const u=e.usage||{},meta={...(e.metadata||{}),usage_available:Object.keys(u||{}).length>0,usage:u};
  await supabaseDB(env).prepare("INSERT INTO factory_ai_call_log(id,job_id,provider_key,model,task,success,http_status,input_tokens,output_tokens,input_chars,output_chars,duration_ms,error,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(
   crypto.randomUUID(),e.jobId||null,String(e.provider||"unknown"),String(e.model||"unknown"),String(e.task||"inference"),!!e.success,e.httpStatus??null,
   tokenCount(u,["prompt_tokens","input_tokens","promptTokenCount","inputTokenCount"]),tokenCount(u,["completion_tokens","output_tokens","candidatesTokenCount","outputTokenCount"]),
   Number(e.inputChars||0),Number(e.outputChars||0),Number(e.durationMs||0),e.error?String(e.error).slice(0,1000):null,JSON.stringify(meta).slice(0,4000)
  ).run();
 }catch(error){console.log("FACTORY_AI_USAGE_LOG_ERROR",String(error?.message||error))}
}
export async function runAiLogged(env,e,run){
 const start=Date.now();try{const result=await run(),usage=usageOf(result);await logAiUsage(env,{...e,success:true,usage,outputChars:typeof result?.response==="string"?result.response.length:typeof result?.image==="string"?result.image.length:0,durationMs:Date.now()-start,metadata:{result_keys:result&&typeof result==="object"?Object.keys(result):[]}});return result}
 catch(error){await logAiUsage(env,{...e,success:false,error:String(error?.message||error),durationMs:Date.now()-start});throw error}
}
export async function claimDailyAiSlot(env,provider,limit){
 await ensureTables(env);const day=new Date().toISOString().slice(0,10);
 return supabaseDB(env).prepare("INSERT INTO factory_ai_daily_limits(provider_key,usage_date,used) VALUES(?,?,1) ON CONFLICT(provider_key,usage_date) DO UPDATE SET used=factory_ai_daily_limits.used+1,updated_at=CURRENT_TIMESTAMP WHERE factory_ai_daily_limits.used < ? RETURNING used").bind(provider,day,limit).first()
}
