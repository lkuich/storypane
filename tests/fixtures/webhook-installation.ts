import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { devNull } from 'node:os';
import { getDefaultResultOrder, setDefaultResultOrder } from 'node:dns';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { expect } from '@playwright/test';
import { Installation } from '@storypane/db/installation';
import { prepareRailway } from '../../scripts/prepare-railway';

export async function webhookInstallation() {
  const dnsOrder = getDefaultResultOrder();
  // Prefer IPv4 for the public tunnel on hosts without reliable IPv6 routing.
  setDefaultResultOrder('ipv4first');
  const container = `storypane-webhook-test-${randomUUID()}`;
  const spaceId = randomUUID();
  const password = randomBytes(24).toString('hex');
  const email = 'admin@webhook.test';
  let app: ChildProcess | undefined, tunnel: ChildProcess | undefined;
  let installation: Installation | undefined;
  const receiver = createServer();
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
    await stop(tunnel);
    receiver.closeAllConnections();
    if (receiver.listening) await new Promise<void>((resolve) => receiver.close(() => resolve()));
    await installation?.pool.end();
    docker('rm', '--force', container);
    setDefaultResultOrder(dnsOrder);
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

    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    const receiverAddress = receiver.address();
    assert(receiverAddress && typeof receiverAddress !== 'string');
    tunnel = spawn(
      'cloudflared',
      [
        'tunnel',
        '--config',
        devNull,
        '--no-autoupdate',
        '--protocol',
        'http2',
        '--url',
        `http://127.0.0.1:${receiverAddress.port}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const destination = await new Promise<string>((resolve, reject) => {
      let log = '',
        url = '';
      const timer = setTimeout(
        () => reject(new Error('Public HTTPS test tunnel did not start')),
        60_000,
      );
      tunnel!.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      tunnel!.stderr!.on('data', (chunk) => {
        log = (log + String(chunk)).slice(-8192);
        const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) url = match[0];
        if (url && log.includes('Registered tunnel connection')) {
          clearTimeout(timer);
          resolve(url);
        }
      });
    });
    // Bind the CMS port before handing it to the child so we never reuse a running installation.
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const address = probe.address();
    assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
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
      WEBHOOK_HOSTS: new URL(destination).hostname,
      STORYPANE_ADMIN_NAME: 'Webhook tester',
      STORYPANE_ADMIN_EMAIL: email,
      STORYPANE_ADMIN_PASSWORD: password,
      SMTP_URL: '',
      MAIL_FROM: '',
      S3_ENDPOINT: 'http://127.0.0.1:1',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'unused',
      S3_ACCESS_KEY_ID: 'unused',
      S3_SECRET_ACCESS_KEY: 'unused',
      S3_FORCE_PATH_STYLE: 'true',
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
      app = spawn(
        process.execPath,
        ['--dns-result-order=ipv4first', '--import', 'tsx', 'apps/web/src/node.ts'],
        {
          env,
          stdio: 'ignore',
        },
      );
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
      destination,
      receiver,
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
