CREATE TABLE IF NOT EXISTS story_pins (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, story_id)
);
CREATE INDEX IF NOT EXISTS story_pins_story ON story_pins(story_id);
