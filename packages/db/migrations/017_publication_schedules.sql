CREATE TABLE publication_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  locale_id uuid NOT NULL REFERENCES story_locales(id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL REFERENCES checkpoints(id),
  schema_version integer NOT NULL,
  creator_id text NOT NULL,
  due_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','cancelled','failed')),
  revision integer NOT NULL DEFAULT 1,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  publication_id uuid REFERENCES publications(id),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX publication_schedules_pending ON publication_schedules(locale_id) WHERE status='pending';
CREATE INDEX publication_schedules_due ON publication_schedules(next_attempt_at) WHERE status='pending';
