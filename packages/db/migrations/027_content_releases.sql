CREATE TABLE content_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  creator_id text NOT NULL,
  due_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','held','published','cancelled')),
  revision integer NOT NULL DEFAULT 1,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE publication_schedules ADD COLUMN release_id uuid REFERENCES content_releases(id),
  ADD COLUMN approved_snapshot jsonb,
  ADD COLUMN cancelled_by_release boolean NOT NULL DEFAULT false;

-- Preserve every existing schedule and its history as an independent release.
INSERT INTO content_releases(id,space_id,name,creator_id,due_at,timezone,status,error,created_at,updated_at)
SELECT id,space_id,'Scheduled release',creator_id,due_at,timezone,
  CASE status WHEN 'pending' THEN 'scheduled' WHEN 'failed' THEN 'held' ELSE status END,
  error,created_at,updated_at FROM publication_schedules;
UPDATE publication_schedules SET release_id=id,cancelled_by_release=(status='cancelled');
ALTER TABLE publication_schedules ALTER COLUMN release_id SET NOT NULL;
CREATE INDEX content_releases_space ON content_releases(space_id,due_at);
CREATE INDEX publication_schedules_release ON publication_schedules(release_id);

-- Publishing, deleting or moving a page invalidates any open review of its release.
CREATE FUNCTION bump_content_release_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE content_releases SET revision=revision+1,updated_at=clock_timestamp()
    WHERE id=COALESCE(NEW.release_id,OLD.release_id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER content_release_members_changed AFTER INSERT OR UPDATE OR DELETE ON publication_schedules
FOR EACH ROW EXECUTE FUNCTION bump_content_release_revision();
