import { cache } from 'react';
import { notFound } from 'next/navigation';
import { StorypaneError } from '@storypane/sdk';
import { StoryContent } from '@/components/story-content';
import { storypane, getLocales, getPublishedStories } from '@/lib/storypane';
import { referencesFor } from '@/lib/content';
import { referenceForPath, staticStoryParams } from '@/lib/routes';
import { pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ path: string[] }> };

export const dynamicParams = false;
export const dynamic = 'force-static';

export async function generateStaticParams() {
  const [stories, locales] = await Promise.all([getPublishedStories(), getLocales()]);
  return staticStoryParams(stories, locales);
}

const getPage = cache(async (path: string) => {
  const reference = referenceForPath(path.split('/'), await getLocales());
  try {
    return await storypane.getStory(reference);
  } catch (error) {
    if (error instanceof StorypaneError && error.status === 404) {
      notFound();
    }
    throw error;
  }
});

export async function generateMetadata({ params }: Props) {
  const story = await getPage((await params).path.join('/'));
  const seo = pageMetadata(story, process.env.SITE_URL || 'http://127.0.0.1:3133');
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: seo.canonical,
      ...(seo.markdownEnabled ? { types: { 'text/markdown': seo.markdownPath } } : {}),
    },
    robots: { index: seo.index, follow: seo.follow },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: seo.canonical,
      type: 'website' as const,
      images: seo.image ? [seo.image] : [],
    },
    twitter: {
      card: seo.image ? ('summary_large_image' as const) : ('summary' as const),
      title: seo.title,
      description: seo.description,
      images: seo.image ? [seo.image] : [],
    },
  };
}

export default async function Page({ params }: Props) {
  const { path } = await params;
  const [story, stories, locales] = await Promise.all([
    getPage(path.join('/')),
    getPublishedStories(),
    getLocales(),
  ]);
  return (
    <div lang={story.locale || 'en'}>
      <StoryContent
        story={story}
        references={referencesFor(
          stories,
          story.locale,
          locales.find((locale) => locale.isDefault)?.slug,
        )}
      />
    </div>
  );
}
