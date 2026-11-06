import type { APIRoute } from 'astro';
import { publishedPages } from '../../lib/cms';
import { pageMarkdown, pageMetadata } from '../../lib/seo';

export async function getStaticPaths() {
  return (await publishedPages())
    .filter(({ props }) => pageMetadata(props.story, 'https://example.test').markdownEnabled)
    .map((entry) => ({ ...entry, params: { path: `${entry.params.path}.md` } }));
}

export const GET: APIRoute = ({ props, url }) =>
  new Response(pageMarkdown(props.story, import.meta.env.SITE_URL || url.origin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      Link: `<${pageMetadata(props.story, import.meta.env.SITE_URL || url.origin).canonical}>; rel="canonical"`,
    },
  });
