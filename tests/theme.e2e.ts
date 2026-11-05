import { expect, test } from '@playwright/test';
import { signInPage } from './auth';

const darkCanvas = 'rgb(17, 21, 28)',
  lightCanvas = 'rgb(246, 248, 250)',
  darkSurface = 'rgb(25, 31, 41)';

test('appearance follows the system, persists overrides, and synchronizes across tabs', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page).toHaveTitle('Storypane');
  await expect(page.locator('.brand-name')).toHaveText('storypane.');
  const picker = page.getByRole('combobox', { name: 'Appearance', exact: true });
  await expect(picker).toHaveValue('system');
  await expect(page.locator('body')).toHaveCSS('background-color', darkCanvas);
  await expect(page.getByLabel('Email', { exact: true })).toHaveCSS(
    'background-color',
    darkSurface,
  );
  await page.screenshot({ path: '/tmp/storypane-theme-login-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('body')).toHaveCSS('background-color', lightCanvas);
  await picker.selectOption('dark');
  await expect(page.locator('body')).toHaveCSS('background-color', darkCanvas);
  await page.reload();
  await expect(picker).toHaveValue('dark');
  await expect(page.locator('body')).toHaveCSS('background-color', darkCanvas);
  const peer = await context.newPage();
  await peer.emulateMedia({ colorScheme: 'dark' });
  await peer.goto('/');
  await picker.selectOption('light');
  await expect(peer.getByRole('combobox', { name: 'Appearance', exact: true })).toHaveValue(
    'light',
  );
  await expect(peer.locator('body')).toHaveCSS('background-color', lightCanvas);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).toHaveCSS('background-color', lightCanvas);
  await picker.selectOption('system');
  await expect(picker).toHaveValue('system');
  await expect(page.locator('body')).toHaveCSS('background-color', darkCanvas);
  await expect(peer.getByRole('combobox', { name: 'Appearance', exact: true })).toHaveValue(
    'system',
  );
  await peer.evaluate(() => localStorage.clear());
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await peer.close();
});

test('system and saved appearance apply before the app hydrates, even when storage is unavailable', async ({
  browser,
}) => {
  const noJs = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  try {
    const page = await noJs.newPage();
    await page.goto('http://127.0.0.1:3130');
    await expect(page.locator('body')).toHaveCSS('background-color', darkCanvas);
  } finally {
    await noJs.close();
  }
  const slow = await browser.newContext({ colorScheme: 'light' });
  try {
    await slow.addInitScript(() => localStorage.setItem('storypane:theme', 'dark'));
    await slow.route('**/*', (route) =>
      route.request().resourceType() === 'script' ? route.abort() : route.continue(),
    );
    const page = await slow.newPage();
    await page.goto('http://127.0.0.1:3130');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', darkCanvas);
  } finally {
    await slow.close();
  }
  const blocked = await browser.newContext({ colorScheme: 'dark' });
  try {
    await blocked.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('Storage blocked');
        },
      }),
    );
    const page = await blocked.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:3130');
    await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
    await expect(page.locator('body')).toHaveCSS('background-color', lightCanvas);
    expect(errors).toEqual([]);
  } finally {
    await blocked.close();
  }
});

test('dark surfaces cover spaces, schema drawers, settings, assets, and the editor on desktop and mobile', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signInPage(page);
  await expect(page.getByRole('button', { name: 'Storypane home', exact: true })).toBeVisible();
  await expect(page.locator('.app-sidebar')).toHaveCSS('background-color', darkSurface);
  await page.getByRole('button', { name: 'All spaces', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Storypane home', exact: true })).toBeVisible();
  await expect(page.locator('.space-card').first()).toHaveCSS('background-color', darkSurface);
  await page.screenshot({ path: '/tmp/storypane-theme-spaces-dark.png' });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await expect(page.getByRole('combobox', { name: 'Appearance', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?space=11111111-1111-4111-8111-111111111111');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('button', { name: 'Blocks', exact: true }).click();
  await page.getByRole('button', { name: 'Hero', exact: true }).click();
  const drawer = page.locator('dialog.schema-drawer');
  await expect(drawer).toHaveCSS('background-color', darkSurface);
  await drawer.getByRole('button', { name: 'Edit title', exact: true }).click();
  await drawer.getByRole('button', { name: 'Field type', exact: true }).click();
  await expect(drawer.locator('.field-type-menu')).toHaveCSS('background-color', darkSurface);
  await drawer.locator('.field-type-picker--full').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/storypane-theme-schema-dark.png' });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'API & preview' })
    .click();
  await expect(page.locator('.delivery-settings')).toBeVisible();
  await page
    .locator('.delivery-settings')
    .screenshot({ path: '/tmp/storypane-theme-settings-dark.png' });
  await nav.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
  await expect(page.locator('.asset-toolbar')).toHaveCSS('background-color', darkSurface);
  await page.screenshot({ path: '/tmp/storypane-theme-assets-dark.png' });
  await nav.getByRole('button', { name: 'Content', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Block editor' })).toHaveCSS(
    'background-color',
    darkSurface,
  );
  await page.screenshot({ path: '/tmp/storypane-theme-editor-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
  await expect(page.getByRole('region', { name: 'Block editor' })).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
  await page.screenshot({ path: '/tmp/storypane-theme-editor-mobile-dark.png' });
  expect(errors).toEqual([]);
});
