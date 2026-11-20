import {listAllPublishedProducts} from "./_shared/published-products.js";

const origin="https://digital-products-store-4yt.pages.dev";
const MAX_URLS=50000;
const xmlEscape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[char]));

export async function onRequest({env}){
  try {
    const products=await listAllPublishedProducts(env,{limit:MAX_URLS-2});
    const urls=[
      origin+"/",
      origin+"/all-products.html",
      ...products.map(product=>origin+"/product/"+encodeURIComponent(String(product.slug)))
    ];
    const seen=new Set();
    const entries=urls.filter(url=>{if(seen.has(url))return false;seen.add(url);return true;}).slice(0,MAX_URLS).map(url=>{
      const product=products.find(item=>url.endsWith("/product/"+encodeURIComponent(String(item.slug))));
      const date=product?.updated_at||product?.created_at;
      const parsed=date?new Date(date):null;
      const lastmod=parsed&&Number.isFinite(parsed.getTime())?"<lastmod>"+parsed.toISOString().slice(0,10)+"</lastmod>":"";
      return "<url><loc>"+xmlEscape(url)+"</loc>"+lastmod+"</url>";
    });
    const xml='<?xml version="1.0" encoding="UTF-8"?>'+'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+entries.join("")+"</urlset>";
    return new Response(xml,{headers:{"content-type":"application/xml;charset=UTF-8","cache-control":"public, max-age=300, s-maxage=300"}});
  } catch(error) {
    console.log("SITEMAP_GENERATION_FAILED",String(error?.message||error).slice(0,300));
    return new Response("Sitemap temporarily unavailable",{status:503,headers:{"content-type":"text/plain;charset=UTF-8","cache-control":"no-store","Retry-After":"60"}});
  }
}
