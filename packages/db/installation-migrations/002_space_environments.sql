ALTER TABLE space_connections ADD COLUMN environment text NOT NULL DEFAULT 'prod' CHECK(environment IN ('prod','dev'));
ALTER TABLE space_connections ADD COLUMN production_space_id uuid REFERENCES space_connections(id);
ALTER TABLE space_connections ADD COLUMN clone_source_id uuid REFERENCES space_connections(id);
ALTER TABLE space_connections ADD COLUMN clone_review_token text;
ALTER TABLE space_connections ADD COLUMN clone_complete boolean NOT NULL DEFAULT true;
