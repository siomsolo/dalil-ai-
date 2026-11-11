# DigitalNest Factory — Deployment and first-run checklist

## Implemented in this branch
- Factory settings, opportunity/job/usage tables (migration 0002).
- Curated evergreen and seasonal opportunities, plus Google Trends RSS ingestion for configured English markets where reachable.
- Daily quota-aware planning with reserve and daily safety cap.
- AI-generated English ebooks, guides, templates and workbooks; content/metadata/PDF checks; cover art; R2 storage; Supabase product metadata; automatic publication when enabled.
- Dynamic sitemap and robots.txt routes.
- A separate scheduled Worker to plan and process production jobs.

## Required before production
1. Merge PR #13 into the digital-products-store branch after reviewing the diff.
2. Confirm Pages bindings FILES (R2), AI (Workers AI), SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, plus ADMIN_PASSWORD and FACTORY_CRON_SECRET secrets. D1 is no longer used by the application; factory data is stored in Supabase and digital files remain in R2.
3. Deploy the scheduler Worker from products-store/factory-worker using Wrangler. wrangler.toml uses index.js and cron */15 * * * *.
4. Add Worker secret FACTORY_CRON_SECRET with the exact same value as Pages FACTORY_CRON_SECRET. Add variable FACTORY_PAGES_URL=https://digital-products-store-4yt.pages.dev.
5. Confirm the Worker deployment shows the 15-minute cron trigger. Do not enable the factory before a manual test.
6. Open /factory.html, unlock with the admin password, keep factory disabled, refresh opportunities, and confirm curated ideas and any reachable RSS trends appear.
7. Enable factory, keep auto-publish on, set daily allowance to 10,000 Neurons, reserve to 30%, daily cap to 1, save, then run once manually.
8. Check the job status, product page, PDF download and cover image. Check Workers AI usage in Cloudflare dashboard. After a successful first run, increase daily cap gradually (2–5), staying under the daily free allowance.
9. If any AI/PDF/image step fails, disable the factory and inspect the failed job before retrying.

## Important limits
- Workers AI Free allocation is 10,000 Neurons per day, not per month; it resets daily. The setting is a safety ceiling and per-product usage is estimated until actual usage reporting is connected.
- Google Trends is a search-interest signal, not proof of product sales. Curated opportunities are not a guarantee of demand.
- This first release creates English products for configured markets; localized-language generation is later.
- Payment/checkout is intentionally unchanged.
- Structural checks are automated; review the first products manually for quality, accuracy, formatting and rights.
