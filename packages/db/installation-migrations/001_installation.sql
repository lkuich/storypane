CREATE TABLE "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  clerk_user_id text UNIQUE, avatar_url text,
  installation_admin boolean NOT NULL DEFAULT false, disabled boolean NOT NULL DEFAULT false
);
CREATE TABLE "session" (
  id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_id ON "session"("userId");
CREATE TABLE account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("providerId","accountId")
);
CREATE INDEX account_user ON account("userId");
CREATE TABLE verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier ON verification(identifier);
CREATE TABLE "rateLimit" (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL);
CREATE TABLE cms_sessions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id), expires_at timestamptz NOT NULL);
CREATE TABLE installation_config (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), auth_provider text NOT NULL CHECK(auth_provider IN ('local','clerk')));
CREATE TABLE space_connections (
  id uuid PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK(status IN ('provisioning','ready','failed')),
  connection_secret text NOT NULL, connection_fingerprint text NOT NULL UNIQUE,
  mode text NOT NULL CHECK(mode IN ('create','attach','import')),
  owner_id text NOT NULL REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE preview_routes (token_hash text PRIMARY KEY, space_id uuid NOT NULL REFERENCES space_connections(id), expires_at timestamptz NOT NULL);
CREATE INDEX preview_routes_expiry ON preview_routes(expires_at);
