-- NULL preserves the existing migration-only capabilities.
ALTER TABLE schema_management_tokens ADD COLUMN scopes text[];
ALTER TABLE schema_management_tokens ADD CONSTRAINT management_token_scopes CHECK (
  scopes IS NULL OR (
    'read' = ANY(scopes) AND
    scopes <@ ARRAY['read','content:edit','content:publish','assets:write','schemas:write','datasources:write','settings:write','admin']::text[]
  )
);
