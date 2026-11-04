CREATE TABLE space_roles (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  permissions text[] NOT NULL DEFAULT '{}',
  system boolean NOT NULL DEFAULT false,
  PRIMARY KEY(space_id,id),
  CHECK (permissions <@ ARRAY['content:edit','content:publish','assets:write','schemas:write','datasources:write','settings:write']::text[])
);
CREATE UNIQUE INDEX space_roles_name ON space_roles(space_id,lower(name));
CREATE FUNCTION seed_space_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO space_roles(space_id,id,name,permissions,system) VALUES
    (NEW.id,'admin','Admin',ARRAY['content:edit','content:publish','assets:write','schemas:write','datasources:write','settings:write'],true),
    (NEW.id,'editor','Editor',ARRAY['content:edit','content:publish','assets:write'],true),
    (NEW.id,'viewer','Viewer','{}',true);
  RETURN NEW;
END;
$$;
CREATE TRIGGER space_roles_defaults AFTER INSERT ON spaces FOR EACH ROW EXECUTE FUNCTION seed_space_roles();
INSERT INTO space_roles(space_id,id,name,permissions,system)
SELECT s.id,r.id,r.name,r.permissions,true FROM spaces s CROSS JOIN (VALUES
  ('admin','Admin',ARRAY['content:edit','content:publish','assets:write','schemas:write','datasources:write','settings:write']),
  ('editor','Editor',ARRAY['content:edit','content:publish','assets:write']),
  ('viewer','Viewer','{}'::text[])
) AS r(id,name,permissions);
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE space_invitations DROP CONSTRAINT space_invitations_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_fk FOREIGN KEY(space_id,role) REFERENCES space_roles(space_id,id);
ALTER TABLE space_invitations ADD CONSTRAINT space_invitations_role_fk FOREIGN KEY(space_id,role) REFERENCES space_roles(space_id,id);
