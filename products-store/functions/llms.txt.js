import {listAllPublishedProducts} from "./_shared/published-products.js";

const origin="https://digital-products-store-4yt.pages.dev";
const clean=value=>String(value??"").replace(/\s+/g," ").trim();

export async function onRequest({env}){
  try{
    const products=await listAllPublishedProducts(env);
    const lines=[
      "# DigitalNest",
      "",
      "> DigitalNest is an online store for ebooks, practical guides, templates and downloadable digital resources for learning, business and everyday projects.",
      "",
      "## Main pages",
      "",
      "- [Home]("+origin+"/): Discover the DigitalNest store and browse its collection.",
      "- [All products]("+origin+"/all-products.html): HTML directory of published products.",
      "- [AI-readable product guide]("+origin+"/ai-guide.md): Product descriptions, categories, languages and direct product links.",
      "- [XML sitemap]("+origin+"/sitemap.xml): URLs for the homepage, product directory and published product pages.",
      "",
      "## Published products",
      ""
    ];
    for(const p of products){
      const href=origin+"/product/"+encodeURIComponent(p.slug);
      const details=[p.category,p.language].filter(Boolean).map(clean).join(" · ");
      const description=clean(p.description).slice(0,260);
      lines.push("- ["+clean(p.title)+"]("+href+")"+(details?" — "+details:"")+(description?" — "+description:""));
    }
    if(!products.length)lines.push("No published products are currently available.");
    return new Response(lines.join("\n")+"\n",{headers:{"content-type":"text/plain; charset=UTF-8","cache-control":"public, max-age=300","x-robots-tag":"index, follow"}});
  }catch(error){
    console.log("LLMS_TXT_GENERATION_FAILED",String(error?.message||error).slice(0,300));
    return new Response("DigitalNest directory is temporarily unavailable. See /ai-guide.md when available.",{status:503,headers:{"content-type":"text/plain; charset=UTF-8","cache-control":"no-store"}});
  }
}
