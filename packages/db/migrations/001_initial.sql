CREATE TABLE IF NOT EXISTS spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'editor')),
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE IF NOT EXISTS definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  current_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, name)
);
CREATE TABLE IF NOT EXISTS definition_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES definitions(id),
  version integer NOT NULL,
  schema jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version)
);
CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, slug)
);
CREATE TABLE IF NOT EXISTS story_locales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  url_slug text NOT NULL,
  root_block_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  checkpoint_id uuid,
  published_version_id uuid,
  UNIQUE (story_id, slug)
);
CREATE TABLE IF NOT EXISTS block_drafts (
  id uuid PRIMARY KEY,
  locale_id uuid NOT NULL REFERENCES story_locales(id) ON DELETE CASCADE,
  schema_version_id uuid NOT NULL REFERENCES definition_versions(id),
  parent_id uuid,
  parent_field text,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  fields jsonb NOT NULL DEFAULT '{}',
  revision bigint NOT NULL DEFAULT 1,
  UNIQUE (locale_id, id),
  FOREIGN KEY (locale_id, parent_id) REFERENCES block_drafts(locale_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CHECK ((parent_id IS NULL AND parent_field IS NULL) OR (parent_id IS NOT NULL AND parent_field IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS block_drafts_root ON block_drafts(locale_id) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS block_drafts_parent ON block_drafts(locale_id, parent_id, parent_field, position);
CREATE TABLE IF NOT EXISTS edit_leases (
  locale_id uuid NOT NULL,
  block_id uuid NOT NULL,
  user_id text NOT NULL,
  session_id text NOT NULL,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (locale_id, block_id),
  FOREIGN KEY (locale_id, block_id) REFERENCES block_drafts(locale_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale_id uuid NOT NULL REFERENCES story_locales(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (locale_id, revision)
);
CREATE TABLE IF NOT EXISTS publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale_id uuid NOT NULL REFERENCES story_locales(id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL REFERENCES checkpoints(id),
  revision bigint NOT NULL,
  actor_id text NOT NULL,
  content jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mutation_receipts (
  locale_id uuid NOT NULL REFERENCES story_locales(id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  actor_id text NOT NULL,
  request_hash text NOT NULL,
  checkpoint_id uuid NOT NULL REFERENCES checkpoints(id),
  changed_block_ids jsonb NOT NULL,
  publication_id uuid REFERENCES publications(id),
  PRIMARY KEY (locale_id, mutation_id)
);
CREATE TABLE IF NOT EXISTS datasources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]',
  UNIQUE (space_id, slug)
);
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id),
  object_key text UNIQUE NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  title text NOT NULL,
  alt text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_listing ON assets(space_id, created_at DESC, id);
CREATE TABLE IF NOT EXISTS asset_folders (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id),
  name text NOT NULL,
  parent_id uuid REFERENCES asset_folders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_folders_parent ON asset_folders(space_id, parent_id);
CREATE TABLE IF NOT EXISTS asset_folder_placements (
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES asset_folders(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, folder_id)
);
CREATE TABLE IF NOT EXISTS asset_uploads (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id),
  user_id text NOT NULL,
  asset_id uuid NOT NULL UNIQUE,
  object_key text NOT NULL UNIQUE,
  r2_upload_id text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  expected_size bigint NOT NULL CHECK (expected_size > 0),
  metadata jsonb NOT NULL DEFAULT '{}',
  parts jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('uploading', 'completing', 'complete', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
