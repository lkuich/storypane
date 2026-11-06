import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = JSON.parse(readFileSync(resolve(root, 'packages/sdk/package.json')));
const app = JSON.parse(readFileSync(resolve(root, 'package.json')));
assert.equal(sdk.version, app.version, 'App and SDK release versions must match');
assert.equal(sdk.name, '@storypane/sdk');
assert.equal(sdk.private, undefined);
assert.equal(sdk.publishConfig.access, 'public');
assert.ok(Object.values(sdk.dependencies).every((value) => !value.startsWith('workspace:')));
const artifacts = resolve(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const [pack] = JSON.parse(
  execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', artifacts], {
    cwd: resolve(root, 'packages/sdk'),
    encoding: 'utf8',
  }),
);
const files = new Set(pack.files.map(({ path }) => path));
for (const file of [
  'package.json',
  'LICENSE',
  'README.md',
  'bin/storypane.mjs',
  'bin/mcp.mjs',
  ...Object.values(sdk.exports).flatMap((entry) => [entry.import.slice(2), entry.types.slice(2)]),
]) {
  assert.ok(files.has(file), `Missing packed file: ${file}`);
}
for (const file of files) {
  assert.ok(
    /^(dist\/|bin\/|package\.json$|LICENSE$|README\.md$)/.test(file),
    `Unexpected packed file: ${file}`,
  );
  assert.ok(
    !/\.test\.|(?:^|\/)\.env|node_modules/.test(file),
    `Private/test file in package: ${file}`,
  );
}
const consumer = mkdtempSync(resolve(tmpdir(), 'storypane-sdk-consumer-'));
try {
  writeFileSync(
    resolve(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      resolve(artifacts, pack.filename),
      'react@19.3.1',
    ],
    { cwd: consumer, stdio: 'pipe' },
  );
  const imports = Object.keys(sdk.exports)
    .map((key) => `await import(${JSON.stringify(sdk.name + (key === '.' ? '' : key.slice(1)))});`)
    .join('\n');
  execFileSync(process.execPath, ['--input-type=module', '-e', imports], {
    cwd: consumer,
    stdio: 'pipe',
  });
  const help = execFileSync(
    process.execPath,
    ['node_modules/@storypane/sdk/bin/storypane.mjs', '--help'],
    {
      cwd: consumer,
      encoding: 'utf8',
    },
  );
  assert.match(help, /storypane mcp/);
  assert.match(help, /migrations/);
  console.log(
    `Verified ${pack.filename}: clean install, all exports, CLI, types, and license present.`,
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
