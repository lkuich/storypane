-- Bootstrap the ledger before checking applied migrations; keep its history intact.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'blok_migrations'
  ) THEN
    ALTER TABLE blok_migrations RENAME TO storypane_migrations;
    ALTER TABLE storypane_migrations RENAME CONSTRAINT blok_migrations_pkey TO storypane_migrations_pkey;
  END IF;
END $$;
