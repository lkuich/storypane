ALTER TABLE spaces ADD COLUMN public_media boolean NOT NULL DEFAULT false;
ALTER TABLE assets ADD COLUMN focal_x double precision;
ALTER TABLE assets ADD COLUMN focal_y double precision;
ALTER TABLE assets ADD COLUMN metadata_revision integer NOT NULL DEFAULT 1 CHECK (metadata_revision > 0);
ALTER TABLE assets ADD CONSTRAINT assets_focal_point CHECK (
  (focal_x IS NULL AND focal_y IS NULL) OR
  (focal_x IS NOT NULL AND focal_y IS NOT NULL AND focal_x BETWEEN 0 AND 1 AND focal_y BETWEEN 0 AND 1)
);
