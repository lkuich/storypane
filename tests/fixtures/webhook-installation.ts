import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { mkdirSync, mkdtempSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { Installation } from '@storypane/db/installation';
import { prepareRailway } from '../../scripts/prepare-railway';
import { publicWebhookReceiver } from './webhook-receiver';
import { startTestMedia } from './test-media';

export async function webhookInstallation() {
  mkdirSync('artifacts/operational-runs', { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(resolve('artifacts/operational-runs/local-'));
  const webhook = await publicWebhookReceiver();
  let media: Awaited<ReturnType<typeof startTestMedia>> | undefined;
  const container = `storypane-webhook-test-${randomUUID()}`;
  const spaceId = randomUUID();
  const password = randomBytes(24).toString('hex');
  const email = 'admin@webhook.test';
  let app: ChildProcess | undefined;
  let installation: Installation | undefined;
  const docker = (...args: string[]) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      env: { ...process.env, POSTGRES_PASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  async function stop(child: ChildProcess | undefined) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  async function close() {
    await stop(app);
    await webhook.close();
    await media?.close();
    await installation?.pool.end();
    docker('rm', '--force', container);
  }
  try {
    docker(
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'POSTGRES_DB=railway',
      '-p',
      '127.0.0.1::5432',
      'postgres:18-alpine',
    );
    const port = docker('port', container, '5432').trim().split(':').at(-1)!;
    assert.match(port, /^\d+$/);
    const source = `postgresql://postgres:${password}@127.0.0.1:${port}/railway`;
    const operator = new Pool({ connectionString: source, connectionTimeoutMillis: 1000 });
    try {
      await expect
        .poll(
          async () => {
            try {
              await operator.query('SELECT 1');
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 30_000 },
        )
        .toBe(true);
    } finally {
      await operator.end();
    }

    // Bind the CMS port before handing it to the child so we never reuse a running installation.
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const address = probe.address();
    assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    media = await startTestMedia();
    const env = {
      ...process.env,
      AUTH_PROVIDER: 'local',
      STORYPANE_APP_URL: origin,
      HOST: '127.0.0.1',
      PORT: String(address.port),
      INSTALLATION_DATABASE_URL: `postgresql://storypane_installation:${password}@127.0.0.1:${port}/storypane_installation`,
      PROVISIONING_DATABASE_URL: source,
      INSTALLATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      WEBHOOK_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      WEBHOOK_HOSTS: new URL(webhook.destination).hostname,
      STORYPANE_ADMIN_NAME: 'Webhook tester',
      STORYPANE_ADMIN_EMAIL: email,
      STORYPANE_ADMIN_PASSWORD: password,
      SMTP_URL: '',
      MAIL_FROM: '',
      ...media.env,
    };
    await prepareRailway(env);
    installation = new Installation({
      connectionString: env.INSTALLATION_DATABASE_URL,
      provisioningURL: source,
      encryptionKey: env.INSTALLATION_ENCRYPTION_KEY,
      provider: 'local',
    });
    const user = (await installation.pool.query('SELECT id FROM "user" WHERE installation_admin'))
      .rows[0];
    await installation.provision(user.id, {
      id: spaceId,
      name: 'Webhook recovery',
      mode: 'create',
      environment: 'dev',
    });
    const selected = await installation.acquire(spaceId);
    try {
      await selected.store.seed({ userId: user.id, sessionId: 'fixture', spaceId, role: 'admin' });
    } finally {
      await selected.close();
    }
    async function start() {
      const log = openSync(directory + '/app.log', 'a', 0o600);
      app = spawn(
        process.execPath,
        ['--dns-result-order=ipv4first', '--import', 'tsx', 'apps/web/src/node.ts'],
        {
          env,
          stdio: ['ignore', log, log],
        },
      );
      closeSync(log);
      await expect
        .poll(
          async () => {
            assert(
              app?.exitCode === null && app.signalCode === null,
              'Test CMS exited before readiness',
            );
            try {
              return (await fetch(origin + '/api/ready', { signal: AbortSignal.timeout(2000) }))
                .status;
            } catch {
              return 0;
            }
          },
          { timeout: 30_000, message: 'Isolated production CMS must become ready' },
        )
        .toBe(200);
    }
    await start();
    return {
      origin,
      spaceId,
      email,
      password,
      destination: webhook.destination,
      receiver: webhook.receiver,
      environment: env,
      operatorURL: source,
      databaseSSL: false as const,
      installation,
      async crash() {
        await stop(app);
        await start();
      },
      async stop() {
        await stop(app);
      },
      start,
      close,
      async restart() {
        await stop(app);
        await start();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
