ALTER TABLE review_decisions DROP CONSTRAINT review_decisions_pkey;
ALTER TABLE review_decisions ADD PRIMARY KEY(discussion_id,user_id,version);
ALTER TABLE discussions ADD COLUMN closed_version text;
ALTER TABLE preview_sessions ADD COLUMN publication_schedule_id uuid REFERENCES publication_schedules(id) ON DELETE CASCADE;
ALTER TABLE preview_sessions ADD COLUMN schedule_revision bigint;
ALTER TABLE preview_sessions ADD CONSTRAINT preview_release_binding CHECK (
  (publication_schedule_id IS NULL AND schedule_revision IS NULL) OR
  (publication_schedule_id IS NOT NULL AND schedule_revision IS NOT NULL AND user_id IS NOT NULL)
);
