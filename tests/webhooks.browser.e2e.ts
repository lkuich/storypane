import { expect, test } from '@playwright/test';
import type { WebhookDelivery, WebhookEndpoint } from '@storypane/core';

// Component browser journey; admin/session/space enforcement has real Postgres coverage.
test('configure a webhook, show its secret once, send a test, inspect failure and retry', async ({
  page,
}) => {
  let endpoint: WebhookEndpoint | undefined;
  let delivery: WebhookDelivery | undefined;
  let retries = 0;
  const secret = 'whsec_browser_fixture_only';
  await page.route('**/api/cms/webhooks**', async (route) => {
    const request = route.request(),
      pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/retry')) {
      retries++;
      delivery = { ...delivery!, status: 'pending', error: null };
      return route.fulfill({ json: { ok: true }, status: 202 });
    }
    if (pathname.endsWith('/deliveries'))
      return route.fulfill({ json: { deliveries: delivery ? [delivery] : [], nextOffset: null } });
    if (pathname.endsWith('/test')) {
      delivery = {
        id: crypto.randomUUID(),
        eventId: crypto.randomUUID(),
        type: 'webhook.test',
        status: 'failed',
        attemptCount: 1,
        nextAttemptAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        httpStatus: 400,
        error: 'Webhook returned HTTP 400',
        endpointRevision: 1,
        attempts: [
          {
            number: 1,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            httpStatus: 400,
            error: 'Webhook returned HTTP 400',
          },
        ],
      };
      return route.fulfill({
        json: { deliveryId: delivery.id, eventId: delivery.eventId },
        status: 202,
      });
    }
    if (request.method() === 'POST') {
      endpoint = {
        ...request.postDataJSON(),
        id: crypto.randomUUID(),
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return route.fulfill({ json: { endpoint, secret }, status: 201 });
    }
    return route.fulfill({ json: { configured: true, endpoints: endpoint ? [endpoint] : [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New webhook' }).click();
  const create = page.getByRole('dialog', { name: 'Create webhook' });
  await expect(page.getByLabel('Navigation guard')).toHaveText('Unsaved');
  await create.getByLabel('Name', { exact: true }).fill('Static site');
  await create.getByLabel('Endpoint URL').fill('https://hooks.example.com/rebuild');
  await expect(create.getByLabel('story.saved', { exact: true })).not.toBeChecked();
  await expect(create.getByLabel('story.published', { exact: true })).toBeChecked();
  await create.getByRole('button', { name: 'Save webhook' }).click();
  const secretDialog = page.getByRole('dialog', { name: 'Save your webhook secret' });
  await expect(secretDialog.getByLabel('Signing secret')).toHaveValue(secret);
  await secretDialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Navigation guard')).toHaveText('Ready');
  await expect(page.getByLabel('Signing secret')).not.toBeVisible();
  await page.reload();
  await expect(page.getByText('Static site', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Signing secret')).not.toBeVisible();
  await page.getByRole('button', { name: 'Send test' }).click();
  const logs = page.getByRole('dialog', { name: 'Deliveries · Static site' });
  await expect(logs.getByText('failed', { exact: true })).toBeVisible();
  await expect(logs.getByText('Webhook returned HTTP 400', { exact: true })).toBeVisible();
  await logs.getByRole('button', { name: 'Retry delivery' }).click();
  await expect(logs.getByText('pending', { exact: true })).toBeVisible();
  expect(retries).toBe(1);
  await expect(logs.getByRole('button', { name: 'Retry delivery' })).not.toBeVisible();
});

test('missing encryption configuration disables creation', async ({ page }) => {
  await page.route('**/api/cms/webhooks', (route) =>
    route.fulfill({ json: { configured: false, endpoints: [] } }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New webhook' })).toBeDisabled();
  await expect(page.getByText('Webhooks need an encryption key', { exact: false })).toBeVisible();
});
