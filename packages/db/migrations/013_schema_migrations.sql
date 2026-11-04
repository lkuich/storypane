ALTER TABLE spaces ADD COLUMN schema_version integer NOT NULL DEFAULT 0;
CREATE TABLE schema_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version >= 0),
  base_version integer NOT NULL CHECK(base_version >= 0),
  name text NOT NULL,
  status text NOT NULL CHECK(status IN ('active','deployed')),
  revision integer NOT NULL DEFAULT 1,
  definitions jsonb NOT NULL,
  contributors text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  deployed_at timestamptz,
  deployed_by text,
  review_token text,
  UNIQUE(space_id,version)
);
CREATE UNIQUE INDEX schema_migrations_active ON schema_migrations(space_id) WHERE status='active';
CREATE TABLE schema_management_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id),
  name text NOT NULL,
  capability text NOT NULL CHECK(capability IN ('read','stage','deploy')),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Historical fields with the same definition/name share their initial identity.
WITH identities AS MATERIALIZED (
  SELECT definition_id, field->>'name' AS name, gen_random_uuid() AS id
  FROM definition_versions, jsonb_array_elements(schema->'fields') field
  GROUP BY definition_id,field->>'name'
), updated AS (
  SELECT v.id, jsonb_agg(field || jsonb_build_object('id',i.id) ORDER BY position) AS fields
  FROM definition_versions v, jsonb_array_elements(v.schema->'fields') WITH ORDINALITY f(field,position), identities i
  WHERE i.definition_id=v.definition_id AND i.name=field->>'name' GROUP BY v.id
)
UPDATE definition_versions v SET schema=jsonb_set(v.schema,'{fields}',updated.fields) FROM updated WHERE v.id=updated.id;

INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions,deployed_at)
SELECT s.id,0,0,'Legacy baseline','deployed',coalesce(jsonb_agg(v.schema || jsonb_build_object('id',d.id,'versionId',v.id,'version',v.version,'createdAt',v.created_at) ORDER BY d.name) FILTER(WHERE d.id IS NOT NULL),'[]'),now()
FROM spaces s LEFT JOIN definitions d ON d.space_id=s.id LEFT JOIN definition_versions v ON v.definition_id=d.id AND v.version=d.current_version GROUP BY s.id;
INSERT INTO schema_migrations(space_id,version,base_version,name,status,definitions)
SELECT space_id,1,0,'Initial schema migration','active',definitions FROM schema_migrations WHERE version=0 AND jsonb_array_length(definitions)>0;
