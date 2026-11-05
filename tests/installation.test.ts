import { describe, expect, it } from 'vitest';
import { cloudflareSettings } from '../scripts/installation';
const values = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  HYPERDRIVE_ID: 'b'.repeat(32),
  CLOUDFLARE_WORKERS_SUBDOMAIN: 'my-team',
};
describe('portable Cloudflare installation', () => {
  it('defaults only to the selected account Workers URL and honors explicit owner resources', () => {
    expect(cloudflareSettings('production', values)).toMatchObject({
      appUrl: 'https://storypane-web.my-team.workers.dev',
      domains: [],
      accountId: values.CLOUDFLARE_ACCOUNT_ID,
    });
    expect(
      cloudflareSettings('production', {
        ...values,
        STORYPANE_APP_URL: 'https://cms.example.com',
        STORYPANE_DOMAIN: 'cms.example.com',
        R2_BUCKET: 'existing-assets',
      }),
    ).toMatchObject({ domains: ['cms.example.com'], bucket: 'existing-assets' });
  });
  it('rejects missing targets, malformed origins and colliding Worker names', () => {
    expect(() => cloudflareSettings('production', {})).toThrow('CLOUDFLARE_ACCOUNT_ID');
    expect(() =>
      cloudflareSettings('production', {
        ...values,
        STORYPANE_APP_URL: 'https://example.com/path',
      }),
    ).toThrow('HTTPS origin');
    expect(() =>
      cloudflareSettings('production', { ...values, STORYPANE_DOMAIN: 'other.example.com' }),
    ).toThrow('must match');
    expect(() =>
      cloudflareSettings('production', {
        ...values,
        STORYPANE_REALTIME_WORKER_NAME: 'storypane-web',
      }),
    ).toThrow('distinct');
    expect(cloudflareSettings('development', {}).appUrl).toBe('http://127.0.0.1:3130');
  });
});
