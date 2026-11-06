import { test, expect } from '@playwright/test';
import type { Space } from '@storypane/core';

const baseURL = process.env.STORYPANE_ENVIRONMENTS_TEST_URL;
test.skip(!baseURL, 'Use the disposable environment fixture');

test('keeps environment identity visible, switches linked spaces in both directions, and guards unsaved changes', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  if (!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
    throw new Error('Use a disposable local installation');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await page.getByLabel('Email', { exact: true }).fill('admin@environments.test');
  await page.getByLabel('Password', { exact: true }).fill('environments-browser-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
  const spaces: Space[] = await (await page.request.get(`${baseURL}/api/spaces`)).json();
  const prod = spaces.find((s) => s.name === 'Production fixture')!;
  const dev = spaces.find((s) => s.productionSpaceId === prod.id)!;
  await page.screenshot({ path: info.outputPath('spaces.png'), fullPage: true });
  for (const view of ['content', 'blocks', 'datasources', 'assets', 'settings']) {
    await page.goto(`${baseURL}/?space=${dev.id}&view=${view}`);
    await expect(
      page.getByRole('button', { name: `Switch space: ${dev.name} (Development)`, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole('textbox', { name: 'Space name', exact: true })).toHaveValue(
    dev.name,
  );
  await page
    .getByRole('textbox', { name: 'Space name', exact: true })
    .fill('Unsaved development name');
  const trigger = page.getByRole('button', {
    name: `Switch space: ${dev.name} (Development)`,
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Switch space', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Find a space' })).toBeFocused();
  await expect(
    dialog
      .getByRole('region', { name: 'Linked spaces' })
      .getByRole('button', { name: `Open ${prod.name} (Production)`, exact: true }),
  ).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await dialog.getByRole('button', { name: `Open ${prod.name} (Production)`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`space=${dev.id}`));
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Space name', exact: true })).toHaveValue(
    'Unsaved development name',
  );
  await page.getByRole('textbox', { name: 'Space name', exact: true }).fill(dev.name);
  await trigger.click();
  await dialog.getByRole('textbox', { name: 'Find a space' }).fill('no matching project');
  await expect(dialog.getByText('No spaces match your search.')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Find a space' }).fill('');
  await page.screenshot({ path: info.outputPath('linked-switcher-desktop.png') });
  await dialog.getByRole('button', { name: `Open ${prod.name} (Production)`, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${baseURL}/?space=${prod.id}&view=settings`);
  const prodTrigger = page.getByRole('button', {
    name: `Switch space: ${prod.name} (Production)`,
    exact: true,
  });
  await expect(prodTrigger).toBeVisible();
  await prodTrigger.click();
  await dialog.getByRole('button', { name: `Open ${dev.name} (Development)`, exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/?space=${dev.id}&view=settings`);
  await page.goto(`${baseURL}/?space=${dev.id}&view=blocks`);
  await expect(page.getByRole('region', { name: 'Space environment' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Appearance').selectOption(theme);
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(trigger).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`development-${theme}-${width}.png`),
        fullPage: true,
      });
      await trigger.click();
      await expect(
        dialog.getByRole('button', { name: `Open ${prod.name} (Production)`, exact: true }),
      ).toBeVisible();
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      if (width === 390)
        await page.screenshot({ path: info.outputPath(`switcher-${theme}-mobile.png`) });
      await page.keyboard.press('Escape');
    }
  }
  expect(errors).toEqual([]);
});
