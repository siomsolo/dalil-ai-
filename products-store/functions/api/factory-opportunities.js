const seeds=[
["Halloween activity workbook","workbook","United States","English","Halloween","2026-10-01","2026-10-31",82,58],
["Christmas gift planner","template","United States","English","Christmas","2026-11-01","2026-12-25",90,62],
["Christmas budget workbook","workbook","United Kingdom","English","Christmas","2026-11-01","2026-12-25",86,55],
["Back-to-school student planner","template","United States","English","Back to School","2027-07-01","2027-09-15",78,52],
["New Year goal-setting workbook","workbook","United States","English","New Year","2026-12-15","2027-01-31",85,50],
["Small business expense tracker","template","Global","English","Evergreen",null,null,76,48],
["Freelancer client onboarding guide","guide","Global","English","Evergreen",null,null,72,45],
["Weekly meal planning template","template","United States","English","Evergreen",null,null,70,60],
["Study planner and revision workbook","workbook","United Kingdom","English","Back to School","2027-08-01","2027-09-30",75,54],
["Personal finance starter guide","guide","Global","English","Evergreen",null,null,80,68]
];
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
function auth(request,env){return !!env.ADMIN_PASSWORD&&(request.headers.get("x-admin-token")||"")===env.ADMIN_PASSWORD}
export async function onRequestGet({request,env}){if(!auth(request,env))return Response.json({error:"Admin authentication failed."},{status:401});try{let {results=[]}=await env.DB.prepare("SELECT * FROM factory_opportunities ORDER BY opportunity_score DESC,created_at DESC LIMIT 100").all();if(!results.length){for(const s of seeds){const id=crypto.randomUUID(),score=Math.round(s[7]*.4+(100-s[8])*.3+70*.3);await env.DB.prepare("INSERT OR IGNORE INTO factory_opportunities (id,title,product_type,market,language,occasion,season_start,season_end,demand_score,competition_score,opportunity_score,source,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,s[0],s[1],s[2],s[3],s[4],s[5],s[6],s[7],s[8],score,"curated","candidate").run()}({results=[]}=await env.DB.prepare("SELECT * FROM factory_opportunities ORDER BY opportunity_score DESC,created_at DESC LIMIT 100").all())}return Response.json({opportunities:results})}catch(e){return Response.json({error:e.message},{status:500})}}
