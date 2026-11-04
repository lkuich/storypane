ALTER TABLE space_roles ADD COLUMN content_scopes jsonb NOT NULL DEFAULT '{"read":{"locations":null,"localeIds":null,"definitionIds":null,"fieldIds":null},"edit":{"locations":null,"localeIds":null,"definitionIds":null,"fieldIds":null},"publish":{"locations":null,"localeIds":null,"definitionIds":null,"fieldIds":null}}';
ALTER TABLE space_roles DROP CONSTRAINT space_roles_permissions_check;
ALTER TABLE space_roles ADD CONSTRAINT space_roles_permissions_check CHECK (permissions <@ ARRAY['content:read','content:edit','content:publish','assets:write','schemas:write','datasources:write','settings:write']::text[]);
UPDATE space_roles SET permissions=array_prepend('content:read',permissions);
CREATE OR REPLACE FUNCTION seed_space_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO space_roles(space_id,id,name,permissions,system) VALUES
    (NEW.id,'admin','Admin',ARRAY['content:read','content:edit','content:publish','assets:write','schemas:write','datasources:write','settings:write'],true),
    (NEW.id,'editor','Editor',ARRAY['content:read','content:edit','content:publish','assets:write'],true),
    (NEW.id,'viewer','Viewer',ARRAY['content:read'],true);
  RETURN NEW;
END;
$$;
