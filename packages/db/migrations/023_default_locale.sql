ALTER TABLE space_locales ADD COLUMN is_default boolean NOT NULL DEFAULT false;
UPDATE space_locales SET is_default=true WHERE slug='';
CREATE UNIQUE INDEX space_locales_default ON space_locales(space_id) WHERE is_default;
