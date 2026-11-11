# DigitalNest Factory Scheduler Worker

This Worker calls the DigitalNest Pages factory endpoints every 15 minutes. It does not connect directly to D1 or Supabase; all factory state is handled by the Pages API through Supabase.

## Setup
1. Ensure the Pages production deployment includes the Supabase-only application and the required secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `FACTORY_CRON_SECRET`.
2. Set the Worker secret `FACTORY_CRON_SECRET` to the exact same value as the Pages secret:
   `npx wrangler secret put FACTORY_CRON_SECRET`
3. Configure `FACTORY_PAGES_URL=https://digital-products-store-4yt.pages.dev` (the Worker defaults to this URL).
4. Deploy from this directory with `npx wrangler deploy`.

The cron runs every 15 minutes. Each run refreshes opportunities, replenishes the queue and processes up to three successful products sequentially. The factory must be enabled in `/factory.html`.

## Safety
- Start with daily cap 1; inspect the PDF, cover, product page and Cloudflare AI usage before increasing it.
- Workers AI Free allocation is 10,000 Neurons/day. Per-product usage in the app is an estimate, not provider-reported metering.
- Trends show search interest, not confirmed sales.
- PayPal checkout remains unchanged.
