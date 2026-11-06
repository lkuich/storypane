import { env } from '#platform';
import { authenticate, createServices } from './context';
import { assertOrigin } from './http';

export async function liveRequest(
  request: Request,
): Promise<{ name: string; request: Request } | null> {
  const url = new URL(request.url);
  const previewRoute = url.pathname === '/api/preview/live';
  const path = url.pathname.match(
    /^\/api\/cms\/stories\/([0-9a-f-]{36})\/locales\/([0-9a-f-]{36})\/live$/i,
  );
  if (!previewRoute && !path) return null;
  const services = createServices();
  try {
    if (previewRoute) {
      const protocols = (request.headers.get('sec-websocket-protocol') ?? '')
        .split(',')
        .map((value) => value.trim());
      const token = protocols.find((value) => value.startsWith('bp_')) ?? '';
      await services.selectSpace(await services.installation.resolvePreview(token));
      const preview = await services.store.authenticatePreview(
        protocols.find((value) => value.startsWith('bp_')) ?? '',
        request.headers.get('origin') ?? '',
      );
      const actor = {
        spaceId: preview.spaceId,
        userId: 'preview',
        sessionId: preview.id,
        role: 'editor',
      };
      return {
        name: `${preview.spaceId}:${preview.storyId}:${preview.localeId}`,
        request: new Request('https://room/preview-live', {
          headers: {
            upgrade: 'websocket',
            'x-storypane-actor': JSON.stringify(actor),
            'x-storypane-preview-id': preview.id,
            'x-storypane-story-id': preview.storyId,
            'x-storypane-locale-id': preview.localeId,
          },
        }),
      };
    }
    assertOrigin(request, env.APP_URL);
    const { actor } = await authenticate(request, services);
    const [, storyId, localeId] = path!;
    await services.store.getSnapshot(actor, storyId, localeId);
    return {
      name: `${actor.spaceId}:${storyId}:${localeId}`,
      request: new Request('https://room/live', {
        headers: {
          upgrade: 'websocket',
          'x-storypane-actor': JSON.stringify(actor),
          'x-storypane-story-id': storyId,
          'x-storypane-locale-id': localeId,
        },
      }),
    };
  } finally {
    await services.close();
  }
}
