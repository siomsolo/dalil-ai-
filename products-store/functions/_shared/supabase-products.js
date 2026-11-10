function config(env){
  const raw=String(env.SUPABASE_URL||"");
  const url=raw.endsWith("/")?raw.slice(0,-1):raw;
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||"");
  if(!url||!key)throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Cloudflare Pages secrets.");
  return {url,key};
}
async function request(env,path,options={}){
  const {url,key}=config(env);
  const response=await fetch(url+"/rest/v1/"+path,{...options,headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",...(options.headers||{})}});
  if(!response.ok){const message=await response.text().catch(()=> "");throw new Error("Supabase products API returned "+response.status+": "+message.slice(0,500));}
  if(response.status===204)return null;
  return response.json();
}
const fields="id,slug,title,description,category,language,market,occasion,keywords,price,file_key,file_name,file_type,image_key,image_url,status,created_at,updated_at";
export async function listPublishedSupabaseProducts(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return [];
  return await request(env,"products?select="+fields+"&status=eq.published&order=created_at.desc",{method:"GET"});
}
export async function getPublishedSupabaseProduct(env,slug){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const rows=await request(env,"products?select="+fields+"&status=eq.published&slug=eq."+encodeURIComponent(slug)+"&limit=1",{method:"GET"});
  return rows&&rows[0]||null;
}
export async function insertSupabaseProduct(env,product){
  const row={...product,updated_at:new Date().toISOString()};
  return await request(env,"products?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
}

export async function listDraftSupabaseProducts(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return [];
  return await request(env,"products?select="+fields+"&status=eq.draft&order=created_at.desc",{method:"GET"});
}
export async function getDraftSupabaseProduct(env,id){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const rows=await request(env,"products?select="+fields+"&status=eq.draft&id=eq."+encodeURIComponent(id)+"&limit=1",{method:"GET"});
  return rows&&rows[0]||null;
}
