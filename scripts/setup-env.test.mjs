import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { setupEnvironment } from './setup-env.mjs';

test('fresh Compose configuration generates private independent secrets and matching local URLs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'storypane-env-'));
  try {
    for (const name of ['.env.example', '.env.production.example'])
      copyFileSync(new URL(`../${name}`, import.meta.url), join(directory, name));
    assert.equal(setupEnvironment(directory), true);
    const freshOutput = execFileSync(
      process.execPath,
      [new URL('./setup-env.mjs', import.meta.url).pathname, '--local'],
      { cwd: directory, encoding: 'utf8' },
    );
    const production = parseEnv(readFileSync(join(directory, '.env.production'), 'utf8'));
    const local = parseEnv(readFileSync(join(directory, '.env'), 'utf8'));
    const secrets = ['INSTALLATION_ENCRYPTION_KEY', 'BETTER_AUTH_SECRET', 'WEBHOOK_ENCRYPTION_KEY'];
    for (const env of [production, local]) {
      for (const key of secrets) assert.equal(Buffer.from(env[key], 'base64').length, 32);
      assert.equal(new Set(secrets.map((key) => env[key])).size, 3);
      for (const key of [
        'PROVISIONING_DB_PASSWORD',
        'INSTALLATION_DB_PASSWORD',
        'S3_SECRET_ACCESS_KEY',
      ])
        assert.match(env[key], /^[a-f0-9]{64}$/);
    }
    assert.notEqual(production.WEBHOOK_ENCRYPTION_KEY, local.WEBHOOK_ENCRYPTION_KEY);
    for (const key of [...secrets, 'S3_SECRET_ACCESS_KEY', 'INSTALLATION_DB_PASSWORD'])
      assert.ok(!freshOutput.includes(local[key]));
    assert.match(freshOutput, /Created .env/);
    const installation = new URL(local.INSTALLATION_DATABASE_URL);
    assert.equal(installation.password, local.INSTALLATION_DB_PASSWORD);
    assert.equal(installation.port, '55450');
    assert.equal(new URL(local.PROVISIONING_DATABASE_URL).password, local.PROVISIONING_DB_PASSWORD);
    assert.equal(local.S3_ENDPOINT, 'http://127.0.0.1:59120');
    assert.equal(statSync(join(directory, '.env.production')).mode & 0o777, 0o600);
    const before = readFileSync(join(directory, '.env.production'), 'utf8');
    assert.equal(setupEnvironment(directory), false);
    assert.equal(readFileSync(join(directory, '.env.production'), 'utf8'), before);
    const output = execFileSync(
      process.execPath,
      [new URL('./setup-env.mjs', import.meta.url).pathname],
      { cwd: directory, encoding: 'utf8' },
    );
    for (const key of secrets) assert.ok(!output.includes(production[key]));
    assert.match(output, /already exists/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an existing symlink is never followed or replaced', () => {
  const directory = mkdtempSync(join(tmpdir(), 'storypane-env-'));
  try {
    copyFileSync(
      new URL('../.env.production.example', import.meta.url),
      join(directory, '.env.production.example'),
    );
    writeFileSync(join(directory, 'retained'), 'existing-key');
    symlinkSync('retained', join(directory, '.env.production'));
    assert.equal(setupEnvironment(directory), false);
    assert.equal(readFileSync(join(directory, 'retained'), 'utf8'), 'existing-key');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
