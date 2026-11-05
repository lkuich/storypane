import type { Pool } from 'pg';
import { dispatchWebhooks } from '@storypane/db';

/** Service-only work shared by the minute cron. No session or HTTP dispatch endpoint. */
export async function runBackgroundTasks(options: {
  db: Pool;
  publish: () => Promise<Array<{ spaceId: string; storyId: string; localeId: string }>>;
  rooms: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
  webhookEncryptionKey?: string;
  webhookHosts: string[];
  dispatch?: typeof dispatchWebhooks;
}) {
  const failures: unknown[] = [];
  try {
    const changed = await options.publish();
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
    failures.push(
      ...notifications.filter((item) => item.status === 'rejected').map((item) => item.reason),
    );
  } catch (error) {
    failures.push(error);
  }
  // Outbound delivery still runs if publishing or an editor-room notification failed.
  try {
    await (options.dispatch ?? dispatchWebhooks)(options.db, {
      encryptionKey: options.webhookEncryptionKey,
      allowedHosts: options.webhookHosts,
    });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new AggregateError(failures, 'Scheduled background work failed');
}
