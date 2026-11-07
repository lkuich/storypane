ALTER TABLE space_roles DROP CONSTRAINT space_roles_permissions_check;
ALTER TABLE space_roles ADD CONSTRAINT space_roles_permissions_check CHECK (permissions <@ ARRAY['content:read','content:edit','content:review','content:publish','assets:write','schemas:write','datasources:write','settings:write']::text[]);
UPDATE space_roles SET permissions=array_append(permissions,'content:review') WHERE id IN ('admin','editor') AND system;
CREATE OR REPLACE FUNCTION seed_space_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO space_roles(space_id,id,name,permissions,system) VALUES
    (NEW.id,'admin','Admin',ARRAY['content:read','content:edit','content:review','content:publish','assets:write','schemas:write','datasources:write','settings:write'],true),
    (NEW.id,'editor','Editor',ARRAY['content:read','content:edit','content:review','content:publish','assets:write'],true),
    (NEW.id,'viewer','Viewer',ARRAY['content:read'],true);
  RETURN NEW;
END;
$$;
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  member_ids text[] NOT NULL,
  minimum_approvals integer NOT NULL CHECK(minimum_approvals > 0 AND minimum_approvals <= cardinality(member_ids))
);
CREATE UNIQUE INDEX teams_name ON teams(space_id,lower(name));
CREATE TABLE discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  locale_id uuid NOT NULL REFERENCES story_locales(id) ON DELETE CASCADE,
  block_id uuid,
  block_name text,
  kind text NOT NULL CHECK(kind IN ('review','comment')),
  requester_id text NOT NULL,
  reviewer_ids text[] NOT NULL DEFAULT '{}',
  teams jsonb NOT NULL DEFAULT '[]',
  initial_version text NOT NULL,
  scope_snapshot jsonb NOT NULL,
  closed text CHECK(closed IN ('withdrawn','published','resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX discussions_locale ON discussions(locale_id,created_at DESC);
CREATE INDEX discussions_space ON discussions(space_id,created_at DESC);
CREATE TABLE review_decisions (
  discussion_id uuid NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  version text NOT NULL,
  decision text NOT NULL CHECK(decision IN ('approve','request_changes')),
  PRIMARY KEY(discussion_id,user_id)
);
CREATE TABLE discussion_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id uuid NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  body text NOT NULL DEFAULT '',
  mention_ids text[] NOT NULL DEFAULT '{}',
  event text NOT NULL,
  content_version text,
  content_revision bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX discussion_messages_thread ON discussion_messages(discussion_id,created_at,id);
