ALTER TABLE block_drafts ADD COLUMN hidden boolean NOT NULL DEFAULT false
  CHECK (NOT hidden OR parent_id IS NOT NULL);

-- Draft usage includes authored blocks. Published usage follows visible ancestors.
CREATE FUNCTION snapshot_blocks(blocks jsonb, include_hidden boolean) RETURNS SETOF jsonb
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF include_hidden OR NOT blocks @> '[{"hidden":true}]'::jsonb THEN
    RETURN QUERY SELECT value FROM jsonb_array_elements(blocks);
  ELSE
    RETURN QUERY WITH RECURSIVE authored AS (
      SELECT value AS block FROM jsonb_array_elements(blocks)
    ), visible AS (
      SELECT block FROM authored WHERE block->>'parentId' IS NULL
      UNION ALL
      SELECT child.block FROM authored child JOIN visible parent ON child.block->>'parentId'=parent.block->>'id'
      WHERE NOT coalesce((child.block->>'hidden')::boolean,false)
    ) SELECT block FROM visible;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION refresh_page_connections(selected_locale uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source record;
BEGIN
  DELETE FROM page_connections WHERE locale_id=selected_locale;
  FOR source IN
    SELECT 'draft' AS mode,c.snapshot,c.content FROM story_locales l JOIN checkpoints c ON c.id=l.checkpoint_id WHERE l.id=selected_locale
    UNION ALL
    SELECT 'published',p.snapshot,p.content FROM story_locales l JOIN publications p ON p.id=l.published_version_id WHERE l.id=selected_locale
  LOOP
    INSERT INTO page_connections(locale_id,mode,metadata,connections,targets)
    WITH fields AS (
      SELECT b->>'id' AS block_id,d->>'id' AS definition_id,d->>'displayName' AS block_label,
        f->>'id' AS field_id,f->>'name' AS field_name,f->>'label' AS field_label,
        f,b->'fields'->(f->>'name') AS value
      FROM snapshot_blocks(source.snapshot->'blocks',source.mode='draft') b
      JOIN jsonb_array_elements(source.snapshot->'definitions') d ON d->>'versionId'=b->>'schemaVersionId'
      LEFT JOIN LATERAL jsonb_array_elements(d->'fields') f ON true
    ), links AS (
      SELECT *,CASE WHEN f->>'type'='link' THEN 'link' ELSE 'reference' END AS kind,
        jsonb_array_elements_text(CASE
          WHEN f->>'type'='link' AND value->>'type'='story' THEN jsonb_build_array(value->>'storyId')
          WHEN f->>'type' IN ('option','options') AND f->'source'->>'type'='stories' THEN
            CASE WHEN jsonb_typeof(value)='array' THEN value WHEN jsonb_typeof(value)='string' THEN jsonb_build_array(value) ELSE '[]'::jsonb END
          ELSE '[]'::jsonb END) AS target
      FROM fields
    ), valid_links AS (
      SELECT * FROM links WHERE target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    SELECT selected_locale,source.mode,
      jsonb_build_object('digest',md5(source.content::text),'title',source.snapshot->'story'->>'name','url',source.snapshot->'locale'->>'urlSlug',
        'fields',coalesce((SELECT jsonb_agg(jsonb_build_object('definitionId',definition_id,'fieldId',field_id)) FROM fields),'[]'::jsonb)),
      coalesce((SELECT jsonb_agg(jsonb_build_object('target',target,'kind',kind,'blockId',block_id,'definitionId',definition_id,
        'block',block_label,'fieldId',field_id,'field',field_name,'label',field_label)) FROM valid_links),'[]'::jsonb),
      ARRAY(SELECT DISTINCT target::uuid FROM valid_links);
  END LOOP;
END $$;
