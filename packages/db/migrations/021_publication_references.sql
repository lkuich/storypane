ALTER TABLE publication_schedules
  ADD COLUMN reference_choices jsonb NOT NULL DEFAULT '[]'::jsonb;
