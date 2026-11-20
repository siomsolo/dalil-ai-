import {listAllPublishedProducts} from "./_shared/published-products.js";
const origin="https://digital-products-store-4yt.pages.dev";
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
export async function onRequest({env}){
  try {
    const products=await listAllPublishedProducts(env);
    const links=products.map(product=>'<li><a href="/product/'+encodeURIComponent(product.slug)+'">'+esc(product.title)+'</a></li>').join("");
    const itemList={"@context":"https://schema.org","@type":"ItemList","name":"DigitalNest digital products","itemListOrder":"https://schema.org/ItemListOrderAscending","numberOfItems":products.length,"itemListElement":products.slice(0,100).map((product,index)=>({"@type":"ListItem","position":index+1,"url":origin+"/product/"+encodeURIComponent(product.slug),"name":String(product.title||"")}))};
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>All Digital Products & Guides | DigitalNest</title><meta name="description" content="Browse every published DigitalNest ebook, digital guide, template and downloadable resource."><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="DigitalNest"><meta property="og:title" content="All Digital Products & Guides | DigitalNest"><meta property="og:description" content="Browse every published DigitalNest ebook, digital guide, template and downloadable resource."><script type="application/ld+json">${JSON.stringify(itemList).replace(/</g,"\\u003c")}</script><link rel="canonical" href="'+origin+'/all-products.html"><style>body{font:16px/1.65 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 22px;color:#202534}a{color:inherit}li{padding:9px 0;border-bottom:1px solid #e8eaf0}h1{font-size:clamp(2rem,5vw,3rem)}.count{font-weight:700;color:#667085}</style></head><body><p><a href="/">← DigitalNest home</a></p><main><h1>All digital products</h1><p>Explore every currently published ebook, guide, template and downloadable resource in the DigitalNest collection.</p><p class="count">'+products.length+' published products</p><ul>'+links+'</ul></main></body></html>';
    return new Response(html,{headers:{"content-type":"text/html;charset=UTF-8","cache-control":"public, max-age=120"}});
  } catch(error) {
    console.log("PRODUCT_DIRECTORY_GENERATION_FAILED",String(error?.message||error).slice(0,300));
    return new Response("Product directory temporarily unavailable.",{status:503,headers:{"content-type":"text/plain;charset=UTF-8","cache-control":"no-store"}});
  }
}
