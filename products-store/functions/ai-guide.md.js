import {listAllPublishedProducts} from "./_shared/published-products.js";
const origin="https://digital-products-store-4yt.pages.dev";
const clean=value=>String(value??"").replace(/\s+/g," ").trim();

export async function onRequest({env}){
  try {
    const products=await listAllPublishedProducts(env);
    const lines=[
      "# DigitalNest — Digital Products Directory",
      "",
      "DigitalNest is an online store where visitors can discover ebooks, practical guides, templates and other downloadable digital resources.",
      "",
      "Visitors can open each product page to review its description, category, language and price. Payment and file delivery are handled on the individual product page.",
      "",
      "## Browse published products",
      ""
    ];
    for(const product of products){
      const href=origin+"/product/"+encodeURIComponent(product.slug);
      lines.push("### "+clean(product.title));
      if(product.description)lines.push(clean(product.description));
      lines.push(
        "- Category: "+clean(product.category||"Digital resource"),
        "- Language: "+clean(product.language||"Not specified"),
        "- Market: "+clean(product.market||"Global"),
        "- Price: $5.00",
        "- Product page: "+href,
        ""
      );
    }
    if(!products.length)lines.push("No published products are currently listed.","");
    lines.push("## Main pages","","- Store homepage: "+origin+"/","- Complete product directory: "+origin+"/all-products.html","- XML sitemap: "+origin+"/sitemap.xml","");
    return new Response(lines.join("\n"),{headers:{"content-type":"text/markdown; charset=UTF-8","cache-control":"public, max-age=300","x-robots-tag":"index, follow"}});
  } catch(error) {
    console.log("AI_GUIDE_GENERATION_FAILED",String(error?.message||error).slice(0,300));
    return new Response("DigitalNest product guide is temporarily unavailable.",{status:503,headers:{"content-type":"text/markdown; charset=UTF-8","cache-control":"no-store"}});
  }
}
