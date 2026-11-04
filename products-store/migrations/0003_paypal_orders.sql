CREATE TABLE IF NOT EXISTS product_orders (
  id TEXT PRIMARY KEY,
  paypal_order_id TEXT NOT NULL UNIQUE,
  product_slug TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'CREATED',
  capture_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_product_orders_slug_status ON product_orders(product_slug,status);
CREATE INDEX IF NOT EXISTS idx_product_orders_paid_at ON product_orders(paid_at);
