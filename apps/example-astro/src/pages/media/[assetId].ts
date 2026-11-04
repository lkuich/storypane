import type { APIRoute } from 'astro';
import { deliveryClient, publishedStories } from '../../lib/cms';
import { assetIds } from '../../lib/content';

export async function getStaticPaths() {
  return assetIds(await publishedStories()).map((assetId) => ({ params: { assetId } }));
}

// Export publication assets with the site so visitors never need CMS credentials.
export const GET: APIRoute = async ({ params }) => {
  const response = await deliveryClient().getAsset(params.assetId!);
  return new Response(await response.arrayBuffer(), {
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream' },
  });
};
