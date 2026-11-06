import { env, openCache } from '#platform';
import { handlePublicMedia } from '@storypane/assets';
import { createServices } from '../../../../../lib/context';

export const dynamic = 'force-dynamic';

async function handle(
  request: Request,
  route: { params: Promise<{ spaceId: string; assetId: string; kind: string }> },
) {
  const services = createServices();
  try {
    const params = await route.params;
    await services.selectSpace(params.spaceId);
    return await handlePublicMedia(request, params, {
      db: services.db,
      bucket: env.MEDIA,
      images: env.IMAGES,
      cache: await openCache('storypane-public-media-v1'),
    });
  } finally {
    await services.close();
  }
}

export { handle as GET, handle as HEAD };
