import { getPublishedStories } from '@/lib/storypane';
import { discoveryMarkdown } from '@/lib/seo';

export const dynamic = 'force-static';
export async function GET() {
  return new Response(
    discoveryMarkdown(await getPublishedStories(), process.env.SITE_URL || 'http://127.0.0.1:3133'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
