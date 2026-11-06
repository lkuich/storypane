import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function setupEnvironment(directory, local = false) {
  const name = local ? '.env' : '.env.production';
  const target = resolve(directory, name);
  const template = readFileSync(resolve(directory, `${name}.example`), 'utf8');
  const hex = () => randomBytes(32).toString('hex');
  const values = {
    STORYPANE_APP_URL: local ? 'http://127.0.0.1:3130' : 'http://localhost:3130',
    INSTALLATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    WEBHOOK_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PROVISIONING_DB_PASSWORD: hex(),
    INSTALLATION_DB_PASSWORD: hex(),
    S3_ACCESS_KEY_ID: `storypane-${randomBytes(12).toString('hex')}`,
    S3_SECRET_ACCESS_KEY: hex(),
    S3_ENDPOINT: local ? 'http://127.0.0.1:59120' : 'http://media:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'storypane',
    S3_FORCE_PATH_STYLE: 'true',
  };
  if (local) {
    values.INSTALLATION_DATABASE_URL = `postgresql://storypane_installation:${values.INSTALLATION_DB_PASSWORD}@127.0.0.1:55450/storypane_installation`;
    values.PROVISIONING_DATABASE_URL = `postgresql://provisioner:${values.PROVISIONING_DB_PASSWORD}@127.0.0.1:55450/postgres`;
  }
  const content = template.replace(/^([A-Z][A-Z0-9_]*)=.*$/gm, (line, key) =>
    key in values ? `${key}=${values[key]}` : line,
  );
  try {
    writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--local')) {
    console.error('Usage: node scripts/setup-env.mjs [--local]');
    process.exitCode = 1;
  } else {
    const local = args[0] === '--local';
    const created = setupEnvironment(process.cwd(), local);
    const name = local ? '.env' : '.env.production';
    console.log(
      created
        ? `Created ${name} with private permissions and generated secrets. Review the application origin before use. No services were started.`
        : `${name} already exists; nothing changed. Keep existing keys and credentials when upgrading.`,
    );
  }
}
