async function auth(request,env){const h=request.headers;const admin=(!!env.ADMIN_PASSWORD&&(h.get("x-admin-token")||"")===env.ADMIN_PASSWORD);const configuredCron=(!!env.FACTORY_CRON_SECRET&&(h.get("x-factory-cron")||"")===env.FACTORY_CRON_SECRET);if(admin||configuredCron)return true;const supplied=h.get("x-factory-cron")||"";if(!supplied)return false;try{const row=await env.DB.prepare("SELECT token FROM factory_scheduler_auth WHERE id=1").first();return !!row?.token&&supplied===row.token}catch(_){return false}}
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
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS factory_provider_state (provider_key TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'active',last_error TEXT,blocked_until TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS factory_queue_lock (id INTEGER PRIMARY KEY CHECK(id=1),lock_token TEXT,lock_until TEXT)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS factory_retry_state (job_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS factory_retry_schedule (job_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,next_retry_at TEXT NOT NULL,reason TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
}
function quotaError(status,message){const m=String(message||"").toLowerCase();return status===429||m.includes("resource_exhausted")||m.includes("quota")||m.includes("rate limit")||m.includes("rate_limit")||m.includes("free_tier")}
function retryAtFromMessage(message,fallbackMs=6*60*60*1000){
 const s=String(message||"");const m=s.match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?/i);
 if(!m)return new Date(Date.now()+fallbackMs).toISOString();
 const ms=(Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0))*1000;
 return new Date(Date.now()+Math.max(60000,ms||fallbackMs)).toISOString();
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
 const words=String(draft.content||"").trim().split(/\\s+/).filter(Boolean).length;
 if(!draft.title||!draft.description||words<500)throw new Error("CLOUDFLARE_AI_INCOMPLETE: fallback model returned an incomplete product ("+words+" words).");
 draft._gemini_key_used="CLOUDFLARE_WORKERS_AI:"+model;
 await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES('CLOUDFLARE_WORKERS_AI_TEXT','active',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='active',last_error=NULL,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").run();
 console.log("FACTORY_TEXT_FALLBACK_SUCCESS",JSON.stringify({provider:"CLOUDFLARE_WORKERS_AI",model,language:job.language,words}));
 return draft;
}
async function generateDraft(env,job){
 await ensureFactoryTables(env);
 // Consume the three free-tier projects in a strict, predictable order.
 // The selected language is carried in the prompt, so any configured key can serve any language.
 const keys=["GEMINI_EN_API_KEY","GEMINI_FR_API_KEY","GEMINI_ES_API_KEY"].filter(k=>!!env[k]);
 if(!keys.length){console.log("FACTORY_NO_GEMINI_KEYS_USING_CLOUDFLARE_AI");return await generateCloudflareTextDraft(env,job,languageName(job.language),"Create a complete, genuinely useful original digital "+job.product_type+" in "+languageName(job.language)+". Write naturally for readers in "+job.market+". Topic: "+job.opportunity_title+". Occasion: "+job.occasion+". Create 550-700 words with an introduction, 5-6 practical sections, concrete steps and examples, an actionable checklist or worksheet, and a concise conclusion. Return exactly one valid JSON object with string fields title, description (70-100 words), keywords (8-12 comma-separated phrases), and content (550-700 words in Markdown, entirely in "+languageName(job.language)+".");}
 const {results:states=[]}=await env.DB.prepare("SELECT provider_key,state,blocked_until FROM factory_provider_state").all();
 const map=new Map(states.map(x=>[x.provider_key,x]));
 // Normalize legacy rows where a quota error was recorded but the provider state remained active.
 for(const key of keys){
  const state=map.get(key);
  if(state&&state.state!=="exhausted"&&state.last_error&&quotaError(0,state.last_error)){
   const blockedUntil=retryAtFromMessage(state.last_error,6*60*60*1000);
   await env.DB.prepare("UPDATE factory_provider_state SET state='exhausted',blocked_until=?,updated_at=CURRENT_TIMESTAMP WHERE provider_key=?").bind(blockedUntil,key).run();
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
    await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'exhausted',?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='exhausted',last_error=excluded.last_error,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP").bind(secretName,String(message).slice(0,800),blockedUntil).run();
    failures.push(secretName+": "+message);console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:available[keyIndex+1]||null,reason:"quota_or_rate_limit",status:response.status}));continue;
   }
   if(response.status===503||response.status===500||response.status===502||response.status===504){
    temporaryFailures.push(secretName+": HTTP "+response.status+" "+message);
    console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:available[keyIndex+1]||null,reason:"temporary_server_error",status:response.status}));
    continue;
   }
   if(response.status===400&&/user location is not supported|location.*not supported/i.test(message)){
    await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'invalid',?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='invalid',last_error=excluded.last_error,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(secretName,String(message).slice(0,800)).run();
    failures.push(secretName+": unsupported request origin: "+message);
    console.log("FACTORY_GEMINI_KEY_FAILOVER",JSON.stringify({provider_key:secretName,next_provider:available[keyIndex+1]||"CLOUDFLARE_WORKERS_AI",reason:"unsupported_request_location",status:400}));
    continue;
   }
   if(response.status===401||response.status===403){
    await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'invalid',?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='invalid',last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP").bind(secretName,String(message).slice(0,800)).run();
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
  await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'active',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='active',last_error=NULL,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(secretName).run();
  console.log("FACTORY_GEMINI_KEY_SUCCESS",JSON.stringify({provider_key:secretName}));
  draft._gemini_key_used=secretName;return draft;
 }
 console.log("FACTORY_GEMINI_POOL_FALLBACK",JSON.stringify({failedKeys:failures.length,temporaryFailures:temporaryFailures.length}));
 try{
  return await generateCloudflareTextDraft(env,job,language,prompt);
 }catch(fallbackError){
  const fallbackMessage=String(fallbackError?.message||fallbackError);
  if(/quota|rate.?limit|neuron|daily allocation|resource.?exhausted|429/i.test(fallbackMessage)){
   const next=new Date();next.setUTCHours(24,0,0,0);
   await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES('CLOUDFLARE_WORKERS_AI_TEXT','exhausted',?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='exhausted',last_error=excluded.last_error,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP").bind(fallbackMessage.slice(0,800),next.toISOString()).run();
   throw new Error("CLOUDFLARE_AI_QUOTA_EXHAUSTED: Workers AI daily free allocation is exhausted; retry after 00:00 UTC. "+fallbackMessage);
  }
  if(/temporarily|overload|high demand|503|timeout|network|capacity/i.test(fallbackMessage))throw new Error("GEMINI_TEMPORARY_UNAVAILABLE: both Gemini and Cloudflare Workers AI are temporarily unavailable. "+fallbackMessage);
  throw new Error("GEMINI_AND_CLOUDFLARE_FALLBACK_FAILED: Gemini keys unavailable; Cloudflare Workers AI fallback failed: "+fallbackMessage);
 }
}
async function generateCloudflareCover(env,id,title,market,productType,description,occasion){
 await ensureFactoryTables(env);
 const provider="CLOUDFLARE_WORKERS_AI_IMAGE";
 const state=await env.DB.prepare("SELECT state,blocked_until FROM factory_provider_state WHERE provider_key=?").bind(provider).first();
 if(state?.state==="exhausted"&&state.blocked_until&&Date.parse(state.blocked_until)>Date.now())return {imageKey:"covers/"+id+".svg",contentType:"image/svg+xml",generated:false,fallback:true,reason:"Cloudflare Workers AI daily allocation is exhausted"};
 const prompt="Create a premium, visually striking portrait 3:4 editorial cover artwork for a digital "+productType+". Product title: "+String(title).slice(0,120)+". Description and subject: "+String(description).slice(0,500)+". Audience/market: "+market+". Occasion: "+occasion+". Show one clear relevant visual concept, sophisticated composition, refined typography-free artwork, clean focal point, professional commercial publishing quality. Absolutely no words, letters, numbers, logos, watermarks, mockup frames, or text on the image.";
 try{
  const result=await env.AI.run("@cf/black-forest-labs/flux-1-schnell",{prompt,steps:4});
  if(!result?.image)throw new Error("Cloudflare image model returned no image.");
  const binary=atob(result.image),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  if(bytes.length<5000)throw new Error("Cloudflare image model returned an incomplete image.");
  const key="covers/"+id+".jpg";
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:"image/jpeg",cacheControl:"public, max-age=86400"}});
  await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'active',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='active',last_error=NULL,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(provider).run();
  return {imageKey:key,contentType:"image/jpeg",generated:true,fallback:false};
 }catch(error){
  const message=String(error?.message||error);
  const dailyLimit=/3036|429|rate.?limit|quota|resource.?exhausted|free.?allocation|daily.*limit|10,000 neurons|account limited/i.test(message);
  if(dailyLimit){
   const next=new Date();next.setUTCHours(24,0,0,0);
   await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'exhausted',?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='exhausted',last_error=excluded.last_error,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP").bind(provider,"Cloudflare Workers AI daily image allocation exhausted: "+message.slice(0,500),next.toISOString()).run();
  }else{
   await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'fallback',?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='fallback',last_error=excluded.last_error,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(provider,message.slice(0,800)).run();
  }
  console.log("FACTORY_CLOUDFLARE_IMAGE_FALLBACK",message);
  return {imageKey:"covers/"+id+".svg",contentType:"image/svg+xml",generated:false,fallback:true,reason:message};
 }
}
function pdfEscape(s){return String(s||"").replace(/[^\x20-\xFF]/g,"?").replace(/([\\()])/g,"\\$1")}
function makePdf(title,body){
 const W=612,H=792,L=48,R=48,WIDTH=W-L-R,BOTTOM=48;let pages=[],ops=[],y=738;
 const page=()=>{pages.push(ops.join("\n"));ops=[];y=738};
 const need=h=>{if(y-h<BOTTOM)page()};
 const text=(s,x,yy,size=10,bold=false,color="0.16 0.20 0.25")=>ops.push("BT /"+(bold?"F2":"F1")+" "+size+" Tf "+color+" rg 1 0 0 1 "+x+" "+yy+" Tm ("+pdfEscape(s)+") Tj ET");
 const line=(yy,color="0.82 0.84 0.86",w=0.7)=>ops.push(color+" RG "+w+" w "+L+" "+yy+" m "+(W-R)+" "+yy+" l S");
 const box=(x,yy,w,h,fill)=>ops.push(fill+" rg 0.75 0.78 0.81 RG 0.6 w "+x+" "+(yy-h)+" "+w+" "+h+" re B");
 const wrap=(s,n)=>{let out=[],cur="";for(const word of String(s||"").replace(/\s+/g," ").trim().split(" ")){if(cur&&cur.length+word.length+1>n){out.push(cur);cur=word}else cur+=(cur?" ":"")+word}if(cur)out.push(cur);return out.length?out:[""]};
 const plain=s=>String(s||"").replace(/\*\*(.*?)\*\*/g,"$1").replace(/\*(.*?)\*/g,"$1").replace(/~~(.*?)~~/g,"$1").trim();
 const paragraph=(s)=>{let ls=wrap(plain(s),96);need(ls.length*15+10);for(const v of ls){text(v,L,y,10.2);y-=15}y-=8};
 const heading=(s,n)=>{let z=n===1?21:n===2?16:13;need(z+30);y-=5;text(plain(s),L,y,z,true,"0.12 0.23 0.35");y-=z+8;line(y,"0.82 0.68 0.42",1);y-=14};
 const list=(items,ordered)=>{items.forEach((v,i)=>{let ls=wrap(plain(v),91);need(ls.length*15+5);text(ordered?(i+1)+".":"•",L+2,y,10,true,"0.20 0.38 0.50");for(const q of ls){text(q,L+22,y,10);y-=15}y-=3});y-=5};
 const table=rows=>{if(!rows.length)return;let n=Math.max(...rows.map(r=>r.length));rows=rows.map(r=>Array.from({length:n},(_,i)=>plain(r[i]||"")));let weights=Array.from({length:n},(_,i)=>Math.max(9,...rows.map(r=>Math.min(32,(r[i]||"").length+2))));let total=weights.reduce((x,v)=>x+v,0),ws=weights.map(v=>WIDTH*v/total);
 const draw=(r,head)=>{let ls=r.map((v,i)=>wrap(v,Math.max(7,Math.floor((ws[i]-12)/5.2)))),h=Math.max(27,...ls.map(x=>x.length*12+14));if(y-h<BOTTOM){page();if(!head)draw(rows[0],true)}let x=L;for(let i=0;i<n;i++){box(x,y,ws[i],h,head?"0.90 0.93 0.96":"1 1 1");ls[i].forEach((v,j)=>text(v,x+6,y-16-j*12,8.3,head));x+=ws[i]}y-=h};
 draw(rows[0],true);for(let i=1;i<rows.length;i++)draw(rows[i],false);y-=12};
 let blocks=[],p=[],li=[],ordered=false,t=[];
 const fp=()=>{if(p.length){blocks.push({k:"p",v:p.join(" ")});p=[]}},fl=()=>{if(li.length){blocks.push({k:"l",v:li,o:ordered});li=[]}},ft=()=>{if(t.length){blocks.push({k:"t",v:t});t=[]}};
 for(const raw of String(body||"").replace(/\r/g,"").split("\n")){let s=raw.trim();if(!s){fp();fl();ft();continue}
 if(/^\|.*\|$/.test(s)){fp();fl();let cells=s.replace(/^\|/,"").replace(/\|$/,"").split("|").map(x=>x.trim());if(cells.every(x=>/^:?-{2,}:?$/.test(x)))continue;t.push(cells);continue}
 ft();let h=s.match(/^(#{1,3})\s+(.+)$/);if(h){fp();fl();blocks.push({k:"h",v:h[2],n:h[1].length});continue}
 let m=s.match(/^([-*+]|\d+[.)])\s+(.+)$/);if(m){fp();let ord=/^\d/.test(m[1]);if(li.length&&ord!==ordered)fl();ordered=ord;li.push(m[2]);continue}
 if(/^---+$/.test(s)){fp();fl();blocks.push({k:"r"});continue}fl();p.push(s)}
 fp();fl();ft();
 text(plain(title).toUpperCase(),L,y,22,true,"0.10 0.20 0.32");y-=34;line(y,"0.82 0.68 0.42",2);y-=24;
 for(const b of blocks){if(b.k==="h")heading(b.v,b.n);else if(b.k==="p")paragraph(b.v);else if(b.k==="l")list(b.v,b.o);else if(b.k==="t")table(b.v);else{need(16);line(y);y-=16}}
 if(ops.length)page();
 let objs=[];objs[1]="<< /Type /Catalog /Pages 2 0 R >>";objs[3]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";objs[4]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";let kids=[];
 for(let i=0;i<pages.length;i++){let q=5+i*2,c=q+1;kids.push(q+" 0 R");objs[q]="<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+W+" "+H+"] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents "+c+" 0 R >>";objs[c]="<< /Length "+pages[i].length+" >>\nstream\n"+pages[i]+"\nendstream"}
 objs[2]="<< /Type /Pages /Kids ["+kids.join(" ")+"] /Count "+pages.length+" >>";let out="%PDF-1.4\n",off=[0];for(let i=1;i<objs.length;i++){off[i]=out.length;out+=i+" 0 obj\n"+objs[i]+"\nendobj\n"}let x=out.length;out+="xref\n0 "+objs.length+"\n0000000000 65535 f \n";for(let i=1;i<objs.length;i++)out+=String(off[i]).padStart(10,"0")+" 00000 n \n";out+="trailer\n<< /Size "+objs.length+" /Root 1 0 R >>\nstartxref\n"+x+"\n%%EOF";return Uint8Array.from(out,ch=>ch.charCodeAt(0))
}
function xml(s){return String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function makeCover(title,market){const t=xml(title).slice(0,110),m=xml(market);return '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#101c3b"/><stop offset="1" stop-color="#315b75"/></linearGradient></defs><rect width="900" height="1200" fill="url(#g)"/><circle cx="720" cy="260" r="190" fill="#d5a85b" opacity=".18"/><circle cx="160" cy="980" r="260" fill="#8db7a6" opacity=".13"/><path d="M90 160H810M90 1040H810" stroke="#d5a85b" stroke-width="3"/><text x="90" y="220" fill="#e9c987" font-family="Arial" font-size="28" letter-spacing="7">DIGITALNEST WORKBOOK</text><foreignObject x="90" y="380" width="720" height="420"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;color:#fff;font-size:64px;font-weight:700;line-height:1.15;overflow-wrap:anywhere">'+t+'</div></foreignObject><text x="90" y="930" fill="#dce8e8" font-family="Arial" font-size="26">'+m.toUpperCase()+' EDITION</text><text x="90" y="1100" fill="#e9c987" font-family="Arial" font-size="24" letter-spacing="5">PLAN · REFLECT · TAKE ACTION</text></svg>'}
async function processSingle(context){
 const {request,env}=context;
 if(!await auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 await ensureFactoryTables(env);
 const lockToken=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO factory_queue_lock(id,lock_token,lock_until) VALUES(1,?,datetime('now','+10 minutes')) ON CONFLICT(id) DO UPDATE SET lock_token=excluded.lock_token,lock_until=excluded.lock_until WHERE factory_queue_lock.lock_until<CURRENT_TIMESTAMP OR factory_queue_lock.lock_token IS NULL").bind(lockToken).run();
 const lock=await env.DB.prepare("SELECT lock_token FROM factory_queue_lock WHERE id=1").first();
 if(lock?.lock_token!==lockToken)return Response.json({error:"Another production task is already running. The queue is sequential; wait for it to finish."},{status:409});
  // Recover a job only after this worker has acquired the queue lock; this means the previous lease expired.
  await env.DB.prepare("UPDATE factory_jobs SET status='queued',stage='queued',error='Recovered automatically after a stalled worker timeout.',updated_at=CURRENT_TIMESTAMP WHERE status='running' AND updated_at < datetime('now','-10 minutes')").run();
 let activeJobId=null;
 try{
  const settings=await env.DB.prepare("SELECT * FROM factory_settings WHERE id=1").first();
  if(!settings?.enabled)return Response.json({error:"Factory is disabled."},{status:409});
  // Requeue only jobs whose scheduled retry time has arrived.
  const due=await env.DB.prepare("SELECT job_id FROM factory_retry_schedule WHERE next_retry_at<=CURRENT_TIMESTAMP").all();
  if(due.results?.length){
   await env.DB.prepare("UPDATE factory_jobs SET status='queued',stage='queued',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='deferred' AND id IN (SELECT job_id FROM factory_retry_schedule WHERE next_retry_at<=CURRENT_TIMESTAMP)").run();
   await env.DB.prepare("DELETE FROM factory_retry_schedule WHERE next_retry_at<=CURRENT_TIMESTAMP").run();
  }
  // No daily product cap: process queued jobs sequentially until the queue is empty
  // or every configured Gemini key reports exhausted quota.
  const body=await request.clone().json().catch(()=>({}));
  const requestedLanguage=body.language?String(body.language):null;
  const job=await env.DB.prepare("SELECT j.*,o.title opportunity_title FROM factory_jobs j JOIN factory_opportunities o ON o.id=j.opportunity_id WHERE j.status='queued' AND (? IS NULL OR upper(substr(j.language,1,2))=upper(substr(?,1,2))) ORDER BY o.opportunity_score DESC,j.created_at LIMIT 1").bind(requestedLanguage,requestedLanguage).first();
  if(!job)return Response.json({ok:true,empty:true,message:"No queued jobs remain."});
  activeJobId=job.id;
  const claim=await env.DB.prepare("UPDATE factory_jobs SET status='running',stage='drafting',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(job.id).run();
  if(!claim.meta?.changes)return Response.json({ok:false,error:"Job was claimed by another worker; retry queue status."},{status:409});
  const data=await generateDraft(env,job);
  const wordCount=String(data.content||"").trim().split(/\s+/).filter(Boolean).length;
  const keywords=Array.isArray(data.keywords)?data.keywords.join(", "):String(data.keywords||"");
  if(!data.title||!data.description||keywords.split(",").filter(x=>x.trim()).length<5||wordCount<500)throw new Error("Quality check failed: content must contain at least 500 words and complete product details.");
  await env.DB.prepare("UPDATE factory_jobs SET stage='creating_pdf',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.id).run();
  const bytes=makePdf(data.title,data.content);
  if(bytes.length<2500||new TextDecoder().decode(bytes.slice(0,8))!=="%PDF-1.4")throw new Error("PDF validation failed.");
  const id=crypto.randomUUID();
  let slug=String(data.title).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,75)||"digital-product";
  slug=slug+"-"+id;
  const key="products/"+id+"/digitalnest-generated.pdf";
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:"application/pdf"}});
  await env.DB.prepare("UPDATE factory_jobs SET stage='designing_cover',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.id).run();
  const cover=await generateCloudflareCover(env,id,data.title,job.market,job.product_type,data.description,job.occasion);
  if(cover.fallback){
   const fallback=new TextEncoder().encode(makeCover(data.title,job.market));
   await env.FILES.put(cover.imageKey,fallback,{httpMetadata:{contentType:"image/svg+xml",cacheControl:"public, max-age=86400"}});
  }
  const imageUrl="/media/"+cover.imageKey;
  const status=settings.auto_publish?"published":"draft";
  await env.DB.prepare("INSERT INTO products (id,slug,title,description,category,language,market,occasion,keywords,price,file_key,file_name,file_type,image_key,image_url,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,slug,String(data.title).trim(),String(data.description).trim(),job.product_type,languageName(job.language),job.market,job.occasion,keywords,5,key,"digitalnest-generated.pdf","application/pdf",cover.imageKey,imageUrl,status).run();
  if(status==="published"){const {notifyIndexNow}=await import("../_shared/indexnow.js");notifyIndexNow(context,slug)}
  await env.DB.prepare("UPDATE factory_jobs SET status=?,stage='quality_passed',product_slug=?,actual_neurons=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settings.auto_publish?"published":"review",slug,job.id).run();
  await env.DB.prepare("DELETE FROM factory_retry_state WHERE job_id=?").bind(job.id).run();
  await env.DB.prepare("DELETE FROM factory_retry_schedule WHERE job_id=?").bind(job.id).run();
  await env.DB.prepare("UPDATE factory_queue_lock SET lock_token=NULL,lock_until=NULL WHERE id=1 AND lock_token=?").bind(lockToken).run();
  const nextCount=await env.DB.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  if(Number(nextCount?.n||0)>0){const internalSecret=env.FACTORY_CRON_SECRET||env.ADMIN_PASSWORD;if(internalSecret){const nextUrl=new URL(request.url);context.waitUntil(fetch(nextUrl.toString(),{method:"POST",headers:{"content-type":"application/json",[env.FACTORY_CRON_SECRET?"x-factory-cron":"x-admin-token"]:internalSecret},body:"{}"}).then(r=>{if(!r.ok)console.log("FACTORY_QUEUE_CHAIN_STATUS",r.status)}).catch(e=>console.log("FACTORY_QUEUE_CHAIN_ERROR",String(e))))}}
  return Response.json({ok:true,status,slug,title:data.title,wordCount,geminiKeyUsed:data._gemini_key_used||null,coverGenerated:cover.generated,coverFallback:cover.fallback,coverProvider:"Cloudflare Workers AI",coverReason:cover.reason||null});
 }catch(e){
  if(activeJobId){
   try{
    const message=String(e.message||e);
    const quota=/GEMINI_429|RESOURCE_EXHAUSTED|quota|rate.?limit|GEMINI_POOL_EXHAUSTED|CLOUDFLARE_AI_QUOTA_EXHAUSTED|neurons|daily allocation/i.test(message);
    const temporary=/GEMINI_TEMPORARY_UNAVAILABLE/i.test(message);
    await env.DB.prepare("UPDATE factory_jobs SET status=?,stage=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(quota||temporary?"deferred":"failed",quota?"waiting_for_gemini_quota":temporary?"waiting_for_gemini_service":"failed",message.slice(0,1000),activeJobId).run();
    if(quota||temporary){
     let attempts=0,nextAt;
     if(quota){
      const states=await env.DB.prepare("SELECT blocked_until,last_error,updated_at FROM factory_provider_state WHERE provider_key LIKE 'GEMINI_%_API_KEY' AND state='exhausted'").all();
      const dates=(states.results||[]).map(s=>s.blocked_until||retryAtFromMessage(s.last_error,6*60*60*1000)).filter(Boolean).sort();
      nextAt=dates[0]||retryAtFromMessage(message,6*60*60*1000);
     }else{
      const old=await env.DB.prepare("SELECT attempts FROM factory_retry_schedule WHERE job_id=?").bind(activeJobId).first();
      attempts=Number(old?.attempts||0)+1;
      const delays=[60,120,300,900,1800,3600];
      nextAt=new Date(Date.now()+delays[Math.min(attempts-1,delays.length-1)]*1000).toISOString();
     }
     await env.DB.prepare("INSERT INTO factory_retry_schedule(job_id,attempts,next_retry_at,reason,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(job_id) DO UPDATE SET attempts=excluded.attempts,next_retry_at=excluded.next_retry_at,reason=excluded.reason,updated_at=CURRENT_TIMESTAMP").bind(activeJobId,attempts,nextAt,quota?"quota":"temporary").run();
     console.log("FACTORY_JOB_RETRY_SCHEDULED",JSON.stringify({job_id:activeJobId,reason:quota?"quota":"temporary",attempts,next_retry_at:nextAt}));
    }
   }catch(_){}
  }
  const quota=/GEMINI_429|RESOURCE_EXHAUSTED|quota|rate.?limit|MISSING_GEMINI_KEY|GEMINI_POOL_EXHAUSTED|CLOUDFLARE_AI_QUOTA_EXHAUSTED|neurons|daily allocation/i.test(String(e.message||e));
  const temporary=/GEMINI_TEMPORARY_UNAVAILABLE/i.test(String(e.message||e));
  return Response.json({error:e.message||"Factory processing failed.",quotaExhausted:quota,temporaryUnavailable:temporary,jobKeptQueued:temporary},{status:quota?429:temporary?503:502});
 }finally{
  await env.DB.prepare("UPDATE factory_queue_lock SET lock_token=NULL,lock_until=NULL WHERE id=1 AND lock_token=?").bind(lockToken).run().catch(()=>{});
 }
}
export async function onRequestPost(context){
 return processSingle(context);
}
