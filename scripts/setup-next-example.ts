import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { deliverySettingsSchema } from '@storypane/core';

const envPath = 'apps/example-next/.env';
const source = existsSync(envPath) ? envPath : 'apps/example-astro/.env';
if (!existsSync(source)) {
  throw new Error(
    'Run pnpm --filter @storypane/example-astro setup to configure the shared Fieldwork space first.',
  );
}
const env = parseEnv(readFileSync(source, 'utf8'));
const cmsUrl = env.STORYPANE_URL || 'http://127.0.0.1:3130';
const spaceId = env.STORYPANE_SPACE_ID;
const deliveryToken = env.STORYPANE_DELIVERY_TOKEN;
const previewToken = env.STORYPANE_PREVIEW_TOKEN;
if (!['localhost', '127.0.0.1'].includes(new URL(cmsUrl).hostname))
  throw new Error(
    'This setup only configures the local CMS. Configure remote previews in Storypane settings.',
  );
const cookie = process.env.STORYPANE_SESSION_COOKIE,
  token = process.env.STORYPANE_SESSION_TOKEN;
if (!cookie && !token)
  throw new Error('Set STORYPANE_SESSION_COOKIE, or STORYPANE_SESSION_TOKEN for Clerk');
async function request(method = 'GET', body?: unknown) {
  const response = await fetch(new URL('/api/cms/delivery-settings', cmsUrl), {
    method,
    headers: {
      Origin: new URL(cmsUrl).origin,
      'Content-Type': 'application/json',
      'x-storypane-space-id': spaceId!,
      ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Preview settings request failed (${response.status})`);
  return response.json();
}
assert(
  spaceId && deliveryToken,
  'Configure a Storypane space and published delivery token in apps/example-next/.env.',
);

{
  const { personalDefaultPreviewId: _personal, ...shared } = await request();
  const settings = deliverySettingsSchema.parse(shared);
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
  const saved = deliverySettingsSchema.parse(await request('PUT', updated));
  assert.equal(saved.previewUrls.filter((item) => item.id === target.id).length, 1);
  assert.equal(saved.defaultPreviewId, settings.defaultPreviewId || target.id);
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
  console.log(
    `Configured ${target.name}. Existing preview targets and the default are preserved.\nRun pnpm --filter @storypane/example-next dev, then select ${target.name} in Storypane’s preview selector.`,
  );
}
