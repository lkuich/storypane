import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import {
  Installation,
  assertDedicatedRole,
  authProvider,
  connectionURL,
  migrateInstallation,
  migrateSpace,
} from '@storypane/db/installation';
import { accountInput, createLocalAccount } from '@storypane/db/local-auth';

class RailwaySetupError extends Error {}

// Only the Railway template uses this command; other installations keep their operator setup.
export async function prepareRailway(env: Record<string, string | undefined>) {
  let step = 'validating INSTALLATION_DATABASE_URL (a PostgreSQL URL with credentials)';
  try {
    const target = connectionURL(env.INSTALLATION_DATABASE_URL ?? '');
    step = 'validating PROVISIONING_DATABASE_URL (a PostgreSQL URL with credentials)';
    const source = connectionURL(env.PROVISIONING_DATABASE_URL ?? '');
    const role = 'storypane_installation';
    if (
      target.host !== source.host ||
      target.search !== source.search ||
      target.pathname !== `/${role}` ||
      decodeURIComponent(target.username) !== role ||
      decodeURIComponent(source.username) === role ||
      source.pathname === target.pathname
    )
      throw new RailwaySetupError(
        'Railway setup requires a dedicated storypane_installation database and role on the provisioning server',
      );
    step = 'validating AUTH_PROVIDER';
    const provider = authProvider(env.AUTH_PROVIDER ?? 'local');
    step = 'validating INSTALLATION_ENCRYPTION_KEY (base64 encoding of 32 bytes)';
    const installation = new Installation({
      connectionString: target.href,
      encryptionKey: env.INSTALLATION_ENCRYPTION_KEY ?? '',
      provider,
      provisioningURL: source.href,
    });
    const provisioner = new Pool({
      connectionString: source.href,
      max: 1,
      connectionTimeoutMillis: 10000,
    });
    try {
      step = 'connecting to PROVISIONING_DATABASE_URL';
      const client = await provisioner.connect();
      try {
        step = 'provisioning the dedicated installation database and role';
        // CREATE DATABASE cannot run in a transaction. Serialize retries on one connection.
        await client.query('SELECT pg_advisory_lock(723198455)');
        const existing = await client.query(
          'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',
          [role],
        );
        if (!existing.rowCount) {
          if (
            (
              await client.query(
                "SELECT 1 FROM pg_database WHERE datname NOT IN ('postgres','railway','template0','template1') LIMIT 1",
              )
            ).rowCount
          )
            throw new RailwaySetupError(
              'Automatic setup requires a fresh, dedicated PostgreSQL service',
            );
          if (
            (
              await client.query(
                "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1",
              )
            ).rowCount
          )
            throw new RailwaySetupError('Automatic setup requires an empty provisioning database');
          if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
            const password = decodeURIComponent(target.password).replaceAll("'", "''");
            await client.query(
              `CREATE ROLE storypane_installation LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
            );
          }
          await client.query(
            'CREATE DATABASE storypane_installation OWNER storypane_installation TEMPLATE template0',
          );
        } else if (existing.rows[0].owner !== role) {
          throw new RailwaySetupError(
            'Installation database owner mismatch; no ownership changes were made',
          );
        }
        // A freshly created role otherwise inherits CONNECT to the template's default databases.
        for (const name of ['postgres', 'railway', 'template1', role]) {
          if ((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
            await client.query(`REVOKE CONNECT ON DATABASE "${name}" FROM PUBLIC`);
        }
        await client.query(
          'GRANT CONNECT ON DATABASE storypane_installation TO storypane_installation',
        );
      } finally {
        // Closing the connection releases its session lock even after a failed statement.
        client.release(true);
      }
      step = 'connecting to INSTALLATION_DATABASE_URL and checking role isolation';
      await assertDedicatedRole(installation.pool);
      step = 'applying installation migrations';
      await migrateInstallation(installation.pool, installation.options.provider);
      if (installation.options.provider === 'local') {
        step = 'creating the initial administrator';
        const client = await installation.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(723198454)');
          if (!(await client.query('SELECT 1 FROM "user" WHERE installation_admin')).rowCount) {
            if ((await client.query('SELECT 1 FROM "user" LIMIT 1')).rowCount)
              throw new RailwaySetupError(
                'Existing accounts require operator recovery, not initial setup',
              );
            const account = accountInput.safeParse({
              name: env.STORYPANE_ADMIN_NAME,
              email: env.STORYPANE_ADMIN_EMAIL,
              password: env.STORYPANE_ADMIN_PASSWORD,
            });
            if (!account.success) {
              const fields = {
                name: 'STORYPANE_ADMIN_NAME (1–120 characters)',
                email: 'STORYPANE_ADMIN_EMAIL (valid email address)',
                password: 'STORYPANE_ADMIN_PASSWORD (12–128 characters)',
              };
              const invalid = Object.keys(fields).filter((field) =>
                account.error.issues.some((issue) => issue.path[0] === field),
              );
              throw new RailwaySetupError(
                `Invalid initial admin fields: ${invalid.map((field) => fields[field as keyof typeof fields]).join(', ')}`,
              );
            }
            await createLocalAccount(client, account.data, true);
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
      step = 'migrating registered spaces';
      const failed = await installation.forEachSpace(async (id) => {
        const selected = await installation.acquire(id);
        try {
          await migrateSpace(selected.db);
        } finally {
          await selected.close();
        }
      });
      if (failed.length)
        throw new RailwaySetupError('Some space migrations failed; the deployment was stopped');
    } finally {
      await provisioner.end();
      await installation.pool.end();
    }
  } catch (error) {
    if (error instanceof RailwaySetupError) throw error;
    // Only fixed diagnostics are safe: driver messages can contain credentials and SQL.
    const hints: Record<string, string> = {
      '28P01':
        'Database authentication failed; check the password in the indicated URL. Existing role passwords are never reset.',
      '42501': 'The database role lacks the required permission.',
      '3D000': 'The requested database does not exist.',
      ECONNREFUSED: 'The database refused the connection.',
      ENOTFOUND: 'The database hostname could not be resolved.',
      EAI_AGAIN: 'The database hostname could not be resolved temporarily.',
      ETIMEDOUT: 'The database connection timed out.',
    };
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    throw new RailwaySetupError(
      `Railway setup failed while ${step}.${typeof code === 'string' && Object.hasOwn(hints, code) ? ' ' + hints[code] : ''}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await prepareRailway(process.env);
    console.log('Railway installation prepared. Existing accounts and data were preserved.');
  } catch (error) {
    // PostgreSQL errors may contain URLs/passwords; never print them in provider build logs.
    if (error instanceof RailwaySetupError) console.error(error.message);
    console.error(
      'Railway setup failed. Check the database connections, generated keys, and initial admin fields. Existing databases were retained. See docs/deploy-railway.md.',
    );
    process.exitCode = 1;
  }
}
