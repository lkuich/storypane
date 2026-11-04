ALTER TABLE spaces ADD COLUMN preview_url text NOT NULL DEFAULT '';
ALTER TABLE spaces ADD COLUMN preview_parameter text NOT NULL DEFAULT 'blok_preview';
CREATE TABLE delivery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  scope text NOT NULL CHECK(scope IN ('published','preview')),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE TABLE preview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  locale_id uuid NOT NULL REFERENCES story_locales(id) ON DELETE CASCADE,
  origin text NOT NULL,
  user_id text,
  session_id text,
  delivery_token_id uuid REFERENCES delivery_tokens(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  CHECK ((user_id IS NOT NULL AND session_id IS NOT NULL AND delivery_token_id IS NULL) OR (user_id IS NULL AND session_id IS NULL AND delivery_token_id IS NOT NULL))
);
CREATE INDEX preview_sessions_expiry ON preview_sessions(space_id, expires_at);
