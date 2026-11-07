CREATE TABLE locale_sources (
  locale_id uuid PRIMARY KEY REFERENCES story_locales(id) ON DELETE CASCADE,
  source_locale_id uuid NOT NULL REFERENCES story_locales(id) ON DELETE CASCADE,
  baseline jsonb NOT NULL,
  mappings jsonb NOT NULL,
  needs_translation jsonb NOT NULL DEFAULT '[]',
  CHECK (locale_id <> source_locale_id)
);
