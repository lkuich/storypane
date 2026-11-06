import { getPublishedStories } from '@/lib/storypane';
import { pageMarkdown, pageMetadata } from '@/lib/seo';

export const dynamic = 'force-static';
export const dynamicParams = false;
const siteUrl = process.env.SITE_URL || 'http://127.0.0.1:3133';

export async function generateStaticParams() {
  return (await getPublishedStories())
    .filter((story) => pageMetadata(story, siteUrl).markdownEnabled)
    .map((story) => ({
      path: [...(story.locale ? [story.locale] : []), ...`${story.slug}.md`.split('/')],
    }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const story = (await getPublishedStories()).find(
    (story) =>
      pageMetadata(story, siteUrl).markdownPath ===
      `/llms/${path.map(encodeURIComponent).join('/')}`,
  );
  if (!story || !pageMetadata(story, siteUrl).markdownEnabled) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(pageMarkdown(story, siteUrl), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      Link: `<${pageMetadata(story, siteUrl).canonical}>; rel="canonical"`,
    },
  });
}
