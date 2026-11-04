CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  events text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  encrypted_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (space_id,id)
);
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL,
  payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (space_id,event_key),
  UNIQUE (space_id,id)
);
CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL,
  event_id uuid NOT NULL,
  endpoint_revision integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivering','succeeded','failed','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0,
  retry_start integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_token uuid,
  claim_expires_at timestamptz,
  http_status integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (endpoint_id,event_id),
  FOREIGN KEY (space_id,endpoint_id) REFERENCES webhook_endpoints(space_id,id) ON DELETE CASCADE,
  FOREIGN KEY (space_id,event_id) REFERENCES webhook_events(space_id,id) ON DELETE CASCADE
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries(next_attempt_at,created_at) WHERE status IN ('pending','delivering');
CREATE INDEX webhook_deliveries_logs ON webhook_deliveries(space_id,endpoint_id,created_at DESC,id);
CREATE TABLE webhook_attempts (
  delivery_id uuid NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  number integer NOT NULL,
  claim_token uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  http_status integer,
  error text,
  PRIMARY KEY(delivery_id,number)
);
