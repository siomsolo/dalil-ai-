# DigitalNest Factory Scheduler Worker

This Worker runs the DigitalNest Pages factory endpoints on a daily cron.

## Setup
1. Merge PR #13 and wait for the Pages deployment.
2. From this directory, apply the D1 migration:
   npx wrangler d1 execute digital-products-store --remote --file ../migrations/0002_factory.sql
3. Set the scheduler token to the same secret value as Pages ADMIN_PASSWORD:
   npx wrangler secret put FACTORY_ADMIN_TOKEN
4. Configure FACTORY_PAGES_URL=https://digital-products-store-4yt.pages.dev (the Worker defaults to this URL).
5. Deploy with npx wrangler deploy.

The cron is 08:00 UTC. Each run refreshes curated evergreen/seasonal ideas and Google Trends RSS signals where available, plans jobs under the daily AI allowance/reserve/daily cap, then processes up to 10 jobs. The factory must be enabled in /factory.html.

## Safety
- Start with daily cap 1; inspect the PDF, cover, product page and Cloudflare AI usage before increasing it.
- Workers AI Free allocation is 10,000 Neurons/day. Per-product usage in the app is an estimate, not provider-reported metering.
- Trends show search interest, not confirmed sales.
- Payment is not included in this release.
