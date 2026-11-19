ALTER TABLE story_locales ADD COLUMN excluded boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT excluded_locales_are_unpublished CHECK (NOT excluded OR published_version_id IS NULL);
CREATE VIEW included_story_locales AS SELECT * FROM story_locales WHERE NOT excluded;
