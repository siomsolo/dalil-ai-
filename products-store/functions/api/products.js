import {supabaseDB} from "../_shared/supabase-db.js";
import {listPublishedSupabaseProducts,insertSupabaseProduct} from "../_shared/supabase-products.js";
export async function onRequestGet(context){
  const {env,request,waitUntil}=context;
  const cacheKey=new Request(new URL("/api/products",request.url).toString(),{method:"GET"});
  try{
    const cached=await caches.default.match(cacheKey);
    if(cached)return cached;
  }catch(e){
    // Cache is an optimization; continue to D1 if unavailable.
  }
  try{
    const [{results=[]},supabaseProducts]=await Promise.all([supabaseDB(env).prepare("SELECT id,slug,title,description,category,language,market,occasion,keywords,price,image_url,status,created_at FROM products WHERE status='published' ORDER BY created_at DESC").all(),listPublishedSupabaseProducts(env)]);
    const seen=new Set();
    const combined=[...supabaseProducts,...results].filter(product=>{const key=String(product.id||product.slug);if(seen.has(key)||seen.has("slug:"+product.slug))return false;seen.add(key);seen.add("slug:"+product.slug);return true;});
    const response=Response.json({products:combined.map(product=>({...product,price:5}))},{headers:{"Cache-Control":"public, max-age=60, s-maxage=300, stale-while-revalidate=600"}});
    try{
      const write=caches.default.put(cacheKey,response.clone());
      if(typeof waitUntil==="function")waitUntil(write);
      else await write;
    }catch(e){
      // A cache write failure must not make the catalog unavailable.
    }
    return response;
  }catch(e){
    return Response.json({products:null,error:"The product catalog is temporarily unavailable. Please try again shortly."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}

export async function onRequestPost(context){
  const {request,env}=context;
  const token=request.headers.get("x-admin-token")||"";
  if(!env.ADMIN_PASSWORD||token!==env.ADMIN_PASSWORD)return Response.json({error:"Admin authentication failed. Configure ADMIN_PASSWORD in Cloudflare."},{status:401});
  if(!env.FILES)return Response.json({error:"File storage is not connected yet. Enable R2 and bind it as FILES."},{status:503});
  try{
    const form=await request.formData();
    const file=form.get("file"),image=form.get("image");
    if(!(file instanceof File)||!file.size)return Response.json({error:"Product file is required."},{status:400});
    if(file.size>40*1024*1024)return Response.json({error:"File exceeds 40 MB."},{status:413});
    const title=String(form.get("title")||"").trim(),description=String(form.get("description")||"").trim();
    if(!title||!description)return Response.json({error:"Title and description are required."},{status:400});
    let slug=String(form.get("slug")||title).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,90);
    if(!slug)slug=crypto.randomUUID();
    const id=crypto.randomUUID();
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-100);
    const fileKey="products/"+id+"/"+safeName;
    await env.FILES.put(fileKey,file.stream(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
    let imageKey=null,imageUrl=null;
    if(image instanceof File&&image.size){
      if(image.size>5*1024*1024)return Response.json({error:"Cover image exceeds 5 MB."},{status:413});
      const ext=(image.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
      imageKey="covers/"+id+"."+ext;
      await env.FILES.put(imageKey,image.stream(),{httpMetadata:{contentType:image.type||"image/jpeg"}});
      imageUrl="/media/"+imageKey;
    }
    const data={id,slug,title,description,category:String(form.get("category")||"Digital resource"),language:String(form.get("language")||"English"),market:String(form.get("market")||"Global"),occasion:String(form.get("occasion")||"Evergreen"),keywords:String(form.get("keywords")||""),price:5,file_key:fileKey,file_name:file.name,file_type:file.type||"application/octet-stream",image_key:imageKey,image_url:imageUrl,status:"published"};
    await insertSupabaseProduct(env,data);
    try{await caches.default.delete(new Request(new URL("/api/products",request.url).toString(),{method:"GET"}));}catch(e){}
    if(data.status==="published"){
      const {notifyIndexNow}=await import("../_shared/indexnow.js");
      notifyIndexNow(context,data.slug);
    }
    return Response.json({ok:true,product:{slug,title,price:data.price}},{status:201});
  }catch(e){
    return Response.json({error:e.message||"Could not save product."},{status:500});
  }
}