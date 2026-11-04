ALTER TABLE stories ADD COLUMN IF NOT EXISTS updated_by text;

UPDATE stories s SET updated_by=(
  SELECT c.actor_id FROM story_locales l JOIN checkpoints c ON c.id=l.checkpoint_id
  WHERE l.story_id=s.id ORDER BY c.created_at DESC,c.id DESC LIMIT 1
) WHERE s.updated_by IS NULL;
