CREATE TABLE content_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  parent_id uuid,
  name text NOT NULL,
  slug text NOT NULL,
  locale_slugs jsonb NOT NULL DEFAULT '{}',
  allowed_definition_ids uuid[] NOT NULL DEFAULT '{}',
  default_definition_id uuid REFERENCES definitions(id),
  form_only boolean NOT NULL DEFAULT false,
  UNIQUE (space_id,id),
  FOREIGN KEY (space_id,parent_id) REFERENCES content_folders(space_id,id) ON DELETE RESTRICT
);
CREATE INDEX content_folders_parent ON content_folders(space_id,parent_id);
ALTER TABLE stories ADD COLUMN folder_id uuid;
ALTER TABLE stories ADD COLUMN slug_segment text;
ALTER TABLE stories ADD CONSTRAINT stories_folder FOREIGN KEY (space_id,folder_id) REFERENCES content_folders(space_id,id) ON DELETE RESTRICT;
CREATE INDEX stories_folder ON stories(folder_id);
UPDATE stories SET slug_segment=slug;
ALTER TABLE story_locales ADD COLUMN slug_segment text;
UPDATE story_locales SET slug_segment=url_slug;
ALTER TABLE stories DROP CONSTRAINT stories_space_id_slug_key;
ALTER TABLE stories ADD CONSTRAINT stories_space_id_slug_key UNIQUE (space_id,slug) DEFERRABLE INITIALLY DEFERRED;
