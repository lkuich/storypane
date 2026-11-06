import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

export async function verifyMigratedExamples(options: {
  connectionString: string;
  encryptionKey: string;
  spaceId: string;
  deliveryToken: string;
}) {
  const children: ChildProcess[] = [];
  const outcomes = new Map<ChildProcess, Promise<void>>();
  const env = {
    ...process.env,
    STORYPANE_URL: 'http://127.0.0.1:3160',
    STORYPANE_SPACE_ID: options.spaceId,
    STORYPANE_DELIVERY_TOKEN: options.deliveryToken,
    INSTALLATION_DATABASE_URL: options.connectionString,
    INSTALLATION_ENCRYPTION_KEY: options.encryptionKey,
    AUTH_PROVIDER: 'clerk',
    CLERK_SECRET_KEY: 'test-unused',
    VITE_CLERK_PUBLISHABLE_KEY: 'test-unused',
    WEBHOOK_ENCRYPTION_KEY: options.encryptionKey,
    STORYPANE_APP_URL: 'http://127.0.0.1:3160',
    PORT: '3160',
    S3_ENDPOINT: 'http://127.0.0.1:1',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'unused',
    S3_ACCESS_KEY_ID: 'unused',
    S3_SECRET_ACCESS_KEY: 'unused',
  };
  function start(command: string, args: string[]) {
    const child = spawn(command, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    child.stdout!.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr!.on('data', (chunk) => {
      output += chunk;
    });
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Verification process failed (${code}): ${output.slice(-3000)}`)),
      );
    });
    outcomes.set(child, done);
    void done.catch(() => {});
    return { child, done };
  }
  async function ready(url: string, child: ChildProcess) {
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) {
        await outcomes.get(child);
        throw new Error('Verification server exited');
      }
      try {
        const response = await fetch(url);
        if (response.ok) return response;
      } catch {
        /* Wait for the owned verification server. */
      }
      await setTimeout(500);
    }
    throw new Error('Verification server did not become ready');
  }
  try {
    const server = start(process.execPath, [
      '--import',
      createRequire(import.meta.url).resolve('tsx'),
      'apps/web/src/node.ts',
    ]);
    await ready(`${env.STORYPANE_URL}/api/ready`, server.child);
    for (const [name, port] of [
      ['astro', 3162],
      ['next', 3163],
    ] as const) {
      await start('pnpm', ['--filter', `@storypane/example-${name}`, 'build']).done;
      const app = start('pnpm', [
        '--filter',
        `@storypane/example-${name}`,
        'exec',
        ...(name === 'astro'
          ? ['astro', 'preview', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)]
          : ['next', 'start', '--port', String(port)]),
      ]);
      const response = await ready(`http://127.0.0.1:${port}/home`, app.child);
      const html = await response.text();
      assert(html.includes('Build something worth sharing.'));
      assert(!html.includes('Unfinished draft'));
    }
  } finally {
    for (const child of children)
      if (child.pid && child.exitCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* Already exited. */
        }
      }
    await Promise.all(
      children
        .filter((child) => child.exitCode === null)
        .map((child) => new Promise<void>((resolve) => child.once('exit', () => resolve()))),
    );
  }
}
