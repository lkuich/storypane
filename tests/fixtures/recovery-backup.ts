import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect } from '@playwright/test';
import { Installation, openConnection } from '@storypane/db/installation';
import { testWebhook, deleteWebhook } from '../../packages/db/src/webhooks';
import { rowDigest } from './recovery-data';
import {
  startTestMedia,
  mediaClient,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from './test-media';
import type { OperationalInstallation } from './operational';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
async function tables(pool: Pool) {
  const rows = (
    await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows;
  const result = [];
  for (const { tablename } of rows) {
    const data = (
      await pool.query(`SELECT to_jsonb(t) AS row FROM ${identifier(tablename)} t`)
    ).rows.map((r) => r.row);
    result.push({ table: tablename, count: data.length, sha256: rowDigest(data) });
  }
  return result;
}
const roleQuery =
  "SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolcanlogin,rolinherit,rolreplication,rolbypassrls,rolpassword FROM pg_authid WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname";
export async function backupAndRestore(
  f: OperationalInstallation,
  endpointId: string,
  actorId: string,
) {
  mkdirSync('artifacts/operational-runs', { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(resolve('artifacts/operational-runs/restore-'));
  const runtime = Object.fromEntries(
    Object.entries(f.environment).filter(([key]) =>
      /^(AUTH_PROVIDER$|BETTER_AUTH_SECRET$|INSTALLATION_|PROVISIONING_DATABASE_URL$|S3_|STORYPANE_APP_URL$|WEBHOOK_)/.test(
        key,
      ),
    ),
  );
  writeFileSync(directory + '/runtime.json', JSON.stringify(runtime), { mode: 0o600 });
  const targetName = 'storypane-restore-test-' + randomUUID();
  let container = false,
    app: ChildProcess | undefined,
    media: Awaited<ReturnType<typeof startTestMedia>> | undefined;
  const source = new Pool({ connectionString: f.operatorURL, ssl: f.databaseSSL });
  const spaceUrl = new URL(f.operatorURL);
  spaceUrl.pathname = '/sp_' + f.spaceId.replaceAll('-', '');
  const space = new Pool({ connectionString: spaceUrl.href, ssl: f.databaseSSL });
  const docker = (...args: string[]) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
  async function close() {
    try {
      if (app?.pid && app.exitCode === null && app.signalCode === null) {
        const exited = once(app, 'exit');
        app.kill('SIGKILL');
        await exited;
      }
      await media?.close();
      if (container) docker('rm', '--force', targetName);
    } finally {
      try {
        const client = await space.connect();
        let committed = false;
        try {
          await client.query('BEGIN');
          await deleteWebhook(client, f.spaceId, endpointId, { expectedRevision: 1 });
          await client.query('COMMIT');
          committed = true;
        } finally {
          if (!committed) await client.query('ROLLBACK');
          client.release();
        }
      } finally {
        await Promise.all([space.end(), source.end()]);
        await f.start();
      }
    }
  }
  try {
    await f.stop();
    const client = await space.connect();
    let pending: { eventId: string; deliveryId: string };
    try {
      await client.query('BEGIN');
      pending = await testWebhook(client, f.spaceId, endpointId, actorId, {
        encryptionKey: f.environment.WEBHOOK_ENCRYPTION_KEY,
        allowedHosts: [new URL(f.destination).hostname],
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const started = Date.now(),
      url = new URL(f.operatorURL);
    const pgEnv = {
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: f.databaseSSL ? 'require' : 'disable',
    };
    writeFileSync(
      directory + '/source.env',
      Object.entries(pgEnv)
        .map(([k, v]) => k + '=' + v)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    const network =
      url.hostname === '127.0.0.1' && process.platform === 'linux' ? ['--network', 'host'] : [];
    const run = (command: string) =>
      docker(
        'run',
        '--rm',
        ...network,
        '--env-file',
        directory + '/source.env',
        '-v',
        directory + ':/backup',
        'postgres:18-alpine',
        'sh',
        '-c',
        'umask 077; ' + command,
      );
    // Linux containers reach a local fixture through Docker's host gateway.
    if (url.hostname === '127.0.0.1' && process.platform !== 'linux')
      pgEnv.PGHOST = 'host.docker.internal';
    writeFileSync(
      directory + '/source.env',
      Object.entries(pgEnv)
        .map(([k, v]) => k + '=' + v)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    const names = (
      await source.query(
        "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1') ORDER BY datname",
      )
    ).rows.map((r) => String(r.datname));
    const manifest: {
      databases: Record<string, Awaited<ReturnType<typeof tables>>>;
      objects: { key: string; file: string; sha256: string; contentType: string | undefined }[];
      roles: { name: string; sha256: string }[];
      backupMs: number;
      restoreMs: number;
    } = { databases: {}, objects: [], roles: [], backupMs: 0, restoreMs: 0 };
    run('pg_dumpall --roles-only > /backup/roles.sql');
    for (const [index, name] of names.entries()) {
      assert.match(name, /^[a-z0-9_]+$/);
      const db = new URL(f.operatorURL);
      db.pathname = '/' + name;
      const pool = new Pool({ connectionString: db.href, ssl: f.databaseSSL });
      try {
        manifest.databases[name] = await tables(pool);
      } finally {
        await pool.end();
      }
      run(`pg_dump --format=custom --create --dbname=${name} --file=/backup/db-${index}.dump`);
    }
    manifest.roles = (await source.query(roleQuery)).rows.map((role) => ({
      name: role.rolname,
      sha256: rowDigest([role]),
    }));
    const original = mediaClient(f.environment);
    let continuation: string | undefined;
    try {
      do {
        const page = await original.send(
          new ListObjectsV2Command({
            Bucket: f.environment.S3_BUCKET,
            ContinuationToken: continuation,
          }),
        );
        for (const object of page.Contents ?? []) {
          assert(object.Key);
          const response = await original.send(
            new GetObjectCommand({ Bucket: f.environment.S3_BUCKET, Key: object.Key }),
          );
          const bytes = Buffer.from(await response.Body.transformToByteArray());
          const file = 'object-' + manifest.objects.length;
          writeFileSync(directory + '/' + file, bytes, { mode: 0o600 });
          manifest.objects.push({
            key: object.Key,
            file,
            sha256: hash(bytes),
            contentType: response.ContentType,
          });
        }
        continuation = page.NextContinuationToken;
      } while (continuation);
    } finally {
      original.destroy();
    }
    manifest.backupMs = Date.now() - started;
    const restoreStarted = Date.now();
    const password = randomBytes(24).toString('hex');
    writeFileSync(
      directory + '/target.env',
      `POSTGRES_USER=restore_operator\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=postgres\n`,
      { mode: 0o600 },
    );
    docker(
      'run',
      '--detach',
      '--rm',
      '--name',
      targetName,
      '--env-file',
      directory + '/target.env',
      '-p',
      '127.0.0.1::5432',
      '-v',
      directory + ':/backup:ro',
      'postgres:18-alpine',
    );
    container = true;
    const port = docker('port', targetName, '5432').trim().split(':').at(-1)!;
    await expect
      .poll(
        () => {
          try {
            docker('exec', targetName, 'pg_isready', '-U', 'restore_operator', '-d', 'postgres');
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 30000 },
      )
      .toBe(true);
    docker(
      'exec',
      targetName,
      'psql',
      '-U',
      'restore_operator',
      '-d',
      'postgres',
      '--set',
      'ON_ERROR_STOP=1',
      '-f',
      '/backup/roles.sql',
    );
    for (let i = 0; i < names.length; i++)
      docker(
        'exec',
        targetName,
        'pg_restore',
        '-U',
        'restore_operator',
        '--create',
        '--exit-on-error',
        '--dbname=postgres',
        `/backup/db-${i}.dump`,
      );
    const targetURL = new URL(
        `postgresql://restore_operator:${password}@127.0.0.1:${port}/postgres`,
      ),
      operator = new Pool({ connectionString: targetURL.href });
    try {
      const roles = (await operator.query(roleQuery)).rows;
      for (const role of manifest.roles)
        assert.equal(
          rowDigest([roles.find((r) => r.rolname === role.name)]),
          role.sha256,
          'Role changed after restore',
        );
      await operator.query('REVOKE CONNECT ON DATABASE postgres,template1 FROM PUBLIC');
    } finally {
      await operator.end();
    }
    for (const name of names) {
      const url = new URL(targetURL);
      url.pathname = '/' + name;
      const pool = new Pool({ connectionString: url.href });
      try {
        assert.deepEqual(
          await tables(pool),
          manifest.databases[name],
          `Restored rows differ: ${name}`,
        );
      } finally {
        await pool.end();
      }
    }
    media = await startTestMedia();
    const targetMedia = mediaClient(media.env);
    try {
      for (const object of manifest.objects) {
        const bytes = readFileSync(directory + '/' + object.file);
        assert.equal(hash(bytes), object.sha256);
        await targetMedia.send(
          new PutObjectCommand({
            Bucket: media.env.S3_BUCKET,
            Key: object.key,
            Body: bytes,
            ContentType: object.contentType,
          }),
        );
        const response: { Body: { transformToByteArray(): Promise<Uint8Array> } } =
          await targetMedia.send(
            new GetObjectCommand({ Bucket: media.env.S3_BUCKET, Key: object.key }),
          );
        assert.equal(hash(Buffer.from(await response.Body.transformToByteArray())), object.sha256);
      }
    } finally {
      targetMedia.destroy();
    }
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const address = probe.address();
    assert(address && typeof address !== 'string');
    await new Promise<void>((r) => probe.close(() => r()));
    const origin = 'http://127.0.0.1:' + address.port;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...f.environment,
      NODE_ENV: 'production',
      ...media.env,
      STORYPANE_APP_URL: origin,
      HOST: '127.0.0.1',
      PORT: String(address.port),
      SMTP_URL: '',
      MAIL_FROM: '',
      EXTERNAL_OPTION_HOSTS: '',
    };
    for (const key of ['INSTALLATION_DATABASE_URL', 'PROVISIONING_DATABASE_URL'] as const) {
      const u = new URL(env[key]!);
      u.hostname = '127.0.0.1';
      u.port = port;
      u.search = '';
      env[key] = u.href;
    }
    const installation = new Installation({
      connectionString: env.INSTALLATION_DATABASE_URL!,
      provider: 'local',
      encryptionKey: env.INSTALLATION_ENCRYPTION_KEY!,
    });
    try {
      const connections = (
        await installation.pool.query(
          "SELECT id,connection_secret FROM space_connections WHERE status='ready'",
        )
      ).rows;
      for (const row of connections) {
        const url = new URL(
          openConnection(row.connection_secret, env.INSTALLATION_ENCRYPTION_KEY!, row.id),
        );
        url.hostname = '127.0.0.1';
        url.port = port;
        url.search = '';
        await installation.updateConnection(actorId, row.id, url.href);
      }
    } finally {
      await installation.pool.end();
    }
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-production.ts'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    app = spawn(
      process.execPath,
      ['--dns-result-order=ipv4first', '--import', 'tsx', 'apps/web/src/node.ts'],
      { env, stdio: 'ignore' },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(origin + '/api/ready', { signal: AbortSignal.timeout(2000) }))
              .status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    manifest.restoreMs = Date.now() - restoreStarted;
    writeFileSync(directory + '/manifest.json', JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return { origin, manifest, pending, directory, close };
  } catch (error) {
    await close();
    throw error;
  }
}
