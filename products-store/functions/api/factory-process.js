function auth(request,env){const h=request.headers;return (!!env.ADMIN_PASSWORD&&(h.get("x-admin-token")||"")===env.ADMIN_PASSWORD)|| (!!env.FACTORY_CRON_SECRET&&(h.get("x-factory-cron")||"")===env.FACTORY_CRON_SECRET)}
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
}
function quotaError(status,message){const m=String(message||"").toLowerCase();return status===429||m.includes("resource_exhausted")||m.includes("quota")||m.includes("rate limit")||m.includes("rate_limit")||m.includes("free_tier")}
async function generateDraft(env,job){
 await ensureFactoryTables(env);
 const preferred="GEMINI_"+languageCode(job.language)+"_API_KEY";
 const keys=[preferred,"GEMINI_EN_API_KEY","GEMINI_FR_API_KEY","GEMINI_ES_API_KEY"].filter((k,i,a)=>a.indexOf(k)===i&&!!env[k]);
 if(!keys.length)throw new Error("MISSING_GEMINI_KEY: configure at least one Gemini API key.");
 const {results:states=[]}=await env.DB.prepare("SELECT provider_key,state,blocked_until FROM factory_provider_state").all();
 const map=new Map(states.map(x=>[x.provider_key,x]));
 const available=keys.filter(k=>{const s=map.get(k);return !s||s.state==="active"||s.state==="unknown"||(s.blocked_until&&Date.parse(s.blocked_until)<=Date.now())});
 if(!available.length)throw new Error("GEMINI_POOL_EXHAUSTED: all configured Gemini keys are marked quota-limited or invalid. Check quota, then choose Resume in the factory.");
 const model=env.GEMINI_MODEL||"gemini-3.8-flash",language=languageName(job.language);
 const prompt="Create a complete, genuinely useful original digital "+job.product_type+" in "+language+". Write naturally for readers in "+job.market+". Topic: "+job.opportunity_title+". Occasion: "+job.occasion+". Create 550-700 words of useful, original content, with a short introduction, 5-6 practical sections, concrete steps and examples, one actionable checklist or worksheet, and a concise conclusion. Avoid filler, repeated ideas, invented statistics, guarantees, and copyrighted brands. Return exactly one valid JSON object with string fields title, description (70-100 words), keywords (8-12 comma-separated search phrases, in "+language+"), and content (550-700 words in Markdown, entirely in "+language+").";
 const failures=[];
 for(const secretName of available){
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":env[secretName]},body:JSON.stringify({systemInstruction:{parts:[{text:"You are a professional digital publishing editor. Produce original, accurate, commercially useful content in "+language+". Follow the requested JSON format exactly."}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0.35,maxOutputTokens:6000,responseMimeType:"application/json"}})});
  const raw=await response.text();let payload={};try{payload=JSON.parse(raw)}catch(_){}
  if(!response.ok){
   const message=payload?.error?.message||raw.slice(0,500)||("Gemini HTTP "+response.status);
   if(quotaError(response.status,message)){
    await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'exhausted',?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='exhausted',last_error=excluded.last_error,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(secretName,String(message).slice(0,800)).run();
    failures.push(secretName+": "+message);continue;
   }
   if(response.status===401||response.status===403){
    await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'invalid',?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='invalid',last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP").bind(secretName,String(message).slice(0,800)).run();
    failures.push(secretName+": "+message);continue;
   }
   throw new Error("GEMINI_"+response.status+":"+message);
  }
  const generated=payload?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\\n")||"";
  if(!generated)throw new Error("Gemini returned an empty draft: "+JSON.stringify(payload.promptFeedback||{}));
  await env.DB.prepare("INSERT INTO factory_provider_state(provider_key,state,last_error,blocked_until,updated_at) VALUES(?,'active',NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT(provider_key) DO UPDATE SET state='active',last_error=NULL,blocked_until=NULL,updated_at=CURRENT_TIMESTAMP").bind(secretName).run();
  const draft=parseDraft(generated);draft._gemini_key_used=secretName;return draft;
 }
 throw new Error("GEMINI_POOL_EXHAUSTED: no usable Gemini key remains. "+failures.join(" | "));
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
 if(!auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 await ensureFactoryTables(env);
 const lockToken=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO factory_queue_lock(id,lock_token,lock_until) VALUES(1,?,datetime('now','+10 minutes')) ON CONFLICT(id) DO UPDATE SET lock_token=excluded.lock_token,lock_until=excluded.lock_until WHERE factory_queue_lock.lock_until<CURRENT_TIMESTAMP OR factory_queue_lock.lock_token IS NULL").bind(lockToken).run();
 const lock=await env.DB.prepare("SELECT lock_token FROM factory_queue_lock WHERE id=1").first();
 if(lock?.lock_token!==lockToken)return Response.json({error:"Another production task is already running. The queue is sequential; wait for it to finish."},{status:409});
 let activeJobId=null;
 try{
  const settings=await env.DB.prepare("SELECT * FROM factory_settings WHERE id=1").first();
  if(!settings?.enabled)return Response.json({error:"Factory is disabled."},{status:409});
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
  await env.DB.prepare("UPDATE factory_jobs SET status=?,stage='quality_passed',product_slug=?,actual_neurons=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settings.auto_publish?"published":"review",slug,job.id).run();
  await env.DB.prepare("UPDATE factory_queue_lock SET lock_token=NULL,lock_until=NULL WHERE id=1 AND lock_token=?").bind(lockToken).run();
  const nextCount=await env.DB.prepare("SELECT COUNT(*) AS n FROM factory_jobs WHERE status='queued'").first();
  if(Number(nextCount?.n||0)>0){const internalSecret=env.FACTORY_CRON_SECRET||env.ADMIN_PASSWORD;if(internalSecret){const nextUrl=new URL(request.url);context.waitUntil(fetch(nextUrl.toString(),{method:"POST",headers:{"content-type":"application/json",[env.FACTORY_CRON_SECRET?"x-factory-cron":"x-admin-token"]:internalSecret},body:"{}"}).then(r=>{if(!r.ok)console.log("FACTORY_QUEUE_CHAIN_STATUS",r.status)}).catch(e=>console.log("FACTORY_QUEUE_CHAIN_ERROR",String(e))))}}
  return Response.json({ok:true,status,slug,title:data.title,wordCount,geminiKeyUsed:data._gemini_key_used||null,coverGenerated:cover.generated,coverFallback:cover.fallback,coverProvider:"Cloudflare Workers AI",coverReason:cover.reason||null});
 }catch(e){
  if(activeJobId){
   try{
    const quota=/GEMINI_429|RESOURCE_EXHAUSTED|quota|rate.?limit|MISSING_GEMINI_KEY|GEMINI_POOL_EXHAUSTED/i.test(String(e.message||e));
    await env.DB.prepare("UPDATE factory_jobs SET status=?,stage=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(quota?"deferred":"failed",quota?"waiting_for_gemini":"failed",String(e.message||e).slice(0,1000),activeJobId).run();
   }catch(_){}
  }
  const quota=/GEMINI_429|RESOURCE_EXHAUSTED|quota|rate.?limit|MISSING_GEMINI_KEY|GEMINI_POOL_EXHAUSTED/i.test(String(e.message||e));
  return Response.json({error:e.message||"Factory processing failed.",quotaExhausted:quota},{status:quota?429:502});
 }finally{
  await env.DB.prepare("UPDATE factory_queue_lock SET lock_token=NULL,lock_until=NULL WHERE id=1 AND lock_token=?").bind(lockToken).run().catch(()=>{});
 }
}
export async function onRequestPost(context){
 return processSingle(context);
}
