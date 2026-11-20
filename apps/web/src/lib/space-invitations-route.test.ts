import { StorypaneError } from '@storypane/core';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  accept: vi.fn(),
  list: vi.fn(),
  close: vi.fn(),
}));
vi.mock('#platform', () => ({ env: { APP_URL: 'https://cms.test' } }));
vi.mock('./context', () => ({
  authenticateSession: mocks.authenticate,
  createServices: () => ({ installation: {}, close: mocks.close }),
}));
vi.mock('@storypane/db/accept-invitation', () => ({
  acceptAccountInvitation: mocks.accept,
  listAccountInvitations: mocks.list,
}));

const { GET, POST } = await import('../app/api/spaces/invitations/route');
const url = 'https://cms.test/api/spaces/invitations';
const input = { spaceId: 'space-id', invitationId: 'invitation-id' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ user: { id: 'invitee' } });
  mocks.list.mockResolvedValue([]);
  mocks.accept.mockResolvedValue({ ok: true });
});

it('requires a session before looking up invitations', async () => {
  mocks.authenticate.mockRejectedValueOnce(new StorypaneError('unauthenticated', 'Expired'));
  expect((await GET(new Request(url))).status).toBe(401);
  expect(mocks.list).not.toHaveBeenCalled();
  const response = await GET(new Request(url + '?userId=other'));
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.list).toHaveBeenCalledWith({}, 'invitee');
});

it('accepts only from the editor origin for the authenticated session', async () => {
  const request = (origin: string) =>
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(input),
    });
  expect((await POST(request('https://foreign.test'))).status).toBe(403);
  expect(mocks.accept).not.toHaveBeenCalled();
  expect((await POST(request('https://cms.test'))).status).toBe(200);
  expect(mocks.accept).toHaveBeenCalledWith({}, input, 'invitee');
});
