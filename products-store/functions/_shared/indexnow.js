const INDEXNOW_KEY = "5f7b8ab50c134af4a3516d51f4f3fd9d";
const SITE_ORIGIN = "https://digital-products-store-4yt.pages.dev";

export function notifyIndexNow(context, slug) {
  const cleanSlug = String(slug || "").trim();
  if (!cleanSlug) return;
  const url = SITE_ORIGIN + "/product/" + encodeURIComponent(cleanSlug);
  const keyLocation = SITE_ORIGIN + "/" + INDEXNOW_KEY + ".txt";
  const task = fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: "digital-products-store-4yt.pages.dev",
      key: INDEXNOW_KEY,
      keyLocation,
      urlList: [url]
    })
  }).then(async response => {
    if (!response.ok && response.status !== 202) {
      const detail = (await response.text()).slice(0, 300);
      console.log("INDEXNOW_SUBMISSION_FAILED", JSON.stringify({
        url, status: response.status, detail
      }));
      return;
    }
    console.log("INDEXNOW_SUBMISSION_ACCEPTED", JSON.stringify({
      url, status: response.status
    }));
  }).catch(error => {
    console.log("INDEXNOW_SUBMISSION_ERROR", JSON.stringify({
      url, error: String(error?.message || error).slice(0, 300)
    }));
  });
  if (context?.waitUntil) context.waitUntil(task);
  else return task;
}
