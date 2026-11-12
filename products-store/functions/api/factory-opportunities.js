import {supabaseDB} from "../_shared/supabase-db.js";
const seeds=[["Christmas gift planner","template","United States","Christmas","2026-11-01","2026-12-25",90,62],["Christmas budget workbook","workbook","United Kingdom","Christmas","2026-11-01","2026-12-25",86,55],["Holiday meal planning organizer","template","Canada","Christmas","2026-11-01","2026-12-25",79,52],["New Year goal-setting workbook","workbook","United States","New Year","2026-12-15","2027-01-31",85,50],["Back-to-school student planner","template","United States","Back to School","2027-07-01","2027-09-15",78,52],["Small business expense tracker","template","Global","Evergreen",null,null,76,48],["Freelancer client onboarding guide","guide","Global","Evergreen",null,null,72,45],["Weekly meal planning template","template","United States","Evergreen",null,null,70,60],["Study planner and revision workbook","workbook","United Kingdom","Evergreen",null,null,75,54],["Personal finance starter guide","guide","Global","Evergreen",null,null,80,68],["Home organization checklist bundle","template","Global","Evergreen",null,null,72,48],["Job search and interview workbook","workbook","Global","Evergreen",null,null,78,56],["Social media content planner for small businesses","template","Global","Evergreen",null,null,77,59],["Freelance invoice and payment tracker","template","Global","Evergreen",null,null,82,42],["Freelance project estimation workbook","workbook","Global","Evergreen",null,null,79,44],["Small business inventory control sheet","template","United States","Evergreen",null,null,80,46],["Small business pricing strategy workbook","workbook","United Kingdom","Evergreen",null,null,81,48],["Customer feedback and review tracker","template","Global","Evergreen",null,null,75,43],["Client project handover checklist","template","Global","Evergreen",null,null,73,42],["Email newsletter planning calendar","template","Global","Evergreen",null,null,78,49],["Blog post research and editorial planner","template","Global","Evergreen",null,null,76,51],["Podcast episode production planner","template","United States","Evergreen",null,null,72,46],["Online course launch workbook","workbook","Global","Evergreen",null,null,84,53],["Digital product launch checklist","template","Global","Evergreen",null,null,86,50],["Etsy shop operations planner","template","United States","Evergreen",null,null,83,56],["Website launch project checklist","template","Global","Evergreen",null,null,79,48],["Brand identity planning workbook","workbook","Global","Evergreen",null,null,74,50],["Remote team meeting notes system","template","Global","Evergreen",null,null,70,44],["Personal habit and routine tracker","template","Global","Evergreen",null,null,82,61],["Debt payoff planning workbook","workbook","United States","Evergreen",null,null,85,55],["Emergency fund savings planner","workbook","United Kingdom","Evergreen",null,null,80,51],["Monthly household budget dashboard","template","Canada","Evergreen",null,null,87,59],["Moving house planning checklist","template","Global","Evergreen",null,null,77,48],["Wedding budget and vendor organizer","template","Global","Evergreen",null,null,86,58],["Family travel itinerary planner","template","Global","Evergreen",null,null,76,54],["Pet care and veterinary visit tracker","template","United States","Evergreen",null,null,73,45],["Home cleaning rotation planner","template","Global","Evergreen",null,null,78,52],["Decluttering room-by-room workbook","workbook","Global","Evergreen",null,null,75,48],["Vegetable garden seasonal planner","template","United Kingdom","Evergreen",null,null,72,49],["Weekly fitness habit and progress log","template","Global","Evergreen",null,null,77,57],["Healthy meal prep and grocery budget planner","template","Canada","Evergreen",null,null,81,56],["Job application pipeline tracker","template","Global","Evergreen",null,null,84,52],["Interview preparation question workbook","workbook","Global","Evergreen",null,null,82,55],["Professional resume writing guide","guide","Global","Evergreen",null,null,83,63],["Freelancer weekly time and workload tracker","template","Global","Evergreen",null,null,75,47],["Small business standard operating procedures kit","template","United States","Evergreen",null,null,80,49],["Customer service response template library","template","Global","Evergreen",null,null,74,46],["Social media analytics reporting workbook","workbook","Global","Evergreen",null,null,77,50],["Search engine optimization audit checklist","template","Global","Evergreen",null,null,79,58],["Content repurposing workflow planner","template","Global","Evergreen",null,null,76,48],["Bookkeeping month-end close checklist","template","United States","Evergreen",null,null,78,52],["Tax document preparation organizer","template","Canada","Evergreen",null,null,81,57],["First-time manager leadership workbook","workbook","Global","Evergreen",null,null,74,53],["New employee onboarding checklist","template","Global","Evergreen",null,null,80,54],["Personal reading log and book review journal","template","Global","Evergreen",null,null,72,58],["Exam revision timetable and study tracker","template","United Kingdom","Evergreen",null,null,79,56],["Scholarship application organizer","template","Global","Evergreen",null,null,73,47],["Home maintenance annual schedule","template","United States","Evergreen",null,null,76,50],["Car maintenance and service history tracker","template","Global","Evergreen",null,null,75,49],["Volunteer event planning toolkit","template","Global","Evergreen",null,null,70,43],["Nonprofit donor relationship tracker","template","United States","Evergreen",null,null,72,45],["Photography client booking workflow","template","Global","Evergreen",null,null,71,47],["Coaching session notes and action planner","template","Global","Evergreen",null,null,73,46]];
const geo={"United States":"US","United Kingdom":"GB","Canada":"CA","Australia":"AU"};
async function auth(r,e){const token=r.headers.get("x-admin-token")||r.headers.get("x-factory-cron")||"";if((e.ADMIN_PASSWORD&&token===e.ADMIN_PASSWORD)||(e.FACTORY_CRON_SECRET&&token===e.FACTORY_CRON_SECRET))return true;if(!token)return false;const scheduler=await supabaseDB(e).prepare("SELECT token FROM factory_scheduler_auth WHERE id=1").first().catch(()=>null);if(scheduler?.token&&token===scheduler.token)return true;const row=await supabaseDB(e).prepare("SELECT secret_hash FROM factory_cron_auth WHERE id=1").first().catch(()=>null);if(!row?.secret_hash)return false;const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");return hash===row.secret_hash}
function score(t){t=t.toLowerCase();let n=48;for(const w of ["planner","template","checklist","workbook","budget","organizer","study","meal","gift","small business","job search","resume","interview","fitness","wedding","travel","holiday","christmas","new year","back to school","halloween","thanksgiving","easter","mother's day","father's day"])if(t.includes(w))n+=6;for(const w of ["celebrity","actor","sports","match","score","election","breaking","death","weather","earthquake","medicine","drug","recall","movie","tv show","game release"])if(t.includes(w))n-=18;return Math.max(0,Math.min(100,n))}
function kind(t){t=t.toLowerCase();if(/template|planner|tracker|calendar|checklist|organizer/.test(t))return"template";if(/workbook|activity|worksheet|study|goal/.test(t))return"workbook";if(/guide|how to|tips|beginner/.test(t))return"guide";return"ebook"}
function rssTitles(xml){return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m=>{const t=(m[0].match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";return t.replace(/<!\[CDATA\[|\]\]>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").trim()}).filter(Boolean)}
async function bulkInsert(env,rows){
 if(!rows.length)return 0;
 const payload=JSON.stringify(rows);
 const result=await supabaseDB(env).prepare(
  "INSERT INTO factory_opportunities (id,title,product_type,market,language,occasion,season_start,season_end,demand_score,competition_score,opportunity_score,source,status) SELECT x.id,x.title,x.product_type,x.market,x.language,x.occasion,x.season_start,x.season_end,x.demand_score,x.competition_score,x.opportunity_score,x.source,'candidate' FROM jsonb_to_recordset(?::jsonb) AS x(id text,title text,product_type text,market text,language text,occasion text,season_start text,season_end text,demand_score integer,competition_score integer,opportunity_score integer,source text) WHERE NOT EXISTS (SELECT 1 FROM factory_opportunities o WHERE lower(o.title)=lower(x.title) AND lower(o.market)=lower(x.market))"
 ).bind(payload).run();
 return Number(result.meta?.changes||0);
}
const expansionIdeas=[
 ["AI-Assisted Small Business Workflow Planner","workbook","Operations"],
 ["Client Retention and Renewal Tracker","template","Freelance"],
 ["Quarterly Business Review Workbook","workbook","Business"],
 ["Digital Marketing Campaign Calendar","template","Marketing"],
 ["Local Service Business Pricing Calculator Guide","guide","Small Business"],
 ["Freelancer Proposal and Scope Template Kit","template","Freelance"],
 ["Customer Onboarding Email Sequence Kit","template","Customer Experience"],
 ["Simple Cash Flow Forecast Workbook","workbook","Finance"],
 ["Small Business Risk Register and Action Planner","workbook","Operations"],
 ["Personal Knowledge Management System","template","Productivity"],
 ["Remote Team Weekly Planning Pack","template","Remote Work"],
 ["Professional Development Action Plan","workbook","Career"],
 ["Job Interview STAR Answer Builder","workbook","Career"],
 ["New Manager One-to-One Meeting Toolkit","template","Management"],
 ["Online Workshop Planning and Delivery Kit","workbook","Education"],
 ["Digital Course Student Progress Tracker","template","Education"],
 ["Content Creator Sponsorship Tracker","template","Creator Business"],
 ["Podcast Guest Outreach and Booking Kit","template","Creator Business"],
 ["Email Marketing Performance Workbook","workbook","Marketing"],
 ["Website Content Audit and Refresh Planner","workbook","Marketing"],
 ["Household Subscription and Renewal Tracker","template","Personal Finance"],
 ["Family Emergency Preparedness Planner","workbook","Home"],
 ["Home Renovation Budget and Contractor Tracker","template","Home"],
 ["Travel Budget and Expense Organizer","template","Travel"]
];
const expansionMarkets=["United States","United Kingdom","Canada","Australia"];
async function seedExpansionOpportunities(env){
 const rows=[];
 for(let i=0;i<expansionIdeas.length;i++){
  const [base,type,occasion]=expansionIdeas[i];
  for(let m=0;m<expansionMarkets.length;m++){
   const market=expansionMarkets[m];
   const localizedTitle=base+" - "+market+" Edition";
   const demand=72+((i*7+m*5)%17),competition=38+((i*11+m*3)%24);
   rows.push({id:crypto.randomUUID(),title:localizedTitle,product_type:type,market,language:"English",occasion,season_start:null,season_end:null,demand_score:demand,competition_score:competition,opportunity_score:Math.round(demand*.4+(100-competition)*.3+75*.3),source:"factory-evergreen-expansion"});
  }
 }
 return bulkInsert(env,rows);
}
export async function onRequestGet({request,env}){
 if(!await auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 try{
  const {results=[]}=await supabaseDB(env).prepare("SELECT * FROM factory_opportunities WHERE status='candidate' AND (season_end IS NULL OR season_end>=CURRENT_DATE::text) ORDER BY opportunity_score DESC,created_at DESC LIMIT 100").all();
  return Response.json({opportunities:results,ingested:0,source:"Cached opportunities"});
 }catch(e){return Response.json({error:e.message},{status:500})}
}
export async function onRequestPost({request,env}){
 if(!await auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});
 try{
  await supabaseDB(env).prepare("CREATE TABLE IF NOT EXISTS factory_discovery_state (id INTEGER PRIMARY KEY CHECK(id=1),last_run_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z')").run();
  const claim=await supabaseDB(env).prepare("INSERT INTO factory_discovery_state(id,last_run_at) VALUES(1,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET last_run_at=excluded.last_run_at WHERE factory_discovery_state.last_run_at<CURRENT_TIMESTAMP-INTERVAL '6 hours'").run();
  if(Number(claim.meta?.changes||0)===0){
   const state=await supabaseDB(env).prepare("SELECT last_run_at FROM factory_discovery_state WHERE id=1").first();
   return Response.json({ok:true,skipped:true,lastRunAt:state?.last_run_at||null,message:"Opportunity discovery was already refreshed within the last six hours."});
  }
 
   const curated=seeds.map(s=>({id:crypto.randomUUID(),title:s[0],product_type:s[1],market:s[2],language:"English",occasion:s[3],season_start:s[4],season_end:s[5],demand_score:s[6],competition_score:s[7],opportunity_score:Math.round(s[6]*.4+(100-s[7])*.3+70*.3),source:"curated"}));
   let ingested=await bulkInsert(env,curated);
   const expanded=await seedExpansionOpportunities(env);
   ingested+=expanded;
   console.log("FACTORY_OPPORTUNITY_EXPANSION",JSON.stringify({newIdeas:expansionIdeas.length,marketVariants:expansionIdeas.length*expansionMarkets.length,inserted:expanded}));
   const row=await supabaseDB(env).prepare("SELECT markets,seasonal_enabled FROM factory_settings WHERE id=1").first();
   let markets=["United States","United Kingdom","Canada","Australia"];
   try{const parsed=JSON.parse(row?.markets||"[]");if(Array.isArray(parsed)&&parsed.length)markets=parsed.map(x=>String(x).trim()).filter(Boolean)}catch(error){console.log("FACTORY_MARKETS_INVALID_JSON",String(error?.message||error))}
   const live=[];
   if(row?.seasonal_enabled!==0){
    for(const market of markets.slice(0,8)){
     const code=geo[market];if(!code)continue;
     try{
      const r=await fetch("https://trends.google.com/trending/rss?geo="+code,{headers:{"user-agent":"DigitalNestFactory/1.0"},signal:AbortSignal.timeout(8000)});
      if(!r.ok)continue;
      for(const title of rssTitles(await r.text()).slice(0,20)){
       const demand=score(title);if(demand<60)continue;
       const seasonal=/christmas|holiday|halloween|thanksgiving|new year|back to school|easter|mother.?s day|father.?s day|valentine|wedding/i.test(title);
       live.push({id:crypto.randomUUID(),title,product_type:kind(title),market,language:"English",occasion:seasonal?"Seasonal trend":"Trend signal",season_start:null,season_end:null,demand_score:demand,competition_score:50,opportunity_score:Math.round(demand*.65+17.5),source:"Google Trends RSS"});
      }
     }catch(e){console.log("Trend feed unavailable",market,e.message)}
    }
   }
   ingested+=await bulkInsert(env,live);
   const {results=[]}=await supabaseDB(env).prepare("SELECT * FROM factory_opportunities WHERE status='candidate' AND (season_end IS NULL OR season_end>=CURRENT_DATE::text) ORDER BY opportunity_score DESC,created_at DESC LIMIT 100").all();
   return {opportunities:results,ingested,source:"Curated evergreen/seasonal ideas + Google Trends RSS when available"};
 
 }catch(e){
  await supabaseDB(env).prepare("UPDATE factory_discovery_state SET last_run_at='1970-01-01T00:00:00Z' WHERE id=1").run().catch(()=>{});
  console.log("FACTORY_OPPORTUNITY_REFRESH_ERROR",String(e?.stack||e));
  return Response.json({error:e.message||"Opportunity refresh failed."},{status:500});
 }
}
