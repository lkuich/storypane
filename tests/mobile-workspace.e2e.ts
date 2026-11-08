import { expect, test } from '@playwright/test';
import { contentScopesSchema } from '@storypane/core';
import type { CMSSession } from '../apps/web/src/components/cms-app';

test('mobile content keeps navigation compact and all tabs keyboard accessible', async ({
  page,
}, testInfo) => {
  await page.route('**/api/auth/config', (route) => route.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session**', (route) =>
    route.fulfill({
      json: {
        sessionId: 'mobile-layout',
        user: { id: 'mobile-layout', name: 'Editor', email: 'editor@example.com' },
        space: {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'the botox course',
          role: 'admin',
          roleName: 'Administrator',
          permissions: ['content:read', 'content:edit', 'content:publish'],
          contentScopes: contentScopesSchema.parse({}),
          productionSpaceId: null,
          schemaReadOnly: false,
          environment: 'prod',
        },
      } satisfies CMSSession,
    }),
  );
  await page.route('**/api/cms/**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/assets/uploads')
        ? { items: [] }
        : route.request().url().includes('/presence')
          ? {}
          : route.request().url().includes('/delivery-settings')
            ? { previewUrls: [] }
            : [],
    }),
  );
  for (const width of [320, 390, 640, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?space=11111111-1111-4111-8111-111111111111');
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New folder', exact: true })).toBeEnabled();
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Appearance').selectOption(theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      if (width <= 640) {
        expect((await page.locator('.app-sidebar').boundingBox())!.height).toBeLessThan(130);
        const folder = (await page
          .getByRole('button', { name: 'New folder', exact: true })
          .boundingBox())!;
        const story = (await page
          .getByRole('button', { name: 'New story', exact: true })
          .boundingBox())!;
        expect(folder.y).toBe(story.y);
        await expect(page.locator('.content-results')).toBeInViewport();
      }
    }
    await page.screenshot({
      path: testInfo.outputPath(`content-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('button', { name: 'Content', exact: true }).focus();
  for (const name of ['Reviews', 'Releases', 'Blocks', 'Datasources', 'Assets', 'Settings']) {
    await page.keyboard.press('Tab');
    const tab = navigation.getByRole('button', { name, exact: true });
    await expect(tab).toBeFocused();
    await expect(tab).toBeInViewport();
  }
  await navigation.getByRole('button', { name: 'Reviews', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(navigation.getByRole('button', { name: 'Reviews', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await navigation.getByRole('button', { name: 'Content', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Status', { exact: true })).toBeVisible();
});
