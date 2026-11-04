-- Keep legacy auth tables for rollback and stable content ownership.
CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS clerk_user_id text UNIQUE;
CREATE TABLE cms_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX cms_sessions_expiry ON cms_sessions(expires_at);
