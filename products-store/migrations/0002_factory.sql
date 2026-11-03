CREATE TABLE IF NOT EXISTS factory_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0,
  auto_publish INTEGER NOT NULL DEFAULT 1,
  monthly_budget_usd REAL NOT NULL DEFAULT 0,
  monthly_ai_neurons INTEGER NOT NULL DEFAULT 10000,
  reserve_percent INTEGER NOT NULL DEFAULT 20,
  daily_product_cap INTEGER NOT NULL DEFAULT 10,
  languages TEXT NOT NULL DEFAULT '["English"]',
  product_types TEXT NOT NULL DEFAULT '["ebook","guide","template","workbook"]',
  markets TEXT NOT NULL DEFAULT '["United States","United Kingdom","Canada","Australia"]',
  seasonal_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO factory_settings (id) VALUES (1);
CREATE TABLE IF NOT EXISTS factory_opportunities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  product_type TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'Global',
  language TEXT NOT NULL DEFAULT 'English',
  occasion TEXT NOT NULL DEFAULT 'Evergreen',
  season_start TEXT,
  season_end TEXT,
  demand_score INTEGER NOT NULL DEFAULT 0,
  competition_score INTEGER NOT NULL DEFAULT 0,
  opportunity_score INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'curated',
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_factory_opportunities_status_score ON factory_opportunities(status,opportunity_score DESC);
CREATE TABLE IF NOT EXISTS factory_jobs (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT,
  product_type TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'Global',
  language TEXT NOT NULL DEFAULT 'English',
  occasion TEXT NOT NULL DEFAULT 'Evergreen',
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  product_slug TEXT,
  estimated_neurons INTEGER NOT NULL DEFAULT 0,
  actual_neurons INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(opportunity_id) REFERENCES factory_opportunities(id)
);
CREATE INDEX IF NOT EXISTS idx_factory_jobs_status_created ON factory_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS factory_usage (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  operation TEXT NOT NULL,
  units REAL NOT NULL DEFAULT 0,
  unit_type TEXT NOT NULL DEFAULT 'neurons',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_factory_usage_service_date ON factory_usage(service,created_at);
