CREATE TABLE IF NOT EXISTS factory_retry_schedule (
  job_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL,
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS factory_scheduler_auth (
  id INTEGER PRIMARY KEY CHECK(id=1),
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO factory_scheduler_auth (id, token)
VALUES (1, lower(hex(randomblob(32))));
