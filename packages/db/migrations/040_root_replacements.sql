ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS root_replacements jsonb NOT NULL DEFAULT '[]';
