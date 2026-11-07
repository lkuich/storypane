import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { reviewInstallation } from './fixtures/review-installation';
import type { LocaleSnapshot, PublicationSchedule } from '@storypane/core';

test('release checkbox flushes drafts, shows frozen fields and real SDK preview, then restores editing', async ({
  browser,
}, info) => {
  const installation = await reviewInstallation();
  const context = await browser.newContext({
    baseURL: installation.origin,
    viewport: { width: 1440, height: 1050 },
  });
  await context.grantPermissions(['local-network-access'], { origin: installation.origin });
  try {
    const headers = { origin: installation.origin, 'x-storypane-space-id': installation.spaceId };
    const response = await context.request.post('/api/auth/sign-in/email', {
      headers: { origin: installation.origin },
      data: { email: installation.people.admin.email, password: installation.password },
    });
    expect(response.ok()).toBe(true);
    const previewId = crypto.randomUUID();
    await installation.db.query(
      'UPDATE spaces SET preview_urls=$2,default_preview_id=$3 WHERE id=$1',
      [
        installation.spaceId,
        JSON.stringify([{ id: previewId, name: 'Test app', url: 'http://127.0.0.1:3159/{slug}' }]),
        previewId,
      ],
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://127.0.0.1:3159/**', async (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (['preview.js', 'types.js', 'migration-warning.js'].includes(name)) {
        await route.fulfill({
          contentType: 'application/javascript',
          body: await readFile(new URL(`../packages/sdk/dist/${name}`, import.meta.url), 'utf8'),
        });
      } else {
        await route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><body><button id="story">Waiting</button><script type="module">
import {connectPreview} from '/preview.js';
connectPreview({cmsUrl:${JSON.stringify(installation.origin)},spaceId:${JSON.stringify(installation.spaceId)},story:{id:${JSON.stringify(installation.storyId)},locale:''},mode:{draft:true},onChange(story){ const button=document.getElementById('story');button.textContent=story.content.title;button.dataset.storypaneId=story.content._uid; }});
</script></body></html>`,
        });
      }
    });
    const base = `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}`;
    const editorUrl = `/?space=${installation.spaceId}&story=${installation.storyId}`;
    await page.goto(editorUrl);
    const checkbox = page.getByRole('checkbox', {
      name: 'View release version (read-only)',
      exact: true,
    });
    await expect(checkbox).toHaveCount(0);
    const title = page.getByRole('textbox', { name: 'Page title', exact: true });
    await expect(title).toBeEditable();
    await title.fill('Approved release A');
    await expect
      .poll(
        async () =>
          (
            await installation.db.query(
              "SELECT fields->>'title' AS title FROM block_drafts WHERE id=$1",
              [installation.rootBlockId],
            )
          ).rows[0]?.title,
      )
      .toBe('Approved release A');
    const frozen: LocaleSnapshot = await (await context.request.get(base, { headers })).json();
    const localTime = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
    const scheduledResponse = await context.request.post(`${base}/schedules`, {
      headers,
      data: {
        requestId: crypto.randomUUID(),
        checkpointId: frozen.checkpointId,
        localTime,
        timezone: 'UTC',
        dueAt: `${localTime}:00.000Z`,
        expectedScheduleId: null,
        expectedRevision: null,
      },
    });
    expect(scheduledResponse.ok()).toBe(true);
    const schedule: PublicationSchedule = await scheduledResponse.json();
    await page.reload();
    await expect(checkbox).toBeVisible();
    await expect(title).toBeEditable();
    await title.fill('Later private draft B');
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(title).toHaveValue('Approved release A');
    await expect(title).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Review & publish', exact: true }),
    ).toBeDisabled();
    const frame = page.frameLocator('iframe[title="Live application preview"]');
    await expect(frame.locator('#story')).toHaveText('Approved release A');
    await expect(page.getByText('Release preview', { exact: true })).toBeVisible();
    await frame.locator('#story').click();
    await expect(title).toHaveValue('Approved release A');
    await expect
      .poll(
        async () =>
          (
            await installation.db.query(
              'SELECT count(*)::int AS count FROM edit_leases WHERE locale_id=$1 AND user_id=$2',
              [installation.localeId, installation.people.admin.id],
            )
          ).rows[0].count,
      )
      .toBe(0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(checkbox).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath('release-version.png') });
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    await expect(title).toHaveValue('Later private draft B');
    await expect(title).toBeEditable();
    await expect(frame.locator('#story')).toHaveText('Later private draft B');
    const cancel = await context.request.delete(`${base}/schedules/${schedule.id}`, {
      headers,
      data: { requestId: crypto.randomUUID(), revision: schedule.revision },
    });
    expect(cancel.ok()).toBe(true);
    await page.reload();
    await expect(title).toBeEditable();
    await expect(checkbox).toHaveCount(0);
    expect(errors).toEqual([]);
  } catch (cause) {
    const log = await readFile(installation.logPath, 'utf8');
    console.error(log.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database]'));
    throw cause;
  } finally {
    await context.close();
    await installation.close();
  }
});
