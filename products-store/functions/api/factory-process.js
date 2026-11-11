import {supabaseDB} from "../_shared/supabase-db.js";
async function auth(request,env){const h=request.headers;const admin=(!!env.ADMIN_PASSWORD&&(h.get("x-admin-token")||"")===env.ADMIN_PASSWORD);const configuredCron=(!!env.FACTORY_CRON_SECRET&&(h.get("x-factory-cron")||"")===env.FACTORY_CRON_SECRET);if(admin||configuredCron)return true;const supplied=h.get("x-factory-cron")||"";if(!supplied)return false;try{const row=await supabaseDB(env).prepare("SELECT token FROM factory_scheduler_auth WHERE id=1").first();return !!row?.token&&supplied===row.token}catch(_){return false}}
function parseDraft(raw){
 if(raw&&typeof raw==="object"){
  const value=raw.response??raw.output_text??raw;
  if(value&&typeof value==="object"&&!Array.isArray(value))return value;
  raw=value;
 }
 let source=String(raw||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
 if(!source)throw new Error("AI returned an empty product draft.");
 try{return JSON.parse(source)}catch(_){}
 const first=source.indexOf("{");
 if(first<0)throw new Error("AI returned no JSON product draft.");
 let depth=0,inString=false,escaped=false,last=-1;
 for(let i=first;i<source.length;i++){
  const c=source[i];
  if(inString){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"')inString=false;continue}
  if(c==='"'){inString=true;continue}
  if(c==="{")depth++;
  else if(c==="}"&&--depth===0){last=i;break}
 }
 if(last<0)throw new Error("AI product draft was cut off before the JSON object was complete.");
 try{return JSON.parse(source.slice(first,last+1))}catch(_){throw new Error("AI product draft was not valid JSON even after extracting the complete object.")}
}
function languageCode(language){const raw=String(language||"English").trim();const parts=raw.split(":");if(parts[1])return parts[1].trim().slice(0,3).toUpperCase();const s=parts[0].toLowerCase();const known={"english":"EN","français":"FR","french":"FR","español":"ES","spanish":"ES","german":"DE","deutsch":"DE","portuguese":"PT","português":"PT","italian":"IT","italiano":"IT","arabic":"AR","العربية":"AR","japanese":"JA","日本語":"JA","chinese":"ZH","中文":"ZH","dutch":"NL","nederlands":"NL","russian":"RU","русский":"RU"};return known[s]||s.slice(0,2).toUpperCase()}
function languageName(language){const code=languageCode(language);const names={EN:"English",FR:"French",ES:"Spanish",DE:"German",PT:"Portuguese",IT:"Italian",AR:"Arabic",JA:"Japanese",ZH:"Chinese",NL:"Dutch",RU:"Russian"};return names[code]||String(language||"English").split(":")[0]}
async function ensureFactoryTables(env){
 await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_provider_state (provider_key TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'active',last_error TEXT,blocked_until TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
 await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_queue_lock (id INTEGER PRIMARY KEY CHECK(id=1),lock_token TEXT,lock_until TEXT)").run();
 await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_retry_state (job_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
 await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_retry_schedule (job_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,next_retry_at TEXT NOT NULL,reason TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
}
function quotaError(status,message){const m=String(message||"").toLowerCase();return status===429||m.includes("resource_exhausted")||m.includes("quota")||m.includes("rate limit")||m.includes("rate_limit")||m.includes("free_tier")}
function retryAtFromMessage(message,fallbackMs=6*60*60*1000){
 const s=String(message||"");const m=s.match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?/i);
 if(!m)return new Date(Date.now()+fallbackMs).toISOString();
 const ms=(Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0))*1000;
 return new Date(Date.now()+Math.max(60000,ms||fallbackMs)).toISOString();
}

async function completeDraftContent(env,job,draft,language){
 const words=String(draft?.content||"").trim().split(/\s+/).filter(Boolean).length;
 if(words>=520)return draft;
 if(!env.AI||typeof env.AI.run!=="function")throw new Error("FACTORY_DRAFT_TOO_SHORT: "+words+" words and no expansion provider is available.");
 const model=env.FACTORY_TEXT_MODEL||"@cf/google/gemma-4-26b-a4b-it";
 const prompt="Expand and improve this digital product into a complete, useful 600-700 word product in "+language+". Keep the same topic, intended audience, title, description and keywords. Do not add filler or repeat points. Include concrete steps, examples, a practical checklist or worksheet, and a conclusion. Return exactly one JSON object with string fields title, description, keywords, content. The content must be at least 550 words.\n\nCURRENT DRAFT:\n"+JSON.stringify({title:draft.title,description:draft.description,keywords:draft.keywords,content:draft.content}).slice(0,18000);
 let result;
 try{result=await env.AI.run(model,{messages:[{role:"system",content:"You are a professional digital publishing editor. Return valid JSON only, with complete content and no markdown fences."},{role:"user",content:prompt}],temperature:0.15,max_tokens:7000,chat_template_kwargs:{enable_thinking:false},response_format:{type:"json_object"}})}catch(error){throw new Error("FACTORY_DRAFT_EXPANSION_FAILED: "+String(error?.message||error))}
 const raw=result?.response??result?.choices?.[0]?.message?.content??result?.output_text??result?.result?.response??result;
 let expanded;
 try{expanded=parseDraft(raw)}catch(error){throw new Error("FACTORY_DRAFT_EXPANSION_INVALID_JSON: "+String(error?.message||error))}
 const expandedWords=String(expanded.content||"").trim().split(/\s+/).filter(Boolean).length;
 if(!expanded.title||!expanded.description||expandedWords<500)throw new Error("FACTORY_DRAFT_EXPANSION_INCOMPLETE: "+expandedWords+" words after expansion.");
 return {...draft,...expanded,_gemini_key_used:draft._gemini_key_used||"CLOUDFLARE_WORKERS_AI_EXPANSION:"+model};
}
async function generateCloudflareTextDraft(env,job,language,prompt){
 if(!env.AI||typeof env.AI.run!=="function")throw new Error("CLOUDFLARE_AI_UNAVAILABLE: Workers AI binding is not configured.");
 const model=env.FACTORY_TEXT_MODEL||"@cf/google/gemma-4-26b-a4b-it";
 const system="Return ONLY one syntactically valid JSON object. No Markdown fences, no preamble, no commentary. Use exactly four string properties: title, description, keywords, content. Escape all quotation marks and newlines correctly inside JSON strings. The content value must be 500-650 words of useful Markdown.";
 const run=async(userPrompt)=>await env.AI.run(model,{messages:[{role:"system",content:system},{role:"user",content:userPrompt}],temperature:0.2,max_tokens:7000,chat_template_kwargs:{enable_thinking:false},response_format:{type:"json_object"}});
 const extract=(r)=>r?.response??r?.choices?.[0]?.message?.content??r?.output_text??r?.result?.response??r?.result?.output_text??r;
 let response=await run(prompt);
 let raw=extract(response),draft;
 try{draft=parseDraft(raw)}catch(firstError){
  console.log("FACTORY_CLOUDFLARE_JSON_REPAIR",JSON.stringify({model,error:String(firstError?.message||firstError),sample:String(typeof raw==="string"?raw:JSON.stringify(raw)).slice(0,900)}));
  const sample=String(typeof raw==="string"?raw:JSON.stringify(raw)).slice(0,14000);
  response=await run("Convert the following attempted product draft into exactly one valid JSON object with string fields title, description, keywords, content. Preserve the useful content, repair all JSON syntax, remove any text outside the JSON object, and ensure content is at least 500 words in "+language+". Return JSON only.\n\nDRAFT TO REPAIR:\n"+sample);
  raw=extract(response);
  try{draft=parseDraft(raw)}catch(secondError){throw new Error("CLOUDFLARE_AI_INVALID_JSON_AFTER_REPAIR: "+String(secondError?.message||secondError)+"; response="+String(typeof raw==="string"?raw:JSON.stringify(raw)).slice(0,500))}
 }
 draft=await completeDraftContent(env,job,draft,language);
 const words=String(draft.content||"").trim().split(/\s+/).filter(Boolean).length;
 if(!draft.title||!draft.description||words<500)throw new Error("CLOUDFLARE_AI_INCOMPLETE: fallback model returned an incomplete product ("+words+" words after expansion).");
 draft._gemini_key_used="CLOUDFLARE_WORKERS_AI:"+model;
 await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES('CLOUDFLARE_WORKERS_AI_TEXT','active',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='active',last_error=NULL,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").run();
 console.log("FACTORY_TEXT_FALLBACK_SUCCESS",JSON.stringify({provider:"CLOUDFLARE_WORKERS_AI",model,language:job.language,words}));
 return draft;
}
async function generateDraft(env,job){
 await ensureFactoryTables(env);
 // Consume the three free-tier projects in a strict, predictable order.
 // The selected language is carried in the prompt, so any configured key can serve any language.
 const keys=["GEMINI_EN_API_KEY","GEMINI_FR_API_KEY","GEMINI_ES_API_KEY"].filter(k=>!!env[k]);
 if(!keys.length){console.log("FACTORY_NO_GEMINI_KEYS_USING_CLOUDFLARE_AI");return await generateCloudflareTextDraft(env,job,languageName(job.language),"Create a complete, genuinely useful original digital "+job.product_type+" in "+languageName(job.language)+". Write naturally for readers in "+job.market+". Topic: "+job.opportunity_title+". Occasion: "+job.occasion+". Create 550-700 words with an introduction, 5-6 practical sections, concrete steps and examples, an actionable checklist or worksheet, and a concise conclusion. Return exactly one valid JSON object with string fields title, description (70-100 words), keywords (8-12 comma-separated phrases), and content (550-700 words in Markdown, entirely in "+languageName(job.language)+".");}
 const {results:states=[]}=await supabaseDB(env).prepare("SELECT provider_key,state,last_error,blocked_until FROM factory_provider_state").all();
 const map=new Map(states.map(x=>[x.provider_key,x]));
 // Normalize legacy rows where a quota error was recorded but the provider state remained active.
 for(const key of keys){
  const state=map.get(key);
  if(state&&state.state!=="exhausted"&&state.last_error&&quotaError(0,state.last_error)){
   const blockedUntil=retryAtFromMessage(state.last_error,6*60*60*1000);
   await supabaseDB(env).prepare("UPDATE factory_provider_state SET state='exhausted',blocked_until=?,updated_at=CURRENT_TIMESTAMP WHERE provider_key=?").bind(blockedUntil,key).run();
   state.state="exhausted";state.blocked_until=blockedUntil;
   console.log("FACTORY_GEMINI_QUOTA_STATE_REPAIRED",JSON.stringify({provider_key:key,blocked_until:blockedUntil}));
  }
 }
 const available=keys.filter(k=>{const s=map.get(k);if(!s)return true;const until=s.blocked_until?Date.parse(s.blocked_until):0;if(Number.isFinite(until)&&until>Date.now())return false;if(s.state==="active"||s.state==="unknown")return true;if(s.state==="exhausted")return true;return false});
 if(!available.length){
  console.log("FACTORY_GEMINI_UNAVAILABLE_USING_CLOUDFLARE_AI",JSON.stringify({configuredKeys:keys.length,states:keys.map(k=>({key:k,state:map.get(k)?.state||"unknown"}))}));
  return await generateCloudflareTextDraft(env,job,languageName(job.language), "Create a complete, genuinely useful original digital "+job.product_type+" in "+languageName(job.language)+". Write naturally for readers in "+job.market+". Topic: "+job.opportunity_title+". Occasion: "+job.occasion+". Create 550-700 words with an introduction, 5-6 practical sections, concrete steps and examples, an actionable checklist or worksheet, and a concise conclusion. Return exactly one valid JSON object with string fields title, description (70-100 words), keywords (8-12 comma-separated phrases), and content (550-700 words in Markdown, entirely in "+languageName(job.language)+".");
 }
 const model=env.GEMINI_MODEL||"gemini-3.8-flash",language=languageName(job.language);
 const prompt="Create a complete, genuinely useful original digital "+job.product_type+" in "+language+". Write naturally for readers in "+job.market+". Topic: "+job.opportunity_title+". Occasion: "+job.occasion+". Create 550-700 words of useful, original content, with a short introduction, 5-6 practical sections, concrete steps and examples, one actionable checklist or worksheet, and a concise conclusion. Avoid filler, repeated ideas, invented statistics, guarantees, and copyrighted brands. Return exactly one valid JSON object with string fields title, description (70-100 words), keywords (8-12 comma-separated search phrases, in "+language+"), and content (550-700 words in Markdown, entirely in "+language+").";
 const failures=[],temporaryFailures=[];
 const requestBody=JSON.stringify({systemInstruction:{parts:[{text:"You are a professional digital publishing editor. Produce original, accurate, commercially useful content in "+language+". Follow the requested JSON format exactly."}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0.35,maxOutputTokens:6000,responseMimeType:"application/json"}});
 for(let keyIndex=0;keyIndex<available.length;keyIndex++){
  const secretName=available[keyIndex];
  console.log("FACTORY_GEMINI_KEY_ATTEMPT",JSON.stringify({provider_key:secretName,key_position:keyIndex+1,key_count:available.length,language:job.language}));
  let response,raw,payload={},message="";
  for(let attempt=0;attempt<2;attempt++){
   try{response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":env[secretName]},body:requestBody,signal:AbortSignal.timeout(45000)});}catch(fetchError){temporaryFailures.push(secretName+": request timeout/network error: "+String(fetchError?.message||fetchError));response=null;break;}
   raw=await response.text();payload={};try{payload=JSON.parse(raw)}catch(_){}
   if(response.ok)break;
   message=payload?.error?.message||raw.slice(0,500)||("Gemini HTTP "+response.status);
   if(response.status!==503||attempt===1)break;
   const retryAfter=Number(response.headers.get("retry-after"));
   const waitMs=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(retryAfter*1000,5000):1200;
   await new Promise(resolve=>setTimeout(resolve,waitMs));
  }
  if(!response){console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:available[keyIndex+1]||null,reason:"network_timeout_or_connection_error"}));continue;}
  if(!response.ok){
   if(quotaError(response.status,message)){
    const blockedUntil=retryAtFromMessage(message,6*60*60*1000);
    await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'exhausted',?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='exhausted',last_error=excluded.last_error,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP").bind(secretName,String(message).slice(0,800),blockedUntil).run();
    failures.push(secretName+": "+message);console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:available[keyIndex+1]||null,reason:"quota_or_rate_limit",status:response.status}));continue;
   }
   if(response.status===503||response.status===500||response.status===502||response.status===504){
    temporaryFailures.push(secretName+": HTTP "+response.status+" "+message);
    console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:available[keyIndex+1]||null,reason:"temporary_server_error",status:response.status}));
    continue;
   }
   if(response.status===400&&/user location is not supported|location.*not supported/i.test(message)){
    await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'invalid',?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='invalid',last_error=excluded.last_error,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(secretName,String(message).slice(0,800)).run();
    failures.push(secretName+": unsupported request origin: "+message);
    console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:available[keyIndex+1]||"CLOUDFLARE_WORKERS_AI",reason:"unsupported_request_location",status:400}));
    continue;
   }
   if(response.status===401||response.status===403){
    await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'invalid',?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='invalid',last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP").bind(secretName,String(message).slice(0,800)).run();
    failures.push(secretName+": "+message);console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:available[keyIndex+1]||null,reason:"invalid_key",status:response.status}));continue;
   }
   throw new Error("GEMINI_"+response.status+":"+message);
  }
  const generated=payload?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\n")||"";
  if(!generated){
   const detail=JSON.stringify(payload.promptFeedback||payload.error||{message:"empty response"});
   temporaryFailures.push(secretName+": empty or blocked response: "+detail.slice(0,400));
   console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:keys[keys.indexOf(secretName)+1]||null,reason:"empty_or_blocked_response"}));
   continue;
  }
  let draft;
  try{draft=parseDraft(generated)}catch(draftError){
   temporaryFailures.push(secretName+": invalid or incomplete JSON draft: "+String(draftError?.message||draftError).slice(0,300));
   console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:keys[keys.indexOf(secretName)+1]||null,reason:"invalid_draft"}));
   continue;
  }
  await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'active',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='active',last_error=NULL,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(secretName).run();
  console.log("FACTORY_GEMINI_KEY_SUCCESS",JSON.stringify({provider_key:secretName}));
  draft._gemini_key_used=secretName;return await completeDraftContent(env,job,draft,language);
 }
 console.log("FACTORY_GEMINI_POOL_FALLBACK",JSON.stringify({failedKeys:failures.length,temporaryFailures:temporaryFailures.length}));
 try{
  return await generateCloudflareTextDraft(env,job,language,prompt);
 }catch(fallbackError){
  const fallbackMessage=String(fallbackError?.message||fallbackError);
  if(/quota|rate.?limit|neuron|daily allocation|resource.?exhausted|429/i.test(fallbackMessage)){
   const next=new Date();next.setUTCHours(24,0,0,0);
   await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES('CLOUDFLARE_WORKERS_AI_TEXT','exhausted',?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='exhausted',last_error=excluded.last_error,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP").bind(fallbackMessage.slice(0,800),next.toISOString()).run();
   throw new Error("CLOUDFLARE_AI_QUOTA_EXHAUSTED: Workers AI daily free allocation is exhausted; retry after 00:00 UTC. "+fallbackMessage);
  }
  if(/temporarily|overload|high demand|503|timeout|network|capacity/i.test(fallbackMessage))throw new Error("GEMINI_TEMPORARY_UNAVAILABLE: both Gemini and Cloudflare Workers AI are temporarily unavailable. "+fallbackMessage);
  throw new Error("GEMINI_AND_CLOUDFLARE_FALLBACK_FAILED: Gemini keys unavailable; Cloudflare Workers AI fallback failed: "+fallbackMessage);
 }
}
async function generateCloudflareCover(env,id,title,market,productType,description,occasion){
 await ensureFactoryTables(env);
 const provider="CLOUDFLARE_WORKERS_AI_IMAGE";
 const state=await supabaseDB(env).prepare("SELECT state,blocked_until FROM factory_provider_state WHERE provider_key=?").bind(provider).first();
 if(state?.state==="exhausted"&&state.blocked_until&&Date.parse(state.blocked_until)>Date.now())return {imageKey:"covers/"+id+".svg",contentType:"image/svg+xml",generated:false,fallback:true,reason:"Cloudflare Workers AI daily allocation is exhausted"};
 const prompt="Create a premium, visually striking portrait 3:4 editorial cover artwork for a digital "+productType+". Product title: "+String(title).slice(0,120)+". Description and subject: "+String(description).slice(0,500)+". Audience/market: "+market+". Occasion: "+occasion+". Show one clear relevant visual concept, sophisticated composition, refined typography-free artwork, clean focal point, professional commercial publishing quality. Absolutely no words, letters, numbers, logos, watermarks, mockup frames, or text on the image.";
 try{
  const result=await env.AI.run("@cf/black-forest-labs/flux-1-schnell",{prompt,steps:4});
  if(!result?.image)throw new Error("Cloudflare image model returned no image.");
  const binary=atob(result.image),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  if(bytes.length<5000)throw new Error("Cloudflare image model returned an incomplete image.");
  const key="covers/"+id+".jpg";
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:"image/jpeg",cacheControl:"public, max-age=86400"}});
  await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'active',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='active',last_error=NULL,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(provider).run();
  return {imageKey:key,contentType:"image/jpeg",generated:true,fallback:false};
 }catch(error){
  const message=String(error?.message||error);
  const dailyLimit=/3036|429|rate.?limit|quota|resource.?exhausted|free.?allocation|daily.*limit|10,000 neurons|account limited/i.test(message);
  if(dailyLimit){
   const next=new Date();next.setUTCHours(24,0,0,0);
   await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'exhausted',?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='exhausted',last_error=excluded.last_error,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP").bind(provider,"Cloudflare Workers AI daily image allocation exhausted: "+message.slice(0,500),next.toISOString()).run();
  }else{
   await supabaseDB(env).prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'fallback',?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='fallback',last_error=excluded.last_error,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(provider,message.slice(0,800)).run();
  }
  console.log("FACTORY_CLOUDFLARE_IMAGE_FALLBACK",message);
  return {imageKey:"covers/"+id+".svg",contentType:"image/svg+xml",generated:false,fallback:true,reason:message};
 }
}
function pdfEscape(s){return String(s||"").replace(/[^\x20-\xFF]/g,"?").replace(/([\\()])/g,"\\$1")}
function makePdf(title,body){
 const W=612,H=792,L=48,R=48,WIDTH=W-L-R,BOTTOM=48;let pages=[],ops=[],y=738;
 const page=()=>{pages.push(ops.join("\n"));ops=[];y=738};