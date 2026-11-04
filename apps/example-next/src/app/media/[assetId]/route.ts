import { storypane, getPublishedStories } from '@/lib/storypane';
import { assetIds } from '@/lib/content';

export const dynamic = 'force-static';
export const dynamicParams = false;
export async function generateStaticParams() {
  return assetIds(await getPublishedStories()).map((assetId) => ({ assetId }));
}
export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!assetIds(await getPublishedStories()).includes(assetId)) {
    return new Response(null, { status: 404 });
  }
  const response = await storypane.getAsset(assetId);
  return new Response(await response.arrayBuffer(), {
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream' },
  });
}
