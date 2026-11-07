import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Installation, assertDedicatedRole } from '@storypane/db/installation';
import { localAuth } from '@storypane/db/local-auth';
import { prepareRailway } from '../scripts/prepare-railway';

it('rejects a shared role or different database host before connecting', async () => {
  const env = {
    PROVISIONING_DATABASE_URL: 'postgresql://operator:password@localhost/railway',
    INSTALLATION_DATABASE_URL: 'postgresql://operator:password@localhost/storypane_installation',
  };
  await expect(prepareRailway(env)).rejects.toThrow('dedicated');
  await expect(
    prepareRailway({
      ...env,
      INSTALLATION_DATABASE_URL:
        'postgresql://storypane_installation:password@other/storypane_installation',
    }),
  ).rejects.toThrow('dedicated');
});

it.each([
  ['INSTALLATION_DATABASE_URL', 'postgresql://secret:do-not-log@invalid'],
  ['PROVISIONING_DATABASE_URL', 'not-a-url-do-not-log'],
  ['INSTALLATION_ENCRYPTION_KEY', 'do-not-log'],
  ['AUTH_PROVIDER', 'INVALID-do-not-log'],
])('logs the rejected %s without leaking its value', (field, value) => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-railway.ts'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INSTALLATION_DATABASE_URL:
        'postgresql://storypane_installation:password@localhost/storypane_installation',
      PROVISIONING_DATABASE_URL: 'postgresql://operator:password@localhost/railway',
      INSTALLATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      AUTH_PROVIDER: 'local',
      [field]: value,
    },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`validating ${field}`);
  expect(result.stderr).toContain('Existing databases were retained');
  expect(result.stderr).not.toContain(value);
  expect(result.stderr).not.toContain('do-not-log');
});

const source = process.env.RAILWAY_TEST_DATABASE_URL;
describe.skipIf(!source)('Railway first install on a disposable PostgreSQL service', () => {
  const target = new URL(source ?? 'postgresql://operator:password@127.0.0.1:55448/railway');
  target.username = 'storypane_installation';
  target.password = randomBytes(24).toString('hex');
  target.pathname = '/storypane_installation';
  const env = {
    PROVISIONING_DATABASE_URL: source,
    INSTALLATION_DATABASE_URL: target.href,
    INSTALLATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    STORYPANE_ADMIN_NAME: 'Railway Admin',
    STORYPANE_ADMIN_EMAIL: 'railway@example.test',
    STORYPANE_ADMIN_PASSWORD: 'initial-railway-password',
  };
  const operator = new Pool({ connectionString: source, max: 2 });
  const installation = new Installation({
    connectionString: target.href,
    encryptionKey: env.INSTALLATION_ENCRYPTION_KEY,
    provisioningURL: source,
    provider: 'local',
  });
  beforeAll(async () => {
    const url = new URL(source!);
    if (url.hostname !== '127.0.0.1' || url.port !== '55448' || url.pathname !== '/railway')
      throw new Error('Railway tests require the disposable localhost:55448/railway cluster');
    expect(
      (await operator.query("SELECT 1 FROM pg_database WHERE datname='storypane_installation'"))
        .rowCount,
    ).toBe(0);
  });
  afterAll(async () => {
    await installation.pool.end();
    await operator.end();
  });

  it('reports provisioning authentication failure without logging driver credentials', () => {
    const rejected = new URL(source!);
    rejected.username = 'do-not-log-user';
    rejected.password = 'do-not-log-password';
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-railway.ts'], {
      encoding: 'utf8',
      env: { ...process.env, ...env, PROVISIONING_DATABASE_URL: rejected.href },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('connecting to PROVISIONING_DATABASE_URL');
    expect(result.stderr).toContain('Database authentication failed');
    expect(result.stderr).not.toContain('do-not-log');
    expect(result.stderr).not.toContain(rejected.href);
  });

  it('refuses automatic provisioning on a shared cluster', async () => {
    await operator.query('CREATE DATABASE unrelated');
    try {
      await expect(prepareRailway(env)).rejects.toThrow('fresh, dedicated');
      expect(
        (await operator.query("SELECT 1 FROM pg_roles WHERE rolname='storypane_installation'"))
          .rowCount,
      ).toBe(0);
    } finally {
      await operator.query('DROP DATABASE unrelated');
    }
  });

  it('retains the database after failed bootstrap and retries without duplicate administrators', async () => {
    await operator.query('CREATE TABLE unrelated(id int)');
    try {
      await expect(prepareRailway(env)).rejects.toThrow('empty provisioning database');
    } finally {
      await operator.query('DROP TABLE unrelated');
    }
    await expect(prepareRailway({ ...env, STORYPANE_ADMIN_PASSWORD: 'short' })).rejects.toThrow(
      'STORYPANE_ADMIN_PASSWORD (12–128 characters)',
    );
    await expect(
      prepareRailway({ ...env, STORYPANE_ADMIN_NAME: '', STORYPANE_ADMIN_EMAIL: 'invalid' }),
    ).rejects.toThrow(
      'STORYPANE_ADMIN_NAME (1–120 characters), STORYPANE_ADMIN_EMAIL (valid email address)',
    );
    expect((await installation.pool.query('SELECT 1 FROM "user"')).rowCount).toBe(0);
    await Promise.all([prepareRailway(env), prepareRailway(env)]);
    const users = (await installation.pool.query('SELECT * FROM "user"')).rows;
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: env.STORYPANE_ADMIN_EMAIL, installation_admin: true });
    await assertDedicatedRole(installation.pool);
  });

  it('preserves passwords, sessions, spaces and migration history across redeploys', async () => {
    const auth = localAuth(installation.pool, {
      appURL: 'http://localhost:3130',
      secret: randomBytes(32).toString('base64'),
    });
    const login = () =>
      auth.handler(
        new Request('http://localhost:3130/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:3130' },
          body: JSON.stringify({
            email: env.STORYPANE_ADMIN_EMAIL,
            password: env.STORYPANE_ADMIN_PASSWORD,
          }),
        }),
      );
    const response = await login();
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const user = (await installation.pool.query('SELECT id FROM "user"')).rows[0];
    const spaces = [randomUUID(), randomUUID()];
    for (const id of spaces)
      await installation.provision(user.id, { id, name: id, mode: 'create' });
    const selected = await installation.acquire(spaces[0]);
    try {
      const migrations = (
        await selected.db.query('SELECT * FROM storypane_migrations ORDER BY name')
      ).rows;
      await prepareRailway({ ...env, STORYPANE_ADMIN_PASSWORD: 'different-password-not-applied' });
      await prepareRailway({
        ...env,
        STORYPANE_ADMIN_NAME: undefined,
        STORYPANE_ADMIN_EMAIL: undefined,
        STORYPANE_ADMIN_PASSWORD: undefined,
      });
      expect(
        (await selected.db.query('SELECT * FROM storypane_migrations ORDER BY name')).rows,
      ).toEqual(migrations);
      await assertDedicatedRole(selected.db);
      expect(
        (await installation.pool.query("SELECT id FROM space_connections WHERE status='ready'"))
          .rowCount,
      ).toBe(2);
      expect((await login()).status).toBe(200);
      expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    } finally {
      await selected.close();
    }
  });

  it('never resets an existing database password to make a redeploy succeed', async () => {
    const changed = new URL(target);
    changed.password = 'incorrect-database-password';
    await expect(
      prepareRailway({ ...env, INSTALLATION_DATABASE_URL: changed.href }),
    ).rejects.toThrow('Database authentication failed');
    await expect(installation.pool.query('SELECT 1')).resolves.toBeDefined();
  });
});
