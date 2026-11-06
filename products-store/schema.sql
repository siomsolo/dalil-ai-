CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'English', market TEXT NOT NULL DEFAULT 'Global', occasion TEXT NOT NULL DEFAULT 'Evergreen', keywords TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 5, file_key TEXT NOT NULL, file_name TEXT NOT NULL, file_type TEXT NOT NULL, image_key TEXT, image_url TEXT, status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status,created_at);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_language ON products(language);
CREATE INDEX IF NOT EXISTS idx_products_market ON products(market);
CREATE TABLE IF NOT EXISTS product_events (id TEXT PRIMARY KEY, product_slug TEXT NOT NULL, event_type TEXT NOT NULL CHECK(event_type IN ('view','click')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_product_events_slug_type ON product_events(product_slug,event_type);
CREATE INDEX IF NOT EXISTS idx_product_events_created ON product_events(created_at);

CREATE TABLE IF NOT EXISTS factory_scheduler_auth (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
