import { test, expect } from '@playwright/test';
import { reviewInstallation } from './fixtures/review-installation';

test('recommends setup after sign-in, supports keyboard and mobile, and remembers each user', async ({
  browser,
}, info) => {
  test.setTimeout(90000);
  const installation = await reviewInstallation();
  const context = await browser.newContext({ baseURL: installation.origin });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const welcome = page.getByRole('dialog', { name: 'Welcome to Storypane' });
  async function signIn(person: string) {
    const response = await context.request.post('/api/auth/sign-in/email', {
      headers: { origin: installation.origin },
      data: { email: installation.people[person].email, password: installation.password },
    });
    expect(response.ok()).toBe(true);
  }
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(welcome).not.toBeVisible();
    await signIn('admin');
    await page.reload();
    await expect(welcome).toBeVisible();
    const guide = welcome.getByRole('link', { name: 'Recommended setup' });
    await expect(guide).toHaveAttribute('href', 'https://storypane.dev/docs/recommended-setup/');
    await expect(guide).toHaveAttribute('target', '_blank');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = (await welcome.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await welcome.getByRole('button', { name: 'Close dialog' }).focus();
      await page.keyboard.press('Tab');
      await expect(welcome.getByRole('button', { name: 'Maybe later' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(guide).toBeFocused();
      await page.screenshot({ path: info.outputPath(`welcome-${width}.png`) });
    }
    await page.keyboard.press('Escape');
    await expect(welcome).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
    await expect(welcome).not.toBeVisible();
    await page.goto(`/?space=${installation.spaceId}`);
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
    await expect(welcome).not.toBeVisible();

    await signIn('writer');
    await page.reload();
    await expect(welcome).toBeVisible();
    await context.route('https://storypane.dev/docs/recommended-setup/', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Recommended setup</h1>' }),
    );
    const opened = context.waitForEvent('page');
    await guide.click();
    const docs = await opened;
    await expect(docs).toHaveURL('https://storypane.dev/docs/recommended-setup/');
    await docs.close();
    await expect(welcome).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
    await expect(welcome).not.toBeVisible();

    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('Storage blocked');
        },
      });
    });
    await page.reload();
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: 'Maybe later' }).click();
    await expect(welcome).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await installation.close();
  }
});
