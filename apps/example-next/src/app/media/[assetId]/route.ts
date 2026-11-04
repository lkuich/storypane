import { deliveryClient,publishedStories } from '../../../lib/cms';
import { assetIds } from '../../../../../example-astro/src/lib/content';

export const dynamic = 'force-static';
export const dynamicParams = false;
export async function generateStaticParams() {
  return assetIds(await publishedStories()).map(assetId => ({ assetId }));
}
export async function GET(_request:Request,{ params }:{ params:Promise<{ assetId:string }> }) {
  const { assetId } = await params;
  if (!assetIds(await publishedStories()).includes(assetId)) return new Response(null,{ status:404 });
  const response = await deliveryClient().getAsset(assetId);
  return new Response(await response.arrayBuffer(),{ headers:{ 'Content-Type':response.headers.get('Content-Type') ?? 'application/octet-stream' } });
}
