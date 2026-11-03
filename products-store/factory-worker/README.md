# DigitalNest Factory Worker

Scheduled worker for the factory. Apply migration `../migrations/0002_factory.sql` to the existing D1 database, set `ADMIN_PASSWORD`, then deploy with Wrangler from this directory.

Daily trigger: 08:00 UTC. It seeds a curated starter opportunity list, queues and processes one product job per scheduled invocation, and creates an original English PDF plus SVG cover. Auto-publication follows the factory setting.

**Important:** Neurons accounting is a conservative estimate (700 per job), not a provider-reported usage meter. Keep factory disabled until migration, deployment, and smoke tests are complete; use a reserve and confirm account quotas.

`npx wrangler d1 execute digital-products-store --remote --file ../migrations/0002_factory.sql`
`npx wrangler secret put ADMIN_PASSWORD`
`npx wrangler deploy`
