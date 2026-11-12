import { dismissRecommendedSetup } from './fixtures/recommended-setup';
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const url = process.env.STORYPANE_LOCAL_AUTH_TEST_URL;
test.skip(!url, 'Use a disposable Node/Docker installation with the CLI-bootstrapped test account');
test('local auth, installation privileges, invitation, logout and responsive keyboard controls', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Use a disposable local installation');
  const requests: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByLabel('Email', { exact: true }).fill('admin@docker.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill(process.env.STORYPANE_LOCAL_AUTH_TEST_PASSWORD || 'docker-acceptance-password');
  await page.getByLabel('Password', { exact: true }).press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/session')).json();
  expect(session.installationAdmin).toBe(true);
  const unique = Date.now();
  for (const label of ['Alpha', 'Beta']) {
    await page.getByRole('button', { name: 'Create space', exact: true }).click();
    await page.getByLabel('Space name', { exact: true }).fill(`${label} ${unique}`);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create space', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: `${label} ${unique}`, exact: true }),
    ).toBeVisible();
  }
  const spaces = await (await page.request.get('/api/spaces')).json();
  const alpha = spaces.find((space: { name: string }) => space.name === `Alpha ${unique}`);
  expect(alpha.provisioningStatus).toBe('ready');
  expect(JSON.stringify(spaces)).not.toMatch(/connection_secret|postgresql:|password/);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/local-auth-spaces-mobile.png', fullPage: true });
  const email = `invite-${unique}@docker.test`;
  const response = await page.request.post('/api/cms/invitations', {
    headers: { Origin: url, 'x-storypane-space-id': alpha.id },
    data: { email, role: 'editor' },
  });
  expect(response.status()).toBe(201);
  const invitation = await response.json();
  expect(invitation.emailSent).toBe(false);
  const invited = await browser.newContext({ baseURL: url, viewport: { width: 390, height: 844 } });
  try {
    const person = await invited.newPage();
    await dismissRecommendedSetup(person);
    await person.goto(invitation.link);
    await expect(person.getByRole('heading', { name: 'Accept invitation' })).toBeVisible();
    await person.getByLabel('Name', { exact: true }).fill('Invited Editor');
    await person.getByLabel('Password', { exact: true }).fill('invited-docker-password');
    await person.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(person.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await person.getByLabel('Email', { exact: true }).fill(email);
    await person.getByLabel('Password', { exact: true }).fill('invited-docker-password');
    await person.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(person.getByRole('heading', { name: `Alpha ${unique}` })).toBeVisible();
    await expect(person.getByRole('button', { name: 'Create space', exact: true })).toHaveCount(0);
    expect(
      (
        await invited.request.post('/api/spaces', {
          headers: { Origin: url },
          data: { name: 'Forbidden', mode: 'create' },
        })
      ).status(),
    ).toBe(403);
    await person.getByRole('button', { name: 'Account', exact: true }).click();
    await person.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(person.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    expect((await invited.request.get('/api/session')).status()).toBe(401);
    expect(
      (
        await invited.request.post('/api/auth/accept-invitation', {
          headers: { Origin: url },
          data: {
            spaceId: alpha.id,
            token: new URL(invitation.link).searchParams.get('invite'),
            name: 'Replay',
            password: 'replay-docker-password',
          },
        })
      ).status(),
    ).toBe(400);
  } finally {
    await invited.close();
  }
  expect(requests.some((request) => new URL(request).hostname.includes('clerk'))).toBe(false);
  expect(errors).toEqual([]);
  // A later operator recovery check uses this private state to prove revocation.
  await writeFile(
    '/tmp/storypane-local-auth-storage.json',
    JSON.stringify(await page.context().storageState()),
    { mode: 0o600 },
  );
});

test.beforeEach(async ({ page }) => {
  await dismissRecommendedSetup(page);
});
