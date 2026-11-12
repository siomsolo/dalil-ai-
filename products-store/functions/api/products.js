import {supabaseDB} from "../_shared/supabase-db.js";
import {listPublishedSupabaseProducts,insertSupabaseProduct} from "../_shared/supabase-products.js";
import {adminAuthorized,mutationGuard} from "../_shared/security.js";
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
  const blocked=mutationGuard(request);if(blocked)return blocked;
  if(!adminAuthorized(request,env))return Response.json({error:"Admin authentication failed. Configure ADMIN_PASSWORD in Cloudflare."},{status:401,headers:{"Cache-Control":"no-store"}});
  if(!env.FILES)return Response.json({error:"File storage is not connected yet. Enable R2 and bind it as FILES."},{status:503});
  let fileKey=null,imageKey=null;
  try{
    const form=await request.formData();
    const file=form.get("file"),image=form.get("image");
    if(!(file instanceof File)||!file.size)return Response.json({error:"Product file is required."},{status:400});
    if(file.size>40*1024*1024)return Response.json({error:"File exceeds 40 MB."},{status:413});
    const allowed={pdf:["application/pdf"],zip:["application/zip","application/x-zip-compressed","application/octet-stream"],epub:["application/epub+zip","application/octet-stream"],doc:["application/msword","application/octet-stream"],docx:["application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/octet-stream"],xlsx:["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/octet-stream"],pptx:["application/vnd.openxmlformats-officedocument.presentationml.presentation","application/octet-stream"]};
    const ext=(file.name.split(".").pop()||"").toLowerCase();
    if(!Object.hasOwn(allowed,ext)||!allowed[ext].includes(file.type||"application/octet-stream"))return Response.json({error:"Unsupported product file type."},{status:415});
    if(image instanceof File&&image.size){
      if(image.size>5*1024*1024)return Response.json({error:"Cover image exceeds 5 MB."},{status:413});
      if(!["image/jpeg","image/png","image/webp"].includes(image.type))return Response.json({error:"Cover must be a JPEG, PNG or WebP image."},{status:415});
    }
    const title=String(form.get("title")||"").trim(),description=String(form.get("description")||"").trim();
    if(!title||!description||title.length>180||description.length>12000)return Response.json({error:"Title and description are required and must be within the allowed length."},{status:400});
    let slug=String(form.get("slug")||title).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,90);
    if(!slug)slug=crypto.randomUUID();
    const id=crypto.randomUUID(),safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-100);
    fileKey="products/"+id+"/"+safeName;
    await env.FILES.put(fileKey,file.stream(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
    let imageUrl=null;
    if(image instanceof File&&image.size){
      const imageExt=image.type==="image/png"?"png":image.type==="image/webp"?"webp":"jpg";
      imageKey="covers/"+id+"."+imageExt;
      await env.FILES.put(imageKey,image.stream(),{httpMetadata:{contentType:image.type}});
      imageUrl="/media/"+imageKey;
    }
    const data={id,slug,title,description,category:String(form.get("category")||"Digital resource").slice(0,100),language:String(form.get("language")||"English").slice(0,40),market:String(form.get("market")||"Global").slice(0,80),occasion:String(form.get("occasion")||"Evergreen").slice(0,80),keywords:String(form.get("keywords")||"").slice(0,2000),price:5,file_key:fileKey,file_name:safeName,file_type:file.type||"application/octet-stream",image_key:imageKey,image_url:imageUrl,status:"published"};
    await insertSupabaseProduct(env,data);
    try{await caches.default.delete(new Request(new URL("/api/products",request.url).toString(),{method:"GET"}));}catch(e){}
    const {notifyIndexNow}=await import("../_shared/indexnow.js");
    notifyIndexNow(context,data.slug);
    return Response.json({ok:true,product:{slug,title,price:data.price}},{status:201});
  }catch(e){
    if(fileKey)await env.FILES.delete(fileKey).catch(()=>{});
    if(imageKey)await env.FILES.delete(imageKey).catch(()=>{});
    console.log("PRODUCT_UPLOAD_FAILED",JSON.stringify({message:String(e?.message||e)}));
    return Response.json({error:"Could not save product. Please verify the product details and try again."},{status:500});
  }
}
