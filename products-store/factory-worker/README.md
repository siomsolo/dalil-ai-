# DigitalNest Factory Scheduler Worker

This Worker calls the DigitalNest Pages factory endpoints every five minutes. It does not connect directly to D1 or Supabase; all factory state is handled by the Pages API through Supabase.

## Setup
1. Ensure the Pages production deployment includes the Supabase-only application and the required secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `FACTORY_CRON_SECRET`.
2. Set the Worker secret `FACTORY_CRON_SECRET` to the exact same value as the Pages secret:
   `npx wrangler secret put FACTORY_CRON_SECRET`
3. Configure `FACTORY_PAGES_URL=https://digital-products-store-4yt.pages.dev` (the Worker defaults to this URL).
4. Deploy from this directory with `npx wrangler deploy`.

The cron runs every five minutes. Each run refreshes opportunities (discovery is throttled server-side), replenishes the rolling queue and processes up to eight successful products sequentially. The independent Pages scheduler also runs every minute and processes the next available job. A shared database lock prevents the two schedulers from processing the same job concurrently. The factory must be enabled in `/factory.html`.

## Safety
- There is no five-product production target. The daily cap is an emergency guard only; provider quotas, rate limits and successful quality checks govern throughput.
- Workers AI Free allocation is 10,000 Neurons/day. Per-product usage in the app is an estimate, not provider-reported metering. Gemini free-tier RPM/TPM/RPD quotas are independent and may vary by model and project.
- When providers exhaust their free quotas, jobs remain queued/deferred until the provider reset; the system must not spin or silently consume paid quota.
- Trends show search interest, not confirmed sales.
- PayPal checkout remains unchanged.
