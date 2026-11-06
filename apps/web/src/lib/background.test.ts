import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { Installation } from '@storypane/db/installation';
import { startBackgroundTasks } from './background';

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('@storypane/db', () => ({ dispatchWebhooks: dispatch }));
beforeEach(() => {
  vi.useFakeTimers();
  dispatch.mockReset().mockResolvedValue({ attempted: 0 });
});
afterEach(() => vi.useRealTimers());

function setup() {
  const ids = ['one', 'two', 'three', 'four'];
  const publish = vi.fn(async (_id: string) => [
    { spaceId: 'one', storyId: 'story', localeId: 'locale' },
  ]);
  const close = vi.fn();
  const acquire = vi.fn(async (id: string) => ({
    db: { id } as unknown as Pool,
    store: { runScheduledPublications: () => publish(id) },
    close,
  }));
  const installation = {
    directory: async () => ids.map((id) => ({ id, status: 'ready' })),
    forEachSpace: Installation.prototype.forEachSpace,
    acquire,
  } as unknown as Installation;
  const roomFetch = vi.fn(async (_request: Request) => new Response(null, { status: 204 }));
  const rooms = { getByName: vi.fn(() => ({ fetch: roomFetch })) };
  const report = vi.fn();
  const start = () =>
    startBackgroundTasks({
      installation,
      rooms,
      report,
      webhookEncryptionKey: 'key',
      webhookHosts: ['hooks.example.com'],
    });
  return { ids, publish, acquire, close, rooms, roomFetch, report, start };
}

describe('independent minute background jobs', () => {
  it('publishes, notifies trusted rooms and dispatches with separate database handles', async () => {
    const task = setup();
    const stop = task.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(task.publish).toHaveBeenCalledTimes(4);
      expect(task.rooms.getByName).toHaveBeenCalledWith('one:story:locale');
      const request = task.roomFetch.mock.calls[0][0];
      expect(request.url).toBe('https://room/invalidate');
      expect(request.method).toBe('POST');
      expect(request.headers.get('x-storypane-space-id')).toBe('one');
      expect(request.headers.get('x-storypane-story-id')).toBe('story');
      expect(request.headers.get('x-storypane-locale-id')).toBe('locale');
      expect(request.headers.has('x-storypane-actor')).toBe(false);
      expect(dispatch).toHaveBeenCalledWith(
        { id: 'one' },
        {
          encryptionKey: 'key',
          allowedHosts: ['hooks.example.com'],
        },
      );
      expect(task.close).toHaveBeenCalledTimes(8);
    } finally {
      await stop();
    }
  });

  it.each(['publication', 'notification'])(
    'continues delivery and retries after a %s failure',
    async (failure) => {
      const task = setup();
      if (failure === 'publication')
        task.publish.mockRejectedValueOnce(new Error('Publication failed'));
      else task.roomFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
      const stop = task.start();
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(task.report).toHaveBeenCalledOnce();
        expect(dispatch).toHaveBeenCalledTimes(4);
        expect(task.close).toHaveBeenCalledTimes(8);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(task.publish).toHaveBeenCalledTimes(8);
        expect(task.report).toHaveBeenCalledOnce();
      } finally {
        await stop();
      }
    },
  );

  it('keeps publishing every space each minute while three webhook receivers stall, then drains on stop', async () => {
    const task = setup();
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    dispatch.mockImplementation(() => gate);
    const stop = task.start();
    try {
      await vi.advanceTimersByTimeAsync(180_000);
      for (const id of task.ids)
        expect(task.publish.mock.calls.filter(([space]) => space === id)).toHaveLength(4);
      expect(dispatch).toHaveBeenCalledTimes(3);
      let stopped = false;
      const stopping = stop().then(() => {
        stopped = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false);
      finish();
      await stopping;
      expect(dispatch).toHaveBeenCalledTimes(4);
      expect(task.close).toHaveBeenCalledTimes(task.acquire.mock.calls.length);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(task.publish).toHaveBeenCalledTimes(16);
    } finally {
      finish();
      await stop();
    }
  });
});
