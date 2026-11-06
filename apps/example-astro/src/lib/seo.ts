import type { StorypaneRichText, StorypaneStory } from '@storypane/sdk';
import type { StorypaneComponent, StorypaneContentType } from '../types/storypane';
import { assetPath } from './content';

function absoluteUrl(value: string | null | undefined, fallback: string): string {
  try {
    const url = new URL(value || fallback);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      url.hash = '';
      return url.href;
    }
  } catch {
    /* Incomplete metadata falls back to the page URL. */
  }
  return fallback;
}

export function pageMetadata(story: StorypaneStory<StorypaneContentType>, siteUrl: string) {
  const page = story.content.component === 'page' ? story.content : undefined;
  const seo = page?.seo?.[0];
  const path = [story.locale, story.slug]
    .filter(Boolean)
    .join('/')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const canonical = absoluteUrl(seo?.canonical_url, new URL(`/${path}`, siteUrl).href);
  const image = seo?.og_image;
  const index = seo?.robots_index !== 'noindex';
  const follow = seo?.robots_follow !== 'nofollow';
  return {
    title: seo?.title?.trim() || page?.title || story.name,
    description: seo?.description?.trim() || 'Fieldwork — a small studio for big ideas.',
    canonical,
    index,
    follow,
    robots: `${index ? 'index' : 'noindex'}, ${follow ? 'follow' : 'nofollow'}`,
    image: image
      ? { url: new URL(assetPath(image.assetId), siteUrl).href, alt: image.alt || '' }
      : undefined,
    markdownEnabled: !!story.publishedAt && index && seo?.markdown_enabled === true,
    markdownPath: `/llms/${path}.md`,
  };
}

export const markdownText = (text: string) => text.replace(/[\\`*_{}[\]<>#!|]/g, '\\$&');

function richText(value: StorypaneRichText | string | null | undefined): string {
  if (typeof value === 'string') return markdownText(value);
  if (!value) return '';
  if (value.type === 'text') return markdownText(value.text || '');
  if (value.type === 'hardBreak') return '\n';
  const inline = ['paragraph', 'heading'].includes(value.type);
  const text = (value.content || []).map(richText).join(inline ? '' : '\n\n');
  if (value.type === 'heading')
    return `${'#'.repeat(Math.min(6, Math.max(2, Number(value.attrs?.level) || 2)))} ${text}`;
  if (value.type === 'listItem') return `- ${text}`;
  return text;
}

// Mirror the site's visible body fields explicitly; never dump arbitrary CMS fields.
function blockMarkdown(block: StorypaneComponent): string {
  switch (block.component) {
    case 'page':
      return (block.body || []).map(blockMarkdown).filter(Boolean).join('\n\n');
    case 'hero':
      return [`## ${markdownText(block.title || '')}`, markdownText(block.description || '')]
        .filter(Boolean)
        .join('\n\n');
    case 'feature':
      return [`### ${markdownText(block.title || '')}`, richText(block.text)]
        .filter(Boolean)
        .join('\n\n');
    case 'feature_grid':
      return [`## ${markdownText(block.title || '')}`, ...(block.items || []).map(blockMarkdown)]
        .filter(Boolean)
        .join('\n\n');
    case 'footer':
      return markdownText(block.text || '');
    default:
      return '';
  }
}

export function pageMarkdown(story: StorypaneStory<StorypaneContentType>, siteUrl: string): string {
  const metadata = pageMetadata(story, siteUrl);
  if (!metadata.markdownEnabled) throw new Error('Markdown is disabled for this page');
  return (
    [
      `# ${markdownText(metadata.title)}`,
      markdownText(metadata.description),
      `Canonical: <${metadata.canonical.replaceAll('>', '%3E').replaceAll('<', '%3C')}>`,
      blockMarkdown(story.content),
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}

export function discoveryMarkdown(
  stories: StorypaneStory<StorypaneContentType>[],
  siteUrl: string,
): string {
  return (
    '# Fieldwork\n\n' +
    stories
      .map((story) => pageMetadata(story, siteUrl))
      .filter((page) => page.markdownEnabled)
      .map(
        (page) =>
          `- [${markdownText(page.title.replace(/\s+/g, ' '))}](<${new URL(page.markdownPath, siteUrl).href}>): ${markdownText(page.description.replace(/\s+/g, ' '))}`,
      )
      .join('\n') +
    '\n'
  );
}
