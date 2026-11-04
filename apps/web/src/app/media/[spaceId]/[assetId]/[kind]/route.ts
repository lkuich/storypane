import { env } from 'cloudflare:workers';
import { handlePublicMedia } from '@storypane/assets';
import { createServices } from '../../../../../lib/context';

export const dynamic = 'force-dynamic';

async function handle(
  request: Request,
  route: { params: Promise<{ spaceId: string; assetId: string; kind: string }> },
) {
  const services = createServices();
  try {
    return await handlePublicMedia(request, await route.params, {
      db: services.db,
      bucket: env.MEDIA,
      images: env.IMAGES,
      cache: await caches.open('storypane-public-media-v1'),
    });
  } finally {
    await services.db.end();
  }
}

export { handle as GET, handle as HEAD };
