ALTER TABLE spaces ADD COLUMN environment text NOT NULL DEFAULT 'prod' CHECK(environment IN ('prod','dev'));
ALTER TABLE spaces ADD COLUMN schema_read_only boolean NOT NULL DEFAULT false;
ALTER TABLE spaces ADD COLUMN production_space_id uuid;
ALTER TABLE spaces ADD CONSTRAINT space_environment_link CHECK(production_space_id IS NULL OR (environment='dev' AND production_space_id<>id));
ALTER TABLE spaces ADD COLUMN schema_hierarchy_baseline jsonb NOT NULL DEFAULT '{}';
UPDATE spaces s SET schema_hierarchy_baseline=coalesce((SELECT jsonb_object_agg(id::text,parent_definition_id) FROM definitions WHERE space_id=s.id),'{}');
CREATE TABLE schema_branches (
  space_id uuid PRIMARY KEY REFERENCES spaces(id),
  production_head uuid NOT NULL,
  baseline jsonb NOT NULL,
  local_version integer NOT NULL,
  pending jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE schema_transfers (
  id uuid PRIMARY KEY,
  source_space_id uuid NOT NULL,
  source_head uuid NOT NULL,
  review_token text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
