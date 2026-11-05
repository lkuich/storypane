import { cache } from 'react';
import { notFound } from 'next/navigation';
import { StorypaneError } from '@storypane/sdk';
import { StoryContent } from '@/components/story-content';
import { storypane, getLocales, getPublishedStories } from '@/lib/storypane';
import { referencesFor } from '@/lib/content';
import { referenceForPath, staticStoryParams } from '@/lib/routes';

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
  return { title: story.name };
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
