import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { installation, cloudflareSettings } from './installation';

const values = installation('production');
const checkOnly = process.argv.includes('--check');
for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'DATABASE_URL']) {
  if (!values[key]) throw new Error(`Set ${key} in .env.production or the process environment`);
}
const database = new URL(values.DATABASE_URL!);
if (
  !['postgres:', 'postgresql:'].includes(database.protocol) ||
  !database.password ||
  !database.username
)
  throw new Error('DATABASE_URL must be a Postgres URL with credentials');
const config = cloudflareSettings('production', {
  ...values,
  HYPERDRIVE_ID: values.HYPERDRIVE_ID || '0'.repeat(32),
});
const secretPath = resolve(values.STORYPANE_SECRETS_FILE || '.env.production.secrets.json');
const secrets: Record<string, string> = existsSync(secretPath)
  ? JSON.parse(readFileSync(secretPath, 'utf8'))
  : {};
for (const key of ['CLERK_SECRET_KEY', 'VITE_CLERK_PUBLISHABLE_KEY']) {
  if (values[key]) secrets[key] = values[key]!;
  if (!secrets[key]) throw new Error(`Provide ${key} in the secrets file or environment`);
}
if (values.WEBHOOK_ENCRYPTION_KEY) secrets.WEBHOOK_ENCRYPTION_KEY = values.WEBHOOK_ENCRYPTION_KEY;
if (
  secrets.WEBHOOK_ENCRYPTION_KEY &&
  Buffer.from(secrets.WEBHOOK_ENCRYPTION_KEY, 'base64').length !== 32
)
  throw new Error('WEBHOOK_ENCRYPTION_KEY must encode 32 bytes');
if (values.HYPERDRIVE_ID && !secrets.WEBHOOK_ENCRYPTION_KEY)
  throw new Error(
    'Reconnect requires the existing WEBHOOK_ENCRYPTION_KEY; restore it instead of rotating it',
  );
if (checkOnly) {
  console.log(
    `Configuration valid for ${config.web}. No resources changed. Fresh-install verification remains required.`,
  );
  process.exit(0);
}
Object.assign(process.env, values);
function run(args: string[], capture = false): string {
  const result = spawnSync('pnpm', args, {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    env: process.env,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Deployment step failed: ${args.slice(0, 4).join(' ')}. No resources were deleted; fix configuration and retry.`,
    );
  return result.stdout ?? '';
}
const cf = (args: string[], capture = false) =>
  run(['--filter', '@storypane/web', 'exec', 'cf', ...args], capture);
const temp = mkdtempSync(join(tmpdir(), 'storypane-deploy-'));
try {
  const hadEncryptionKey = Boolean(secrets.WEBHOOK_ENCRYPTION_KEY);
  type Hyperdrive = {
    id: string;
    name: string;
    caching?: { disabled?: boolean };
    origin?: { host?: string; database?: string; user?: string; port?: number };
  };
  let hyperdrive: Hyperdrive | undefined;
  if (values.HYPERDRIVE_ID) {
    hyperdrive = JSON.parse(cf(['hyperdrive', 'get', values.HYPERDRIVE_ID], true));
  } else {
    // Reconnect after a partial setup without duplicating a named Hyperdrive.
    for (let page = 1; ; page++) {
      const items: Hyperdrive[] = JSON.parse(
        cf(['hyperdrive', 'list', '--page', String(page), '--per-page', '100'], true),
      );
      const matches = items.filter((item) => item.name === config.web);
      if (matches.length > 1 || (hyperdrive && matches.length))
        throw new Error('Multiple matching Hyperdrives; set HYPERDRIVE_ID explicitly');
      hyperdrive ||= matches[0];
      if (items.length < 100) break;
    }
    if (hyperdrive && !hadEncryptionKey)
      throw new Error(
        'Named installation already exists; restore its original WEBHOOK_ENCRYPTION_KEY',
      );
    if (!hyperdrive) {
      // Save before provisioning so a partial setup can safely resume.
      secrets.WEBHOOK_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
      writeFileSync(secretPath, JSON.stringify(secrets), { mode: 0o600 });
      chmodSync(secretPath, 0o600);
      const bodyPath = join(temp, 'hyperdrive.json');
      writeFileSync(
        bodyPath,
        JSON.stringify({
          name: config.web,
          caching: { disabled: true },
          origin: {
            scheme: 'postgres',
            host: database.hostname,
            port: Number(database.port || 5432),
            database: decodeURIComponent(database.pathname.slice(1)),
            user: decodeURIComponent(database.username),
            password: decodeURIComponent(database.password),
          },
        }),
        { mode: 0o600 },
      );
      hyperdrive = JSON.parse(cf(['hyperdrive', 'create', '--body', `@${bodyPath}`], true));
    }
  }
  if (!hyperdrive?.id || hyperdrive.caching?.disabled !== true)
    throw new Error('Hyperdrive query caching must be disabled before deployment');
  if (
    hyperdrive.origin?.host !== database.hostname ||
    hyperdrive.origin?.database !== decodeURIComponent(database.pathname.slice(1)) ||
    hyperdrive.origin?.user !== decodeURIComponent(database.username) ||
    Number(hyperdrive.origin?.port) !== Number(database.port || 5432)
  )
    throw new Error(
      'Hyperdrive origin must match DATABASE_URL; refusing to migrate a different database',
    );
  writeFileSync(secretPath, JSON.stringify(secrets), { mode: 0o600 });
  chmodSync(secretPath, 0o600);
  process.env.HYPERDRIVE_ID = hyperdrive.id;
  if (!values.HYPERDRIVE_ID) {
    const file = resolve('.env.production');
    const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
    writeFileSync(
      file,
      `${content.replace(/^HYPERDRIVE_ID=.*$/gm, '')}\nHYPERDRIVE_ID=${hyperdrive.id}\n`,
      { mode: 0o600 },
    );
    chmodSync(file, 0o600);
  }
  run(['db:migrate:production']);
  run(['build']);
  cf(['deploy', '--prebuilt', '--mode', 'production', '--worker', config.realtime]);
  cf([
    'deploy',
    '--prebuilt',
    '--mode',
    'production',
    '--worker',
    config.web,
    '--secrets-file',
    secretPath,
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      ready = (await fetch(`${config.appUrl}/api/ready`, { signal: AbortSignal.timeout(5000) })).ok;
    } catch {
      /* Deployment propagation can briefly fail. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!ready)
    throw new Error(
      'Workers deployed but readiness failed. Inspect logs; do not recreate resources.',
    );
  console.log(
    `Ready: ${config.appUrl}. Complete the fresh-install acceptance checklist before enabling the public deployment CTA.`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
