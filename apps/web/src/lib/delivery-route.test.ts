import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StorypaneError } from '@storypane/core';

const mocks = vi.hoisted(() => ({
  selectSpace: vi.fn(),
  close: vi.fn(),
  createTokenPreview: vi.fn(),
}));
vi.mock('#platform', () => ({ env: {} }));
vi.mock('./context', () => ({
  createServices: () => ({ ...mocks, store: { createTokenPreview: mocks.createTokenPreview } }),
}));
const { POST } = await import('../app/api/delivery/[resource]/route');
const spaceId = crypto.randomUUID();
const route = () => ({ params: Promise.resolve({ resource: 'preview' }) });
const request = (body: ReadableStream<Uint8Array>, token = 'invalid-token') =>
  new Request(`https://cms.test/api/delivery/preview?space=${spaceId}`, {
    method: 'POST',
    body,
    duplex: 'half',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  } as RequestInit);
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

it('rejects missing credentials without acquiring a space or waiting for the body', async () => {
  const body = new ReadableStream<Uint8Array>();
  const response = await POST(request(body, ''), route());
  expect(response.status).toBe(401);
  expect(mocks.selectSpace).not.toHaveBeenCalled();
  expect(body.locked).toBe(false);
  await body.cancel();
});

it('does not reserve database capacity for slow preview bodies', async () => {
  vi.useFakeTimers();
  const pending = POST(request(new ReadableStream<Uint8Array>()), route());
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.selectSpace).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await pending).status).toBe(400);
  expect(mocks.selectSpace).not.toHaveBeenCalled();
  expect(mocks.createTokenPreview).not.toHaveBeenCalled();
});

it('still authenticates complete preview requests and releases the space on rejection', async () => {
  mocks.createTokenPreview.mockRejectedValue(
    new StorypaneError('unauthenticated', 'Invalid token'),
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"storyId":"story"}'));
      controller.close();
    },
  });
  expect((await POST(request(body), route())).status).toBe(401);
  expect(mocks.selectSpace).toHaveBeenCalledWith(spaceId);
  expect(mocks.createTokenPreview).toHaveBeenCalledWith('invalid-token', spaceId, {
    storyId: 'story',
  });
  expect(mocks.close).toHaveBeenCalledOnce();
});
