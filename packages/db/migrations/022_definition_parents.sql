ALTER TABLE definitions ADD COLUMN parent_definition_id uuid;
CREATE UNIQUE INDEX definitions_space_identity ON definitions(space_id,id);
ALTER TABLE definitions ADD CONSTRAINT definitions_parent_space_fk
  FOREIGN KEY(space_id,parent_definition_id) REFERENCES definitions(space_id,id);
ALTER TABLE definitions ADD CONSTRAINT definitions_not_own_parent
  CHECK(parent_definition_id IS DISTINCT FROM id);

-- Preserve organization created before parents were separated from versioned schemas.
UPDATE definitions d SET parent_definition_id=(v.schema->>'parentDefinitionId')::uuid
FROM definition_versions v
WHERE v.definition_id=d.id AND v.version=d.current_version
  AND v.schema->>'parentDefinitionId' IS NOT NULL;
