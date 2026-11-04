import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runBackgroundTasks } from './background';

describe('minute background runner', () => {
  it('publishes, invalidates affected rooms using trusted identities, then dispatches', async () => {
    const calls: string[] = [];
    const identity = { spaceId: 'space', storyId: 'story', localeId: 'locale' };
    const roomFetch = vi.fn(async (request: Request) => {
      calls.push('invalidate');
      expect(request.url).toBe('https://room/invalidate');
      expect(request.method).toBe('POST');
      expect(request.headers.get('x-storypane-space-id')).toBe(identity.spaceId);
      expect(request.headers.get('x-storypane-story-id')).toBe(identity.storyId);
      expect(request.headers.get('x-storypane-locale-id')).toBe(identity.localeId);
      expect(request.headers.has('x-storypane-actor')).toBe(false);
      return new Response(null, { status: 204 });
    });
    const rooms = { getByName: vi.fn(() => ({ fetch: roomFetch })) } as unknown as Pick<
      DurableObjectNamespace,
      'getByName'
    >;
    const db = {} as Pool;
    const dispatch = vi.fn(async () => {
      calls.push('dispatch');
      return { attempted: 1 };
    });
    await runBackgroundTasks({
      db,
      publish: async () => {
        calls.push('publish');
        return [identity];
      },
      rooms,
      webhookEncryptionKey: 'key',
      webhookHosts: ['hooks.example.com'],
      dispatch,
    });
    expect(calls).toEqual(['publish', 'invalidate', 'dispatch']);
    expect(rooms.getByName).toHaveBeenCalledWith('space:story:locale');
    expect(dispatch).toHaveBeenCalledWith(db, {
      encryptionKey: 'key',
      allowedHosts: ['hooks.example.com'],
    });
  });
  it('continues delivery when publishing fails and reports the error to cron', async () => {
    const dispatch = vi.fn(async () => ({ attempted: 0 }));
    await expect(
      runBackgroundTasks({
        db: {} as Pool,
        publish: async () => {
          throw new Error('publication error');
        },
        rooms: {} as DurableObjectNamespace,
        webhookHosts: [],
        dispatch,
      }),
    ).rejects.toThrow('Scheduled background work failed');
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it('continues delivery after failed room invalidation and reports the failure', async () => {
    const dispatch = vi.fn(async () => ({ attempted: 0 }));
    const rooms = {
      getByName: () => ({ fetch: async () => new Response(null, { status: 503 }) }),
    } as unknown as DurableObjectNamespace;
    await expect(
      runBackgroundTasks({
        db: {} as Pool,
        publish: async () => [{ spaceId: 's', storyId: 'st', localeId: 'l' }],
        rooms,
        webhookHosts: [],
        dispatch,
      }),
    ).rejects.toThrow('Scheduled background work failed');
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
