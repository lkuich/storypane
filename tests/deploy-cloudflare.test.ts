import { it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

it('checks without mutation, preserves reconnect keys, and orders deployment in an isolated checkout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'storypane-deploy-test-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    for (const name of ['installation.ts', 'deploy-cloudflare.ts'])
      copyFileSync(resolve('scripts', name), join(directory, 'scripts', name));
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, '.env.production'), '');
    const log = join(directory, 'commands.jsonl');
    writeFileSync(
      join(directory, 'pnpm'),
      `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const config = { id: 'b'.repeat(32), name: 'test-web', caching: { disabled: true }, origin: { host: 'db.example.com', port: 5432, database: 'test', user: 'test' } };
if (args.includes('list')) console.log(JSON.stringify(process.env.TEST_EXISTING ? [config] : []));
if (args.includes('create') || args.includes('get')) console.log(JSON.stringify(config));
if (args.includes('deploy') && args.includes('test-web')) process.exit(42);
`,
      { mode: 0o700 },
    );
    const secretsFile = join(directory, 'secrets.json');
    writeFileSync(
      secretsFile,
      JSON.stringify({ CLERK_SECRET_KEY: 'test', VITE_CLERK_PUBLISHABLE_KEY: 'test' }),
    );
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
      CLOUDFLARE_WORKERS_SUBDOMAIN: 'test-team',
      HYPERDRIVE_ID: '',
      DATABASE_URL: 'postgres://test:test@db.example.com/test',
      STORYPANE_WEB_WORKER_NAME: 'test-web',
      STORYPANE_REALTIME_WORKER_NAME: 'test-realtime',
      R2_BUCKET: 'test-assets',
      STORYPANE_APP_URL: '',
      STORYPANE_DOMAIN: '',
      STORYPANE_SECRETS_FILE: secretsFile,
      WEBHOOK_ENCRYPTION_KEY: '',
    };
    const run = (args: string[] = [], extra = {}) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          createRequire(import.meta.url).resolve('tsx'),
          join(directory, 'scripts/deploy-cloudflare.ts'),
          ...args,
        ],
        { cwd: directory, env: { ...env, ...extra }, encoding: 'utf8' },
      );
    expect(run(['--check']).status).toBe(0);
    expect(existsSync(log)).toBe(false);
    expect(JSON.parse(readFileSync(secretsFile, 'utf8')).WEBHOOK_ENCRYPTION_KEY).toBeUndefined();
    const reconnect = run([], { TEST_EXISTING: 'true' });
    expect(reconnect.status).not.toBe(0);
    expect(reconnect.stderr).toContain('restore its original');
    expect(JSON.parse(readFileSync(secretsFile, 'utf8')).WEBHOOK_ENCRYPTION_KEY).toBeUndefined();
    writeFileSync(log, '');
    expect(run().status).not.toBe(0); // The fake web deployment fails before any readiness HTTP request.
    const saved = JSON.parse(readFileSync(secretsFile, 'utf8'));
    expect(Buffer.from(saved.WEBHOOK_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
    expect(statSync(secretsFile).mode & 0o777).toBe(0o600);
    const commands: string[][] = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(
      commands
        .slice(-4)
        .map((args) =>
          args.includes('test-realtime') ? 'realtime' : args.includes('test-web') ? 'web' : args[0],
        ),
    ).toEqual(['db:migrate:production', 'build', 'realtime', 'web']);
    expect(readFileSync(join(directory, '.env.production'), 'utf8')).toContain(
      'HYPERDRIVE_ID=' + 'b'.repeat(32),
    );
    run([], { HYPERDRIVE_ID: 'b'.repeat(32) });
    expect(JSON.parse(readFileSync(secretsFile, 'utf8')).WEBHOOK_ENCRYPTION_KEY).toBe(
      saved.WEBHOOK_ENCRYPTION_KEY,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
