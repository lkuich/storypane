ALTER TABLE spaces ADD COLUMN description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000);
CREATE INDEX memberships_user ON memberships(user_id);
