import { expect, test } from '@playwright/test';

test('redirect-provider sign-in preserves invitations and supports responsive keyboard access', async ({
  page,
}) => {
  await page.route('**/api/auth/config', (route) =>
    route.fulfill({
      json: {
        provider: 'redirect',
        name: 'Example provider',
        signInPath: '/api/auth/sign-in/example',
      },
    }),
  );
  await page.route('**/api/session**', (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: { code: 'unauthenticated', message: 'Sign in to continue' },
      },
    }),
  );
  await page.goto('/?space=example&invite=example-invitation');
  const signIn = page.getByRole('button', { name: 'Continue with Example provider' });
  await expect(signIn).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.route('**/api/auth/sign-in/example**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Provider sign-in</p>' }),
  );
  await signIn.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    /\/api\/auth\/sign-in\/example\?space=example&invite=example-invitation$/,
  );
});

test('rejects external provider sign-in paths', async ({ page }) => {
  await page.route('**/api/auth/config', (route) =>
    route.fulfill({
      json: {
        provider: 'redirect',
        name: 'Example provider',
        signInPath: '//external.test/sign-in',
      },
    }),
  );
  await page.goto('/');
  await expect(
    page.getByText('The sign-in path must be a local authentication route.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Example provider' })).toHaveCount(0);
});

test('redirect-provider account control reports sign-out failures and returns to sign-in', async ({
  page,
}) => {
  let signedIn = true,
    failSignOut = true;
  await page.route('**/api/auth/config', (route) =>
    route.fulfill({
      json: {
        provider: 'redirect',
        name: 'Example provider',
        signInPath: '/api/auth/sign-in/example',
      },
    }),
  );
  await page.route('**/api/session**', (route) =>
    route.fulfill(
      signedIn
        ? {
            json: {
              user: { id: 'example', name: 'Example', email: 'example@test.com' },
              sessionId: 'opaque-session',
              installationAdmin: false,
              space: null,
            },
          }
        : { status: 401, json: { error: { code: 'unauthenticated' } } },
    ),
  );
  await page.route('**/api/spaces', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/sign-out', async (route) => {
    expect(route.request().method()).toBe('POST');
    if (failSignOut) {
      failSignOut = false;
      await route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    } else {
      signedIn = false;
      await route.fulfill({ json: { ok: true } });
    }
  });
  await page.goto('/');
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  await expect(signOut).toBeVisible();
  await signOut.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Unable to sign out. Please retry.');
  await signOut.click();
  await expect(page.getByRole('button', { name: 'Continue with Example provider' })).toBeVisible();
});
