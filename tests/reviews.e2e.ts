import {
  test as base,
  expect,
  type Page,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import { reviewInstallation } from './fixtures/review-installation';
const test = base.extend<{ installation: Awaited<ReturnType<typeof reviewInstallation>> }>({
  installation: [
    async ({ browserName: _browserName }, runWithFixture) => {
      const fixture = await reviewInstallation();
      try {
        await runWithFixture(fixture);
      } finally {
        await fixture.close();
      }
    },
    { timeout: 60000 },
  ],
});
async function signIn(
  browser: Browser,
  installation: Awaited<ReturnType<typeof reviewInstallation>>,
  person: string,
) {
  const context = await browser.newContext({
    baseURL: installation.origin,
    viewport: { width: 1440, height: 1050 },
  });
  const response = await context.request.post('/api/auth/sign-in/email', {
    headers: {
      origin: installation.origin,
      'x-forwarded-for': `127.0.0.${['admin', 'writer', 'bob', 'cara'].indexOf(person) + 1}`,
    },
    data: { email: installation.people[person].email, password: installation.password },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const page = await context.newPage();
  return { context, page };
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
function apiHeaders(installation: Awaited<ReturnType<typeof reviewInstallation>>) {
  return { origin: installation.origin, 'x-storypane-space-id': installation.spaceId };
}

test('teams in Members & roles, writer requests, two independent approvals, badges, and real publish gating', async ({
  browser,
  installation,
}, info) => {
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  try {
    const admin = await signIn(browser, installation, 'admin');
    contexts.push(admin.context);
    admin.page.on('pageerror', (error) => errors.push(error.message));
    await admin.page.goto(`/?space=${installation.spaceId}&view=settings&section=team`);
    await expect(admin.page.getByRole('heading', { name: 'Teams', exact: false })).toBeVisible();
    await admin.page.getByRole('button', { name: 'Create team', exact: true }).click();
    const teamDialog = admin.page.getByRole('dialog', { name: 'Create team', exact: true });
    await teamDialog.getByLabel('Team name', { exact: true }).fill('Editorial');
    await teamDialog.getByRole('checkbox', { name: /Bob Reviewer/ }).check();
    await teamDialog.getByRole('checkbox', { name: /Cara Reviewer/ }).check();
    await teamDialog.getByLabel('Minimum approvals', { exact: true }).fill('2');
    await teamDialog.getByRole('button', { name: 'Save team', exact: true }).click();
    await expect(teamDialog).not.toBeVisible();
    await expect(
      admin.page.locator('#teams').getByText('2 approvals required', { exact: true }),
    ).toBeVisible();
    for (const width of [390, 320, 1440]) {
      await admin.page.setViewportSize({ width, height: 1000 });
      await noOverflow(admin.page);
    }
    await admin.page.locator('#teams').screenshot({ path: info.outputPath('teams-desktop.png') });

    const writer = await signIn(browser, installation, 'writer');
    contexts.push(writer.context);
    writer.page.on('pageerror', (error) => errors.push(error.message));
    const editorUrl = `/?space=${installation.spaceId}&story=${installation.storyId}`;
    await writer.page.goto(editorUrl);
    await expect(
      writer.page.getByRole('button', { name: 'Review & publish', exact: true }),
    ).toHaveCount(0);
    const request = writer.page.getByRole('button', { name: 'Request review', exact: true });
    await request.focus();
    await writer.page.keyboard.press('Enter');
    const dialog = writer.page.getByRole('dialog', { name: 'Reviews & comments', exact: true });
    await expect(dialog.getByRole('switch', { name: 'Request review', exact: true })).toBeChecked();
    await dialog.getByRole('checkbox', { name: /Editorial/ }).check();
    const message = dialog.getByRole('textbox', { name: 'Message (optional)', exact: true });
    await expect(dialog.getByRole('combobox', { name: 'Mention a member' })).toHaveCount(0);
    await message.fill('Please check the launch copy. @ca');
    await dialog.getByRole('option', { name: /Cara Reviewer/ }).click();
    await expect(message).toHaveValue('Please check the launch copy. @Cara Reviewer ');
    await dialog.getByRole('button', { name: 'Request review', exact: true }).click();
    await expect(dialog.getByText('0 / 2 approved', { exact: true })).toBeVisible();
    await writer.page.keyboard.press('Escape');
    await expect(
      writer.page.getByText('1 review is awaiting approval.', { exact: true }),
    ).toBeVisible();
    await writer.page.goto(`/?space=${installation.spaceId}&view=reviews`);
    await expect(writer.page.getByRole('button', { name: /Available to review/ })).toHaveCount(0);
    await expect(writer.page.getByRole('button', { name: /Requested by me/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(writer.page.locator('.review-inbox-row')).toHaveCount(1);
    await writer.page.screenshot({ path: info.outputPath('reviews-inbox-desktop.png') });

    const snapshot = await (
      await admin.context.request.get(
        `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}`,
        { headers: apiHeaders(installation) },
      )
    ).json();
    const publish = () =>
      admin.context.request.post(
        `/api/cms/stories/${installation.storyId}/locales/${installation.localeId}/commands`,
        {
          headers: apiHeaders(installation),
          data: {
            mutationId: crypto.randomUUID(),
            expectedRevisions: {},
            leaseTokens: {},
            type: 'publishCheckpoint',
            payload: { checkpointId: snapshot.checkpointId },
          },
        },
      );
    expect((await publish()).status()).toBe(400);
    await admin.page.goto(editorUrl);
    await admin.page.getByRole('button', { name: 'Review & publish', exact: true }).click();
    await expect(
      admin.page
        .getByRole('dialog', { name: 'Review before publishing' })
        .getByRole('button', { name: /^Publish revision/ }),
    ).toBeDisabled();
    await admin.page.keyboard.press('Escape');
    for (const person of ['bob', 'cara']) {
      const reviewer = await signIn(browser, installation, person);
      contexts.push(reviewer.context);
      reviewer.page.on('pageerror', (error) => errors.push(error.message));
      await reviewer.page.goto(`/?space=${installation.spaceId}&view=reviews`);
      await expect(reviewer.page.locator('.review-nav-badge')).toHaveText('1');
      await reviewer.page.locator('.review-inbox-row').focus();
      await reviewer.page.keyboard.press('Enter');
      const details = reviewer.page.getByRole('dialog', { name: 'Review details' });
      await expect(
        details.getByText(`${person === 'bob' ? 0 : 1} / 2 approved`, { exact: true }),
      ).toBeVisible();
      if (person === 'bob') {
        for (const width of [390, 320, 1440]) {
          await reviewer.page.setViewportSize({ width, height: 1000 });
          await noOverflow(reviewer.page);
          expect(
            await details.evaluate((element) => element.scrollWidth <= element.clientWidth),
          ).toBe(true);
        }
        await details.screenshot({ path: info.outputPath('review-desktop.png') });
        await reviewer.page.keyboard.press('Escape');
        await reviewer.page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark');
        await reviewer.page.locator('.review-inbox-row').click();
        await expect(details.getByText('0 / 2 approved', { exact: true })).toBeVisible();
        await details.screenshot({ path: info.outputPath('review-dark.png') });
      }
      if (person === 'bob')
        await details
          .getByRole('textbox', { name: 'Reply', exact: true })
          .fill('An observation to share after approving.');
      await details.getByRole('button', { name: 'Approve', exact: true }).focus();
      await reviewer.page.keyboard.press('Enter');
      await expect(
        details.getByText(`${person === 'bob' ? 1 : 2} / 2 approved`, { exact: true }),
      ).toBeVisible();
      await expect(reviewer.page.locator('.review-nav-badge')).toHaveCount(0);
      if (person === 'bob') {
        await expect(details.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue(
          'An observation to share after approving.',
        );
        await details.getByRole('button', { name: 'Reply', exact: true }).click();
        await expect(
          details.getByText('An observation to share after approving.', { exact: true }),
        ).toBeVisible();
      }
      await reviewer.page.keyboard.press('Escape');
      const empty = reviewer.page.locator('.review-empty');
      await expect(
        empty.getByRole('heading', { name: 'You’re all caught up.', exact: true }),
      ).toBeVisible();
      for (const width of [1440, 390]) {
        await reviewer.page.setViewportSize({ width, height: 1000 });
        await noOverflow(reviewer.page);
        const panel = await empty.boundingBox();
        const icon = await empty.locator(':scope > svg').boundingBox();
        expect(Math.abs(icon!.x + icon!.width / 2 - (panel!.x + panel!.width / 2))).toBeLessThan(1);
        await reviewer.page
          .locator('.reviews-screen')
          .screenshot({ path: info.outputPath(`reviews-empty-${person}-${width}.png`) });
      }
      if (person === 'bob') expect((await publish()).status()).toBe(400);
    }
    expect((await publish()).status()).toBe(200);
    const reviews = await (
      await admin.context.request.get('/api/cms/reviews', { headers: apiHeaders(installation) })
    ).json();
    expect(reviews[0].status).toBe('published');
    expect(
      reviews[0].messages.find((message: { event: string }) => message.event === 'requested')
        .mentionIds,
    ).toEqual([installation.people.cara.id]);
    expect(
      reviews[0].messages.filter((message: { event: string }) => message.event === 'approve'),
    ).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('block list comments open the composer directly and keep the draft when review is toggled', async ({
  browser,
  installation,
}, info) => {
  const reviewer = await signIn(browser, installation, 'bob');
  try {
    await reviewer.page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}`);
    await reviewer.page.setViewportSize({ width: 390, height: 1000 });
    await noOverflow(reviewer.page);
    const row = reviewer.page.locator('.block-list-item').first();
    await row.screenshot({ path: info.outputPath('block-comment-button-mobile.png') });
    const blockId = await row.getAttribute('data-preview-block');
    expect(blockId).toBeTruthy();
    expect(blockId).not.toBe(installation.rootBlockId);
    await expect(row.getByRole('button', { name: /^Remove / })).toBeDisabled();
    await expect(row.getByRole('button', { name: /^Reorder / })).toBeDisabled();
    const comments = row.getByRole('button', { name: /^Comments and review for / });
    await comments.focus();
    await comments.press('Enter');
    const dialog = reviewer.page.getByRole('dialog', { name: 'Reviews & comments' });
    const toggle = dialog.getByRole('switch', { name: 'Request review', exact: true });
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByRole('searchbox', { name: 'Find reviewers' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Post comment', exact: true })).toBeDisabled();
    await dialog
      .getByRole('textbox', { name: 'Comment', exact: true })
      .fill('Check this block, @ca');
    await dialog.getByRole('option', { name: /Cara Reviewer/ }).click();
    await toggle.focus();
    await toggle.press('Space');
    await expect(toggle).toBeChecked();
    await expect(
      dialog.getByRole('textbox', { name: 'Message (optional)', exact: true }),
    ).toHaveValue('Check this block, @Cara Reviewer ');
    await expect(
      dialog.getByRole('button', { name: 'Request review', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /Cara Reviewer/ }).check();
    for (const width of [320, 390, 1440]) {
      await reviewer.page.setViewportSize({ width, height: 1000 });
      await noOverflow(reviewer.page);
      await dialog.screenshot({ path: info.outputPath(`composer-review-${width}.png`) });
    }
    await reviewer.page.emulateMedia({ colorScheme: 'dark' });
    await dialog.screenshot({ path: info.outputPath('composer-review-dark.png') });
    await toggle.focus();
    await toggle.press('Space');
    await expect(dialog.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue(
      'Check this block, @Cara Reviewer ',
    );
    await dialog.screenshot({ path: info.outputPath('composer-comment-desktop.png') });
    await dialog.getByRole('button', { name: 'Post comment', exact: true }).click();
    await expect(
      dialog.getByText('Check this block, @Cara Reviewer', { exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'All discussions', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('');
    await dialog
      .getByRole('region', { name: 'Existing discussions' })
      .getByRole('button', { name: /Check this block/ })
      .click();
    await expect(dialog.getByRole('textbox', { name: 'Reply', exact: true })).toBeVisible();
    const discussions = await (
      await reviewer.context.request.get(
        `/api/cms/reviews?storyId=${installation.storyId}&localeId=${installation.localeId}`,
        { headers: apiHeaders(installation) },
      )
    ).json();
    expect(discussions).toHaveLength(1);
    expect(discussions[0]).toMatchObject({ kind: 'comment', blockId });
    expect(discussions[0].messages[0].mentionIds).toEqual([installation.people.cara.id]);
  } finally {
    await reviewer.context.close();
  }
});

test('block comments, mentions, changes requested, withdrawal, and scoped block requests', async ({
  browser,
  installation,
}, info) => {
  const contexts: BrowserContext[] = [];
  try {
    const writer = await signIn(browser, installation, 'writer');
    contexts.push(writer.context);
    await writer.page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}`);
    await writer.page
      .getByRole('button', { name: 'Comments and review for Page', exact: true })
      .click();
    const dialog = writer.page.getByRole('dialog', { name: 'Reviews & comments' });
    const comment = dialog.getByRole('textbox', { name: 'Comment', exact: true });
    await comment.fill('Could you check this heading? @');
    await expect(dialog.getByRole('listbox', { name: 'Mention a person' })).toBeVisible();
    await comment.press('ArrowDown');
    await expect(dialog.getByRole('option', { name: /Bob Reviewer/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await comment.press('ArrowUp');
    await expect(dialog.getByRole('option', { name: /Alex Writer/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await comment.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('listbox')).toHaveCount(0);
    await comment.pressSequentially('bo');
    await comment.press('Enter');
    await expect(comment).toHaveValue('Could you check this heading? @Bob Reviewer ');
    await expect(dialog.getByRole('button', { name: 'Post comment', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Post comment', exact: true }).click();
    await expect(
      dialog.getByText('Could you check this heading? @Bob Reviewer', { exact: true }),
    ).toBeVisible();
    const reply = dialog.getByRole('textbox', { name: 'Reply', exact: true });
    await writer.page.setViewportSize({ width: 390, height: 844 });
    await reply.fill('Thanks @ca');
    await expect(dialog.getByRole('option', { name: /Cara Reviewer/ })).toBeVisible();
    await noOverflow(writer.page);
    await dialog.screenshot({ path: info.outputPath('inline-mention-mobile.png') });
    await reply.press('Tab');
    await expect(reply).toHaveValue('Thanks @Cara Reviewer ');
    await reply.fill('Thanks for checking.');
    await dialog.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(dialog.getByText('Thanks for checking.', { exact: true })).toBeVisible();
    await reply.fill('Thanks @ca');
    await dialog.getByRole('option', { name: /Cara Reviewer/ }).click();
    await dialog.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(dialog.getByText('Thanks @Cara Reviewer', { exact: true })).toBeVisible();
    await writer.page.setViewportSize({ width: 1440, height: 1000 });
    await dialog.getByRole('button', { name: 'Resolve discussion', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Reopen discussion', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Reopen discussion', exact: true }).click();
    await dialog.getByRole('button', { name: 'All discussions', exact: true }).click();
    await dialog.getByRole('switch', { name: 'Request review', exact: true }).check();
    await dialog.getByRole('checkbox', { name: /Bob Reviewer/ }).check();
    await dialog.getByRole('button', { name: 'Request review', exact: true }).click();
    await expect(dialog.getByText('Page', { exact: true })).toBeVisible();
    await writer.page.keyboard.press('Escape');
    const reviewer = await signIn(browser, installation, 'bob');
    contexts.push(reviewer.context);
    await reviewer.page.goto(`/?space=${installation.spaceId}&view=reviews`);
    await reviewer.page.locator('.review-inbox-row').click();
    const details = reviewer.page.getByRole('dialog', { name: 'Review details' });
    await details.getByRole('button', { name: 'Request changes', exact: true }).click();
    await details
      .getByRole('textbox', { name: 'Changes needed', exact: true })
      .fill('Please tighten the heading. @al');
    await details.getByRole('option', { name: /Alex Writer/ }).click();
    await details.getByRole('button', { name: 'Send requested changes', exact: true }).click();
    await expect(details.getByText('Changes requested', { exact: true }).first()).toBeVisible();
    await reviewer.page.keyboard.press('Escape');
    await reviewer.page.getByRole('button', { name: 'History & mentions', exact: true }).click();
    await expect(reviewer.page.locator('.review-inbox-row')).toHaveCount(2);
    await writer.page.goto(`/?space=${installation.spaceId}&view=reviews`);
    await writer.page.locator('.review-inbox-row').click();
    const own = writer.page.getByRole('dialog', { name: 'Review details' });
    await expect(
      own.getByText('Please tighten the heading. @Alex Writer', { exact: true }),
    ).toBeVisible();
    await writer.page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(writer.page);
    await own.screenshot({ path: info.outputPath('review-mobile.png') });
    writer.page.once('dialog', (prompt) => prompt.accept());
    await own.getByRole('button', { name: 'Withdraw request', exact: true }).click();
    await expect(own.getByText('Withdrawn', { exact: true })).toBeVisible();
    await writer.page.keyboard.press('Escape');
    await expect(writer.page.locator('.review-inbox-row')).toHaveCount(0);
    const all = await (
      await writer.context.request.get('/api/cms/reviews', { headers: apiHeaders(installation) })
    ).json();
    const discussion = all.find((item: { kind: string }) => item.kind === 'comment');
    expect(
      discussion.messages.find((message: { event: string }) => message.event === 'comment')
        .mentionIds,
    ).toEqual([installation.people.bob.id]);
    expect(
      discussion.messages.find(
        (message: { body: string }) => message.body === 'Thanks for checking.',
      ).mentionIds,
    ).toEqual([]);
    expect(
      discussion.messages.find(
        (message: { body: string }) => message.body === 'Thanks @Cara Reviewer',
      ).mentionIds,
    ).toEqual([installation.people.cara.id]);
    expect(
      all
        .find((item: { kind: string }) => item.kind === 'review')
        .messages.find((message: { event: string }) => message.event === 'request_changes')
        .mentionIds,
    ).toEqual([installation.people.writer.id]);
    expect(
      all.find(
        (item: { kind: string; status: string }) =>
          item.kind === 'review' && item.status === 'withdrawn',
      ).blockId,
    ).toBe(installation.rootBlockId);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('editing approved content requires approval again and rejects a stale reviewer decision', async ({
  browser,
  installation,
}) => {
  const contexts: BrowserContext[] = [];
  try {
    const writer = await signIn(browser, installation, 'writer');
    contexts.push(writer.context);
    await writer.page.goto(`/?space=${installation.spaceId}&story=${installation.storyId}`);
    await writer.page.getByRole('button', { name: 'Request review', exact: true }).click();
    const dialog = writer.page.getByRole('dialog', { name: 'Reviews & comments' });
    await dialog.getByRole('checkbox', { name: /Bob Reviewer/ }).check();
    await dialog.getByRole('button', { name: 'Request review', exact: true }).click();
    await expect(dialog.getByText('Awaiting approval', { exact: true })).toBeVisible();
    await writer.page.keyboard.press('Escape');
    const reviewer = await signIn(browser, installation, 'bob');
    contexts.push(reviewer.context);
    await reviewer.page.goto(`/?space=${installation.spaceId}&view=reviews`);
    await reviewer.page.locator('.review-inbox-row').click();
    const details = reviewer.page.getByRole('dialog', { name: 'Review details' });
    await details.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(details.getByText('Approved', { exact: true }).first()).toBeVisible();
    const requests = await (
      await writer.context.request.get('/api/cms/reviews', { headers: apiHeaders(installation) })
    ).json();
    const title = writer.page.getByRole('textbox', { name: 'Page title', exact: true });
    await expect(title).toBeEditable();
    const saved = writer.page.waitForResponse(
      (response) =>
        response.url().includes('/commands') &&
        response.request().postDataJSON().type === 'saveBlock',
    );
    await title.fill('A title that needs a fresh review');
    expect((await saved).ok()).toBe(true);
    await expect(
      writer.page.getByText('1 review is awaiting approval.', { exact: true }),
    ).toBeVisible();
    const stale = await reviewer.context.request.put(`/api/cms/reviews/${requests[0].id}`, {
      headers: apiHeaders(installation),
      data: { action: 'approve', expectedVersion: requests[0].version },
    });
    expect(stale.status()).toBe(409);
    await reviewer.page.keyboard.press('Escape');
    const refresh = reviewer.page.getByRole('button', { name: 'Refresh reviews', exact: true });
    await expect(refresh).toHaveText('');
    await refresh.focus();
    await reviewer.page.keyboard.press('Enter');
    await expect(reviewer.page.locator('.review-nav-badge')).toHaveText('1');
    await reviewer.page.locator('.review-inbox-row').click();
    await expect(
      details.getByText('Content has changed since this review was requested.', { exact: false }),
    ).toBeVisible();
    await details.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(reviewer.page.locator('.review-nav-badge')).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('member invitations keep the header aligned and expose the link only through copying', async ({
  browser,
  installation,
}, info) => {
  const admin = await signIn(browser, installation, 'admin');
  try {
    await admin.context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: installation.origin,
    });
    await admin.page.goto(`/?space=${installation.spaceId}&view=settings&section=team`);
    const members = admin.page.locator('#members');
    const intro = members.locator('.member-intro');
    const description = await intro.locator('p').boundingBox();
    const copy = members.getByRole('button', { name: 'Copy workspace link', exact: true });
    const button = await copy.boundingBox();
    expect(
      Math.abs(description!.y + description!.height / 2 - (button!.y + button!.height / 2)),
    ).toBeLessThan(2);
    await copy.focus();
    await admin.page.keyboard.press('Enter');
    await expect(members.getByRole('status')).toHaveText('Link copied.');
    expect(await admin.page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${installation.origin}/?space=${installation.spaceId}`,
    );
    await members.getByRole('button', { name: 'Add member', exact: true }).click();
    const dialog = admin.page.getByRole('dialog', { name: 'Add a space member', exact: true });
    await dialog
      .getByRole('textbox', { name: 'Email address', exact: true })
      .fill('invited@reviews.test');
    const created = admin.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/cms/invitations' &&
        response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Add member', exact: true }).click();
    const invitation = await (await created).json();
    await expect(dialog).not.toBeVisible();
    await expect(members.getByRole('status')).toHaveText(
      'Invitation ready. Copy the invitation link to share it.',
    );
    await expect(
      members.getByRole('textbox', { name: 'Invitation link', exact: true }),
    ).toHaveCount(0);
    await expect(members).not.toContainText(invitation.link);
    const inviteCopy = members.getByRole('button', { name: 'Copy invitation link', exact: true });
    await inviteCopy.focus();
    await admin.page.keyboard.press('Enter');
    await expect(members.getByRole('status')).toHaveText('Link copied.');
    expect(await admin.page.evaluate(() => navigator.clipboard.readText())).toBe(invitation.link);
    for (const theme of ['light', 'dark']) {
      await admin.page
        .getByRole('combobox', { name: 'Appearance', exact: true })
        .selectOption(theme);
      for (const width of [1440, 390, 320]) {
        await admin.page.setViewportSize({ width, height: 1000 });
        await noOverflow(admin.page);
        const body = await members.locator('.panel-body').boundingBox();
        const status = await members.getByRole('status').boundingBox();
        expect(status!.x).toBeGreaterThan(body!.x);
        expect(status!.x + status!.width).toBeLessThan(body!.x + body!.width);
        await members.screenshot({ path: info.outputPath(`members-${theme}-${width}.png`) });
      }
    }
  } finally {
    await admin.context.close();
  }
});

test('invitation screen shows the signed-in account, stays responsive, and handles wrong-account and used links', async ({
  browser,
  installation,
}, info) => {
  const admin = await signIn(browser, installation, 'admin');
  const reviewer = await signIn(browser, installation, 'bob');
  try {
    const headers = apiHeaders(installation);
    expect(
      (
        await admin.context.request.delete(`/api/cms/members/${installation.people.bob.id}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
    const response = await admin.context.request.post('/api/cms/invitations', {
      headers,
      data: { email: installation.people.bob.email, role: 'reviewer' },
    });
    expect(response.status()).toBe(201);
    const { link } = await response.json();
    await admin.page.goto(link);
    const card = admin.page.getByRole('region', { name: 'Accept invitation', exact: true });
    await expect(card.getByText(installation.people.admin.email, { exact: true })).toBeVisible();
    const desktop = await card.boundingBox();
    expect(desktop!.width).toBeGreaterThan(400);
    expect(desktop!.y).toBeGreaterThan(100);
    for (const theme of ['light', 'dark']) {
      await admin.page.getByRole('combobox', { name: 'Appearance' }).selectOption(theme);
      for (const width of [1440, 390, 320]) {
        await admin.page.setViewportSize({ width, height: 1000 });
        await noOverflow(admin.page);
        await card.screenshot({
          path: info.outputPath(`invitation-signed-in-${theme}-${width}.png`),
        });
      }
    }
    await admin.page.setViewportSize({ width: 1440, height: 1000 });
    await admin.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText('Sign in with the invited account');
    await admin.page.screenshot({ path: info.outputPath('invitation-wrong-account.png') });
    await reviewer.page.goto(link);
    await expect(
      reviewer.page.getByText(installation.people.bob.email, { exact: true }),
    ).toBeVisible();
    await reviewer.page.getByRole('button', { name: 'Accept invitation', exact: true }).focus();
    await reviewer.page.keyboard.press('Enter');
    await expect(
      reviewer.page.getByRole('heading', { name: 'Content', exact: true }),
    ).toBeVisible();
    const space = await (await reviewer.context.request.get('/api/cms/space', { headers })).json();
    expect(space.role).toBe('reviewer');
    await reviewer.page.goto(link);
    await reviewer.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(reviewer.page.getByRole('alert')).toContainText(
      'Invitation expired or already used',
    );
    await reviewer.page.screenshot({ path: info.outputPath('invitation-used.png') });
  } finally {
    await Promise.all([admin.context.close(), reviewer.context.close()]);
  }
});

test('invited account creation and existing sign-in have a designed responsive screen and working keyboard flow', async ({
  browser,
  installation,
}, info) => {
  const admin = await signIn(browser, installation, 'admin');
  const invited = await browser.newContext({
    baseURL: installation.origin,
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const email = 'new-person@reviews.test';
    const password = 'invited-account-test-password';
    const response = await admin.context.request.post('/api/cms/invitations', {
      headers: apiHeaders(installation),
      data: { email, role: 'editor' },
    });
    expect(response.status()).toBe(201);
    const { link } = await response.json();
    const page = await invited.newPage();
    await page.goto(link);
    const card = page.getByRole('region', { name: 'Accept invitation', exact: true });
    await expect(card.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Sign in instead', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await card
      .getByRole('button', { name: 'Create an invited account instead', exact: true })
      .click();
    for (const theme of ['light', 'dark']) {
      await page.getByRole('combobox', { name: 'Appearance' }).selectOption(theme);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await noOverflow(page);
        expect((await page.locator('.login-story h1').innerText()).replace(/\s+/g, ' ')).toBe(
          'Good stories start together.',
        );
        if (width <= 760) {
          const brand = await page.locator('.login-intro .brand-name').boundingBox();
          const appearance = await page.locator('.login-appearance').boundingBox();
          expect(brand!.x + brand!.width).toBeLessThan(appearance!.x);
        }
        await page.screenshot({
          path: info.outputPath(`invitation-new-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await card.getByRole('textbox', { name: 'Name', exact: true }).fill('New teammate');
    await page.keyboard.press('Tab');
    const secret = card.getByLabel('Password', { exact: true });
    await expect(secret).toBeFocused();
    await secret.fill(password);
    await page.keyboard.press('Tab');
    await expect(
      card.getByRole('button', { name: 'Accept invitation', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card.getByRole('status').filter({ hasText: 'Account created' })).toContainText(
      email,
    );
    await card.getByLabel('Email', { exact: true }).fill(email);
    await card.getByLabel('Password', { exact: true }).fill(password);
    await card.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
    const spaces = await (await invited.request.get('/api/spaces')).json();
    expect(spaces.some((space: { id: string }) => space.id === installation.spaceId)).toBe(true);
  } finally {
    await Promise.all([admin.context.close(), invited.close()]);
  }
});
