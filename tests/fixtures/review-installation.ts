import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { expect } from '@playwright/test';
import { migrateInstallation, migrateSpace, sealConnection } from '@storypane/db/installation';
import { createLocalAccount } from '@storypane/db/local-auth';
import { migrate } from '@storypane/db/migrate';
import { StorypaneStore } from '@storypane/db';

// Real auth, HTTP, WebSockets and Postgres in disposable schemas; no development content is used.
export async function reviewInstallation() {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    'postgresql://storypane:storypane@127.0.0.1:55432/storypane_test';
  const target = new URL(connectionString);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.pathname !== `/${process.env.POSTGRES_DB ?? 'storypane'}_test`
  )
    throw new Error('Review e2e tests require the dedicated local test database');
  const suffix = randomUUID().replaceAll('-', '');
  const installSchema = `review_auth_${suffix}`,
    spaceSchema = `review_content_${suffix}`;
  const admin = new Pool({ connectionString });
  const scoped = (schema: string) => {
    const url = new URL(connectionString);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    return url.href;
  };
  const installationURL = scoped(installSchema),
    spaceURL = scoped(spaceSchema);
  const installation = new Pool({ connectionString: installationURL });
  const db = new Pool({ connectionString: spaceURL });
  const spaceId = randomUUID(),
    key = randomBytes(32).toString('base64');
  const password = randomBytes(24).toString('hex');
  const directory = await mkdtemp(join(tmpdir(), 'storypane-reviews-'));
  let app: ChildProcess | undefined;
  async function close() {
    if (app && app.exitCode === null && !app.signalCode) {
      const exited = once(app, 'exit');
      app.kill('SIGTERM');
      const timer = setTimeout(() => app?.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
    await Promise.all([db.end(), installation.end()]);
    await admin.query(`DROP SCHEMA IF EXISTS ${spaceSchema} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${installSchema} CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await admin.query(`CREATE SCHEMA ${installSchema}`);
    await admin.query(`CREATE SCHEMA ${spaceSchema}`);
    await migrateInstallation(installation, 'local');
    await migrate(db);
    const client = await installation.connect();
    const people: Record<string, { id: string; name: string; email: string }> = {};
    try {
      await client.query('BEGIN');
      for (const [id, name] of [
        ['admin', 'Workspace Admin'],
        ['writer', 'Alex Writer'],
        ['bob', 'Bob Reviewer'],
        ['cara', 'Cara Reviewer'],
      ]) {
        people[id] = await createLocalAccount(
          client,
          { name, email: `${id}@reviews.test`, password },
          id === 'admin',
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    for (const person of Object.values(people))
      await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
        person.id,
        person.name,
        person.email,
      ]);
    const store = new StorypaneStore(db);
    await store.seed({ userId: people.admin.id, sessionId: 'fixture', spaceId, role: 'admin' });
    await db.query('CREATE TABLE space_database(space_id uuid PRIMARY KEY)');
    await db.query('INSERT INTO space_database VALUES($1)', [spaceId]);
    await migrateSpace(db);
    await db.query(
      "INSERT INTO space_roles(space_id,id,name,permissions) VALUES($1,'writer','Writer',ARRAY['content:read','content:edit']),($1,'reviewer','Reviewer',ARRAY['content:read','content:review'])",
      [spaceId],
    );
    for (const person of ['writer', 'bob', 'cara'])
      await db.query('INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,$3)', [
        spaceId,
        people[person].id,
        person === 'writer' ? 'writer' : 'reviewer',
      ]);
    await installation.query(
      "INSERT INTO space_connections(id,name,status,mode,owner_id,connection_secret,connection_fingerprint) VALUES($1,'Review workspace','ready','attach',$2,$3,$4)",
      [
        spaceId,
        people.admin.id,
        sealConnection(spaceURL, key, spaceId),
        createHash('sha256').update(spaceURL).digest('hex'),
      ],
    );
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const origin = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const log = await open(join(directory, 'server.log'), 'a', 0o600);
    app = spawn(
      process.execPath,
      ['--conditions=storypane-node', '--import', 'tsx', 'apps/web/src/node.ts'],
      {
        env: {
          ...process.env,
          AUTH_PROVIDER: 'local',
          STORYPANE_APP_URL: origin,
          HOST: '127.0.0.1',
          PORT: String(address.port),
          INSTALLATION_DATABASE_URL: installationURL,
          INSTALLATION_ENCRYPTION_KEY: key,
          PROVISIONING_DATABASE_URL: '',
          BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
          WEBHOOK_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
          S3_ENDPOINT: 'http://127.0.0.1:1',
          S3_REGION: 'auto',
          S3_BUCKET: 'reviews-test',
          S3_ACCESS_KEY_ID: 'test',
          S3_SECRET_ACCESS_KEY: 'test',
          SMTP_URL: '',
          MAIL_FROM: '',
        },
        stdio: ['ignore', log.fd, log.fd],
      },
    );
    await log.close();
    await expect
      .poll(
        async () => {
          if (app?.exitCode !== null || app?.signalCode)
            throw new Error(`Review fixture exited; see ${directory}/server.log`);
          try {
            return (await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(2000) }))
              .status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    const story = (await db.query('SELECT id FROM stories WHERE space_id=$1', [spaceId])).rows[0];
    const locale = (
      await db.query('SELECT id,root_block_id FROM story_locales WHERE story_id=$1', [story.id])
    ).rows[0];
    return {
      origin,
      spaceId,
      people,
      password,
      storyId: story.id as string,
      localeId: locale.id as string,
      rootBlockId: locale.root_block_id as string,
      db,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
