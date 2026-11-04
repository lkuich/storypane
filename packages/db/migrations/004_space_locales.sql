CREATE TABLE space_locales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  slug text NOT NULL CHECK (slug='' OR (slug ~ '^[a-zA-Z0-9][a-zA-Z0-9-]*$' AND length(slug)<=30)),
  UNIQUE (space_id,slug),
  UNIQUE (id,slug,name)
);
INSERT INTO space_locales(space_id,name,slug) SELECT id,'Default','' FROM spaces;
INSERT INTO space_locales(space_id,name,slug)
  SELECT DISTINCT ON (s.space_id,l.slug) s.space_id,l.name,l.slug
  FROM story_locales l JOIN stories s ON s.id=l.story_id WHERE l.slug<>''
  ORDER BY s.space_id,l.slug,l.id;
ALTER TABLE story_locales ADD COLUMN space_locale_id uuid;
UPDATE story_locales l SET space_locale_id=c.id,name=c.name
  FROM stories s,space_locales c WHERE s.id=l.story_id AND c.space_id=s.space_id AND c.slug=l.slug;
ALTER TABLE story_locales ALTER COLUMN space_locale_id SET NOT NULL;
-- Keep row readers compatible while making space settings authoritative for locale metadata.
ALTER TABLE story_locales ADD CONSTRAINT story_locale_settings
  FOREIGN KEY (space_locale_id,slug,name) REFERENCES space_locales(id,slug,name) ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX story_locales_space_locale ON story_locales(space_locale_id);
