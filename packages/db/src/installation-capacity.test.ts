import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { Installation, sealConnection } from './installation.js';

const mock = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(async () => {}) }));
vi.mock('pg', () => ({
  Pool: class {
    query = mock.query;
    end = mock.end;
    on() {}
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
function setup() {
  const id = randomUUID(),
    key = randomBytes(32).toString('base64');
  const secret = sealConnection('postgresql://role:secret@localhost/space', key, id);
  mock.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('connection_secret')
      ? [{ connection_secret: secret }]
      : sql.includes('space_database')
        ? [{ space_id: id }]
        : [{ id }],
  }));
  const installation = new Installation({
    connectionString: 'postgresql://unused',
    encryptionKey: key,
    provider: 'local',
  });
  return { installation, id };
}
it('queues a media-sized burst without opening more than sixteen scopes', async () => {
  const { installation, id } = setup();
  const active = await Promise.all(Array.from({ length: 16 }, () => installation.acquire(id)));
  mock.query.mockClear();
  let acquired = 0;
  const pending = Array.from({ length: 40 }, () =>
    installation.acquire(id).then(async (scope) => {
      acquired++;
      await scope.close();
    }),
  );
  await Promise.resolve();
  expect(mock.query).not.toHaveBeenCalled();
  await active[0].close();
  await Promise.all(pending);
  expect(acquired).toBe(40);
  await active[0].close(); // Closing twice must not release another slot.
  expect(mock.end).toHaveBeenCalledTimes(41);
  await Promise.all(active.slice(1).map((scope) => scope.close()));
});
it('bounds waiting requests and removes timed-out waiters without losing capacity', async () => {
  vi.useFakeTimers();
  const { installation, id } = setup();
  const active = await Promise.all(Array.from({ length: 16 }, () => installation.acquire(id)));
  const waiting = Array.from({ length: 64 }, () =>
    installation.acquire(id).catch((error) => error),
  );
  await expect(installation.acquire(id)).rejects.toMatchObject({ code: 'unavailable' });
  await vi.advanceTimersByTimeAsync(5000);
  expect((await Promise.all(waiting)).every((error) => error.code === 'unavailable')).toBe(true);
  await Promise.all(active.map((scope) => scope.close()));
  const recovered = await Promise.all(Array.from({ length: 16 }, () => installation.acquire(id)));
  await Promise.all(recovered.map((scope) => scope.close()));
});
it('releases admission when a space lookup fails', async () => {
  const { installation, id } = setup();
  const active = await Promise.all(Array.from({ length: 16 }, () => installation.acquire(id)));
  mock.query.mockRejectedValueOnce(new Error('lookup failed'));
  const failed = installation.acquire(id).catch((error) => error);
  const next = installation.acquire(id);
  await active[0].close();
  expect((await failed).message).toBe('lookup failed');
  await (await next).close();
  await Promise.all(active.slice(1).map((scope) => scope.close()));
});
