import {listAllPublishedProducts} from "./_shared/published-products.js";

const origin="https://digital-products-store-4yt.pages.dev";
const MAX_URLS=50000;
const xmlEscape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[char]));

async function staticFallback(request,error){
  console.log("SITEMAP_STATIC_FALLBACK",String(error?.message||error).slice(0,300));
  const fallbackUrl=new URL("/sitemap-v2.xml",request.url);
  const fallback=await fetch(fallbackUrl.toString(),{headers:{Accept:"application/xml"}});
  if(!fallback.ok)throw new Error("Dynamic sitemap failed and static fallback returned HTTP "+fallback.status);
  const xml=await fallback.text();
  if(!xml.includes("<urlset")||!xml.includes("</urlset>"))throw new Error("Static sitemap fallback is not valid XML.");
  return new Response(xml,{status:200,headers:{
    "content-type":"application/xml;charset=UTF-8",
    "cache-control":"public, max-age=60, s-maxage=60",
    "x-sitemap-source":"static-fallback",
    "x-sitemap-warning":"live-catalog-unavailable"
  }});
}

export async function onRequest({request,env}){
  try{
    const products=await listAllPublishedProducts(env,{limit:MAX_URLS-2});
    if(!products.length)throw new Error("Published product query returned zero rows; refusing to publish an incomplete sitemap.");
    const urls=[
      origin+"/",
      origin+"/all-products.html",
      ...products
        .filter(product=>String(product.slug||"").trim())
        .map(product=>origin+"/product/"+encodeURIComponent(String(product.slug).trim()))
    ];
    const productByUrl=new Map(products.map(item=>[origin+"/product/"+encodeURIComponent(String(item.slug||"").trim()),item]));
    const seen=new Set();
    const entries=urls.filter(url=>{if(seen.has(url))return false;seen.add(url);return true;}).slice(0,MAX_URLS).map(url=>{
      const product=productByUrl.get(url);
      const date=product?.updated_at||product?.created_at;
      const parsed=date?new Date(date):null;
      const lastmod=parsed&&Number.isFinite(parsed.getTime())?"<lastmod>"+parsed.toISOString().slice(0,10)+"</lastmod>":"";
      return "<url><loc>"+xmlEscape(url)+"</loc>"+lastmod+"</url>";
    });
    const xml='<?xml version="1.0" encoding="UTF-8"?>'+'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+entries.join("")+"</urlset>";
    return new Response(xml,{headers:{
      "content-type":"application/xml;charset=UTF-8",
      "cache-control":"public, max-age=300, s-maxage=300",
      "x-sitemap-source":"live-catalog",
      "x-sitemap-products":String(products.length),
      "x-sitemap-urls":String(entries.length)
    }});
  }catch(error){
    try{return await staticFallback(request,error);}
    catch(fallbackError){
      console.log("SITEMAP_GENERATION_FAILED",String(fallbackError?.message||fallbackError).slice(0,300));
      return new Response("Sitemap temporarily unavailable",{status:503,headers:{
        "content-type":"text/plain;charset=UTF-8",
        "cache-control":"no-store",
        "retry-after":"60"
      }});
    }
  }
}
