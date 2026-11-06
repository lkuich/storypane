#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --set=ON_ERROR_STOP=1 --set=installation_password="$INSTALLATION_DB_PASSWORD" <<'SQL'
REVOKE CONNECT ON DATABASE postgres,template1 FROM PUBLIC;
CREATE ROLE storypane_installation LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'installation_password';
CREATE DATABASE storypane_installation OWNER storypane_installation TEMPLATE template0;
REVOKE ALL ON DATABASE storypane_installation FROM PUBLIC;
GRANT CONNECT ON DATABASE storypane_installation TO storypane_installation;
SQL
