import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function installation(
  mode: string,
  overrides: Record<string, string | undefined> = process.env,
) {
  const file = new URL(mode === 'production' ? '../.env.production' : '../.env', import.meta.url);
  return { ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}), ...overrides };
}

export function cloudflareSettings(
  mode: string | undefined,
  values = installation(mode ?? 'development'),
) {
  const production = mode === 'production';
  const web = values.STORYPANE_WEB_WORKER_NAME || 'storypane-web';
  const realtime = values.STORYPANE_REALTIME_WORKER_NAME || 'storypane-realtime';
  const bucket = values.R2_BUCKET || 'storypane-assets';
  const appUrl =
    values.STORYPANE_APP_URL ||
    (production
      ? `https://${web}.${values.CLOUDFLARE_WORKERS_SUBDOMAIN}.workers.dev`
      : 'http://127.0.0.1:3130');
  if (production) {
    if (!/^[a-f0-9]{32}$/.test(values.CLOUDFLARE_ACCOUNT_ID ?? ''))
      throw new Error('Set CLOUDFLARE_ACCOUNT_ID in .env.production');
    if (!/^[a-f0-9]{32}$/.test(values.HYPERDRIVE_ID ?? ''))
      throw new Error('Set HYPERDRIVE_ID or run pnpm deploy:cloudflare first');
    if (
      !values.STORYPANE_APP_URL &&
      !/^[a-z0-9-]+$/.test(values.CLOUDFLARE_WORKERS_SUBDOMAIN ?? '')
    )
      throw new Error('Set CLOUDFLARE_WORKERS_SUBDOMAIN or STORYPANE_APP_URL');
    const url = new URL(appUrl);
    if (url.protocol !== 'https:' || url.origin !== appUrl)
      throw new Error('STORYPANE_APP_URL must be an HTTPS origin without a trailing slash');
    if (values.STORYPANE_DOMAIN && values.STORYPANE_DOMAIN !== url.hostname)
      throw new Error('STORYPANE_DOMAIN must match STORYPANE_APP_URL');
  }
  if (
    ![web, realtime, bucket].every((name) => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) ||
    web === realtime
  )
    throw new Error(
      'Use distinct Worker names and valid resource names (3–63 lowercase characters)',
    );
  return {
    web,
    realtime,
    bucket,
    appUrl,
    accountId: values.CLOUDFLARE_ACCOUNT_ID,
    hyperdriveId: values.HYPERDRIVE_ID || '00000000000000000000000000000000',
    domains: production && values.STORYPANE_DOMAIN ? [values.STORYPANE_DOMAIN] : [],
    databaseUrl:
      values.DATABASE_URL || 'postgresql://storypane:storypane@127.0.0.1:55432/storypane',
    optionHosts: values.EXTERNAL_OPTION_HOSTS || '',
    webhookHosts: values.WEBHOOK_HOSTS || '',
  };
}
