import {listAllPublishedProducts} from "../_shared/published-products.js";
import {adminAuthorized} from "../_shared/security.js";

const normalizeTitle = value => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

export async function onRequestGet({request, env}) {
  if (!adminAuthorized(request, env)) {
    return Response.json(
      {error: "Admin authentication required."},
      {status: 401, headers: {"Cache-Control": "no-store"}}
    );
  }

  try {
    const products = await listAllPublishedProducts(env);
    const duplicateGroups = new Map();
    const slugSet = new Set();
    const quality = {
      missingTitle: 0,
      missingDescription: 0,
      missingCategory: 0,
      missingLanguage: 0,
      missingCover: 0,
      descriptionUnder300Chars: 0,
      titleOver60Chars: 0
    };
    const shortDescriptions = [];
    const longTitles = [];

    for (const product of products) {
      const slug = String(product.slug || "").trim();
      const title = String(product.title || "").trim();
      const description = String(product.description || "").trim();
      const language = String(product.language || "").trim();
      const market = String(product.market || "").trim();

      if (slug) slugSet.add(slug);
      if (!title) quality.missingTitle++;
      if (!description) quality.missingDescription++;
      if (!String(product.category || "").trim()) quality.missingCategory++;
      if (!language) quality.missingLanguage++;
      if (!String(product.image_url || "").trim()) quality.missingCover++;

      if (description.length > 0 && description.length < 300) {
        quality.descriptionUnder300Chars++;
        if (shortDescriptions.length < 30) {
          shortDescriptions.push({slug, title, descriptionChars: description.length});
        }
      }

      if (title.length > 60) {
        quality.titleOver60Chars++;
        if (longTitles.length < 30) {
          longTitles.push({slug, title, titleChars: title.length});
        }
      }

      const normalized = normalizeTitle(title);
      if (!normalized) continue;
      const key = [language.toLowerCase(), market.toLowerCase(), normalized].join("|");
      const group = duplicateGroups.get(key) || {
        title,
        language,
        market,
        slugs: []
      };
      if (slug) group.slugs.push(slug);
      duplicateGroups.set(key, group);
    }

    const duplicates = [...duplicateGroups.values()]
      .filter(group => group.slugs.length > 1)
      .sort((a, b) => b.slugs.length - a.slugs.length)
      .map(group => ({...group, productCount: group.slugs.length}));

    const report = {
      generatedAt: new Date().toISOString(),
      scope: "published products only",
      totalPublishedProducts: products.length,
      uniqueSlugs: slugSet.size,
      expectedSitemapUrlCount: products.length + 2,
      duplicateTitleGroups: duplicates.length,
      productsInDuplicateTitleGroups: duplicates.reduce((sum, group) => sum + group.productCount, 0),
      quality,
      duplicateTitles: duplicates.slice(0, 50),
      samples: {
        shortDescriptions,
        longTitles
      },
      urls: {
        sitemap: "https://digital-products-store-4yt.pages.dev/sitemap.xml",
        productDirectory: "https://digital-products-store-4yt.pages.dev/all-products.html"
      }
    };

    return Response.json(report, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    console.log("SEO_INVENTORY_FAILED", String(error?.message || error).slice(0, 300));
    return Response.json(
      {error: "Could not build the SEO inventory. Please retry after the catalog data source is available."},
      {status: 503, headers: {"Cache-Control": "no-store", "Retry-After": "60"}}
    );
  }
}
