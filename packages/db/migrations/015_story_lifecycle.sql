ALTER TABLE stories ADD COLUMN deleted_at timestamptz;
ALTER TABLE stories ADD COLUMN deleted_by text;
CREATE TABLE story_action_receipts (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(space_id,actor_id,request_id)
);
