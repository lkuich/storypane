import type { APIRoute } from 'astro';
import { publishedStories } from '../lib/cms';
import { discoveryMarkdown } from '../lib/seo';

export const GET: APIRoute = async ({ url }) =>
  new Response(
    discoveryMarkdown(await publishedStories(), import.meta.env.SITE_URL || url.origin),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
