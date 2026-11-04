import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import { deliverySettingsSchema } from '@storypane/core';

const envPath = 'apps/example-next/.env';
const source = existsSync(envPath) ? envPath : 'apps/example-astro/.env';
if (!existsSync(source))
  throw new Error('Run pnpm example:setup to configure the shared Fieldwork space first.');
const env = parseEnv(readFileSync(source, 'utf8'));
const cmsUrl = (env.STORYPANE_URL ?? env.BLOK_URL) || 'http://127.0.0.1:3130';
const spaceId = env.STORYPANE_SPACE_ID ?? env.BLOK_SPACE_ID;
const deliveryToken = env.STORYPANE_DELIVERY_TOKEN ?? env.BLOK_DELIVERY_TOKEN;
const previewToken = env.STORYPANE_PREVIEW_TOKEN ?? env.BLOK_PREVIEW_TOKEN;
const connectionString = process.env.DATABASE_URL ?? 'postgresql://blok:blok@127.0.0.1:55432/blok';
const database = new URL(connectionString);
if (
  !['localhost', '127.0.0.1'].includes(new URL(cmsUrl).hostname) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== '/blok'
)
  throw new Error(
    'This setup only configures the local CMS and local blok database. Configure remote previews in Storypane settings.',
  );
assert(
  spaceId && deliveryToken,
  'Configure a Storypane space and published delivery token in apps/example-next/.env.',
);

const pool = new Pool({ connectionString });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    'SELECT preview_urls AS "previewUrls",default_preview_id AS "defaultPreviewId",preview_parameter AS "previewParameter" FROM spaces WHERE id=$1 FOR UPDATE',
    [spaceId],
  );
  assert(rows[0], 'The configured space does not exist in the local database.');
  const settings = deliverySettingsSchema.parse(rows[0]);
  const url = 'http://127.0.0.1:3133/preview?slug={slug}&locale={locale}';
  const target = settings.previewUrls.find((target) => target.url === url) ?? {
    id: crypto.randomUUID(),
    name: 'Local Next.js',
    url,
  };
  const updated = deliverySettingsSchema.parse({
    ...settings,
    previewUrls: settings.previewUrls.some((item) => item.id === target.id)
      ? settings.previewUrls
      : [...settings.previewUrls, target],
    defaultPreviewId: settings.defaultPreviewId || target.id,
  });
  await client.query('UPDATE spaces SET preview_urls=$2,default_preview_id=$3 WHERE id=$1', [
    spaceId,
    JSON.stringify(updated.previewUrls),
    updated.defaultPreviewId,
  ]);
  const saved = (
    await client.query('SELECT preview_urls,default_preview_id FROM spaces WHERE id=$1', [spaceId])
  ).rows[0];
  assert.equal(
    saved.preview_urls.filter((item: { id: string }) => item.id === target.id).length,
    1,
  );
  assert.equal(saved.default_preview_id, settings.defaultPreviewId || target.id);
  if (!existsSync(envPath)) {
    const config = {
      STORYPANE_URL: cmsUrl,
      STORYPANE_SPACE_ID: spaceId,
      STORYPANE_DELIVERY_TOKEN: deliveryToken,
      ...(previewToken ? { STORYPANE_PREVIEW_TOKEN: previewToken } : {}),
    };
    writeFileSync(
      envPath,
      Object.entries(config)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  }
  await client.query('COMMIT');
  console.log(
    `Configured ${target.name}. Existing preview targets and the default are preserved.\nRun pnpm dev:example:next, then select ${target.name} in Storypane’s preview selector.`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
