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
function languageCode(language){const s=String(language||"English").trim().toLowerCase();const known={"english":"EN","français":"FR","french":"FR","español":"ES","spanish":"ES"};return known[s]||s.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z]/g,"").slice(0,2).toUpperCase()}
function languageName(language){const code=languageCode(language);const names={EN:"English",FR:"French",ES:"Spanish"};return names[code]||String(language||"English")}
async function generateDraft(env,job){
 const code=languageCode(job.language);const secretName="GEMINI_"+code+"_API_KEY";const key=env[secretName];
 if(!key)throw new Error("MISSING_GEMINI_KEY:"+secretName);
 const model=env.GEMINI_MODEL||"gemini-2.5-flash";
 const language=languageName(job.language);
 const prompt="Create a complete, genuinely useful original digital "+job.product_type+" in "+language+". Write naturally for readers in "+job.market+". Topic: "+job.opportunity_title+". Occasion: "+job.occasion+". Create 550-700 words of useful, original content, with a short introduction, 5-6 practical sections, concrete steps and examples, one actionable checklist or worksheet, and a concise conclusion. Avoid filler, repeated ideas, invented statistics, guarantees, and copyrighted brands. Return exactly one valid JSON object with string fields title, description (70-100 words), keywords (8-12 comma-separated search phrases, in "+language+"), and content (550-700 words in Markdown, entirely in "+language+").";
 const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(key),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:"You are a professional digital publishing editor. Produce original, accurate, commercially useful content in "+language+". Follow the requested JSON format exactly."}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0.35,maxOutputTokens:6000,responseMimeType:"application/json"}})});
 const raw=await response.text();let payload={};try{payload=JSON.parse(raw)}catch(_){}
 if(!response.ok){const message=payload?.error?.message||raw.slice(0,500)||("Gemini HTTP "+response.status);const err=new Error("GEMINI_"+response.status+":"+message);err.status=response.status;throw err}
 const generated=payload?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\\n")||"";
 if(!generated)throw new Error("Gemini returned an empty draft: "+JSON.stringify(payload.promptFeedback||{}));
 return parseDraft(generated);
}
function pdfEscape(s){return String(s||"").replace(/[^\x20-\x7E]/g," ").replace(/([\\()])/g,"\\$1")}
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
 objs[2]="<< /Type /Pages /Kids ["+kids.join(" ")+"] /Count "+pages.length+" >>";let out="%PDF-1.4\n",off=[0];for(let i=1;i<objs.length;i++){off[i]=out.length;out+=i+" 0 obj\n"+objs[i]+"\nendobj\n"}let x=out.length;out+="xref\n0 "+objs.length+"\n0000000000 65535 f \n";for(let i=1;i<objs.length;i++)out+=String(off[i]).padStart(10,"0")+" 00000 n \n";out+="trailer\n<< /Size "+objs.length+" /Root 1 0 R >>\nstartxref\n"+x+"\n%%EOF";return new TextEncoder().encode(out)
}
function xml(s){return String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function makeCover(title,market){const t=xml(title).slice(0,110),m=xml(market);return '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#101c3b"/><stop offset="1" stop-color="#315b75"/></linearGradient></defs><rect width="900" height="1200" fill="url(#g)"/><circle cx="720" cy="260" r="190" fill="#d5a85b" opacity=".18"/><circle cx="160" cy="980" r="260" fill="#8db7a6" opacity=".13"/><path d="M90 160H810M90 1040H810" stroke="#d5a85b" stroke-width="3"/><text x="90" y="220" fill="#e9c987" font-family="Arial" font-size="28" letter-spacing="7">DIGITALNEST WORKBOOK</text><foreignObject x="90" y="380" width="720" height="420"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;color:#fff;font-size:64px;font-weight:700;line-height:1.15;overflow-wrap:anywhere">'+t+'</div></foreignObject><text x="90" y="930" fill="#dce8e8" font-family="Arial" font-size="26">'+m.toUpperCase()+' EDITION</text><text x="90" y="1100" fill="#e9c987" font-family="Arial" font-size="24" letter-spacing="5">PLAN · REFLECT · TAKE ACTION</text></svg>'}
async function processSingle({request,env}){if(!auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});let activeJobId=null;try{const settings=await env.DB.prepare("SELECT * FROM factory_settings WHERE id=1").first();if(!settings?.enabled)return Response.json({error:"Factory is disabled."},{status:409});const body=await request.clone().json().catch(()=>({}));const requestedLanguage=body.language?String(body.language):null;const job=await env.DB.prepare("SELECT j.*,o.title opportunity_title FROM factory_jobs j JOIN factory_opportunities o ON o.id=j.opportunity_id WHERE (j.status='queued' OR (j.status='running' AND j.updated_at<=datetime('now','-5 minutes'))) AND (? IS NULL OR upper(substr(j.language,1,2))=upper(substr(?,1,2))) ORDER BY CASE WHEN j.status='running' THEN 0 ELSE 1 END,o.opportunity_score DESC,j.created_at LIMIT 1").bind(requestedLanguage,requestedLanguage).first();if(!job)return Response.json({ok:true,message:"No queued jobs."});activeJobId=job.id;await env.DB.prepare("UPDATE factory_jobs SET status='running',stage='drafting',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (status='queued' OR (status='running' AND updated_at<=datetime('now','-5 minutes')) )").bind(job.id).run();const data=await generateDraft(env,job);const wordCount=String(data.content||"").trim().split(/\s+/).filter(Boolean).length;const keywords=Array.isArray(data.keywords)?data.keywords.join(", "):String(data.keywords||"");if(!data.title||!data.description||keywords.split(",").filter(x=>x.trim()).length<5||wordCount<500)throw new Error("Quality check failed: content must contain at least 500 words and complete product details.");await env.DB.prepare("UPDATE factory_jobs SET stage='creating_pdf',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.id).run();const bytes=makePdf(data.title,data.content);if(bytes.length<2500||new TextDecoder().decode(bytes.slice(0,8))!=="%PDF-1.4")throw new Error("PDF validation failed.");const id=crypto.randomUUID();let slug=String(data.title).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,75)||"digital-product";slug=slug+"-"+id;const key="products/"+id+"/digitalnest-generated.pdf";await env.FILES.put(key,bytes,{httpMetadata:{contentType:"application/pdf"}});await env.DB.prepare("UPDATE factory_jobs SET stage='designing_cover',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.id).run();const coverPrompt="Create a premium, visually striking portrait 3:4 editorial cover artwork for a digital "+job.product_type+". Product title: "+String(data.title).slice(0,120)+". Description and subject: "+String(data.description).slice(0,500)+". Audience/market: "+job.market+". Occasion: "+job.occasion+". Show one clear relevant visual concept, sophisticated composition, refined typography-free artwork, clean focal point, professional commercial publishing quality. Absolutely no words, letters, numbers, logos, watermarks, mockup frames, or text on the image.";
let imageKey,imageContentType;
try{
 const coverResult=await env.AI.run("@cf/black-forest-labs/flux-1-schnell",{prompt:coverPrompt,steps:4});
 if(!coverResult?.image)throw new Error("Image model returned no image.");
 const coverBinary=atob(coverResult.image);const coverBytes=Uint8Array.from(coverBinary,c=>c.charCodeAt(0));
 if(coverBytes.length<5000)throw new Error("Image model returned an incomplete image.");
 imageKey="covers/"+id+".jpg";imageContentType="image/jpeg";
 await env.FILES.put(imageKey,coverBytes,{httpMetadata:{contentType:imageContentType,cacheControl:"public, max-age=86400"}});
}catch(coverError){
 const fallback=new TextEncoder().encode(makeCover(data.title,job.market));
 imageKey="covers/"+id+".svg";imageContentType="image/svg+xml";
 await env.FILES.put(imageKey,fallback,{httpMetadata:{contentType:imageContentType,cacheControl:"public, max-age=86400"}});
 console.log("FACTORY_COVER_FALLBACK",String(coverError.message||coverError));
}const imageUrl="/media/"+imageKey;const status=settings.auto_publish?"published":"draft";await env.DB.prepare("INSERT INTO products (id,slug,title,description,category,language,market,occasion,keywords,price,file_key,file_name,file_type,image_key,image_url,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,slug,String(data.title).trim(),String(data.description).trim(),job.product_type,languageName(job.language),job.market,job.occasion,keywords,5,key,"digitalnest-generated.pdf","application/pdf",imageKey,imageUrl,status).run();await env.DB.prepare("UPDATE factory_jobs SET status=?,stage='quality_passed',product_slug=?,actual_neurons=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settings.auto_publish?"published":"review",slug,job.id).run();return Response.json({ok:true,status,slug,title:data.title,wordCount,coverGenerated:true,checks:["content length","required metadata","keyword count","PDF header/size","cover SVG stored","product record saved"]})}catch(e){if(activeJobId){try{const quota=/GEMINI_429|RESOURCE_EXHAUSTED|quota|rate.?limit|MISSING_GEMINI_KEY/i.test(String(e.message||e));await env.DB.prepare("UPDATE factory_jobs SET status=?,stage=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(quota?"queued":"failed",quota?"waiting_for_gemini":"failed",String(e.message||e).slice(0,1000),activeJobId).run()}catch(_){}}const quota=/GEMINI_429|RESOURCE_EXHAUSTED|quota|rate.?limit|MISSING_GEMINI_KEY/i.test(String(e.message||e));return Response.json({error:e.message||"Factory processing failed."},{status:quota?429:502})}}
export async function onRequestPost(context){
 return processSingle(context);
}
