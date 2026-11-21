ALTER TABLE content_releases
  DROP CONSTRAINT content_releases_status_check,
  ALTER COLUMN due_at DROP NOT NULL,
  ADD CONSTRAINT content_releases_status_check
    CHECK (status IN ('draft','scheduled','held','published','cancelled')),
  ADD CONSTRAINT content_releases_due_at_check
    CHECK ((status='draft' AND due_at IS NULL AND NOT immediate)
      OR (status='cancelled' AND (due_at IS NOT NULL OR NOT immediate))
      OR (status IN ('scheduled','held','published') AND due_at IS NOT NULL));

ALTER TABLE publication_schedules
  ALTER COLUMN due_at DROP NOT NULL,
  ALTER COLUMN next_attempt_at DROP NOT NULL;
