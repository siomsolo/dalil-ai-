-- DigitalNest factory idempotency and product/job reconciliation.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS factory_job_id text;

CREATE UNIQUE INDEX IF NOT EXISTS products_factory_job_id_unique
  ON public.products(factory_job_id)
  WHERE factory_job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS factory_jobs_active_opportunity_language_unique
  ON public.factory_jobs(opportunity_id, lower(language))
  WHERE opportunity_id IS NOT NULL
    AND status IN ('queued', 'running', 'deferred');

CREATE TABLE IF NOT EXISTS public.factory_discovery_state (
  id integer PRIMARY KEY CHECK (id = 1),
  last_run_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z'
);
