ALTER TABLE webhook_endpoints ADD COLUMN kind text NOT NULL DEFAULT 'webhook'
  CHECK (kind IN ('webhook', 'vercel'));
