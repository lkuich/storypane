import { expect, test } from '@playwright/test';
import { dismissRecommendedSetup } from './fixtures/recommended-setup';

const spaceId = '11111111-1111-4111-8111-111111111111';
const invitationId = '22222222-2222-4222-8222-222222222222';

test('accepts a pending invitation with the keyboard on a narrow screen', async ({ page }) => {
  await dismissRecommendedSetup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/config', (route) => route.fulfill({ json: { provider: 'local' } }));
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        user: { id: 'invitee', name: 'Invitee', email: 'invitee@example.test' },
        space: null,
      },
    }),
  );
  let accepted = false;
  await page.route('**/api/spaces', (route) =>
    route.fulfill({
      json: accepted
        ? [{ id: spaceId, name: 'Marketing', role: 'viewer', storyCount: 2, memberCount: 1 }]
        : [],
    }),
  );
  await page.route('**/api/spaces/invitations', (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ spaceId, invitationId });
      accepted = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: [
        {
          id: invitationId,
          spaceId,
          spaceName: 'Marketing',
          roleName: 'Viewer',
          expiresAt: '2027-01-01T00:00:00Z',
        },
      ],
    });
  });

  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Pending invitations' });
  await expect(panel).toContainText('Viewer');
  const accept = panel.getByRole('button', { name: 'Accept invitation to Marketing' });
  await expect(accept).toBeVisible();
  const bounds = await accept.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await accept.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Marketing' })).toBeVisible();
});
