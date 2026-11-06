import { dispatchWebhooks } from '@storypane/db';
import type { Installation } from '@storypane/db/installation';
import { minuteScheduler } from '@storypane/runtime-node/scheduler';

/** Independent ticks prevent slow webhook receivers from delaying publication. */
export function startBackgroundTasks(options: {
  installation: Pick<Installation, 'forEachSpace' | 'acquire'>;
  rooms: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
  webhookEncryptionKey?: string;
  webhookHosts: string[];
  report: (error: unknown) => void;
}) {
  type Selected = Awaited<ReturnType<Installation['acquire']>>;
  const jobs = {
    publication: async (selected: Selected) => {
      const changed = await selected.store.runScheduledPublications();
      const notifications = await Promise.allSettled(
        changed.map(async ({ spaceId, storyId, localeId }) => {
          const response = await options.rooms.getByName(`${spaceId}:${storyId}:${localeId}`).fetch(
            new Request('https://room/invalidate', {
              method: 'POST',
              signal: AbortSignal.timeout(10_000),
              headers: {
                'x-storypane-space-id': spaceId,
                'x-storypane-story-id': storyId,
                'x-storypane-locale-id': localeId,
              },
            }),
          );
          if (!response.ok) throw new Error('Scheduled publication room invalidation failed');
        }),
      );
      const failures = notifications.filter((item) => item.status === 'rejected');
      if (failures.length)
        throw new AggregateError(
          failures.map((item) => item.reason),
          'Room invalidation failed',
        );
    },
    webhooks: (selected: Selected) =>
      dispatchWebhooks(selected.db, {
        encryptionKey: options.webhookEncryptionKey,
        allowedHosts: options.webhookHosts,
      }),
  };
  const stops = Object.entries(jobs).map(([name, run]) =>
    minuteScheduler(async () => {
      const failures = await options.installation.forEachSpace(async (id) => {
        const selected = await options.installation.acquire(id);
        try {
          await run(selected);
        } finally {
          await selected.close();
        }
      });
      if (failures.length) throw new Error(`Background ${name} failed for some spaces`);
    }, options.report),
  );
  return async () => {
    await Promise.all(stops.map((stop) => stop()));
  };
}
