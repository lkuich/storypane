ALTER TABLE installation_config DROP CONSTRAINT installation_config_auth_provider_check;
ALTER TABLE installation_config ADD CONSTRAINT installation_config_auth_provider_check
  CHECK (auth_provider ~ '^[a-z][a-z0-9-]{0,63}$');
