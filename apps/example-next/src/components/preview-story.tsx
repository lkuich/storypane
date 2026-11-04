'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useStorypanePreview } from '@storypane/sdk/react';
import { storypaneMigrationVersion, type StorypaneContentType } from '@/types/storypane';
import { referencesFor } from '@/lib/content';
import { StoryContent } from './story-content';

export function PreviewStory({ cmsUrl, spaceId }: { cmsUrl: string; spaceId: string }) {
  const params = useSearchParams();
  const slug = params.get('slug');
  const { story, status, error } = useStorypanePreview<StorypaneContentType>({
    cmsUrl,
    spaceId,
    migrationVersion: storypaneMigrationVersion,
    story: slug ? { slug, locale: params.get('locale') ?? '' } : undefined,
  });

  const message =
    error?.message ??
    (status === 'disabled'
      ? 'Open a story in Storypane and choose Preview.'
      : status === 'connected'
        ? 'Live preview'
        : 'Connecting to Storypane…');
  return (
    <>
      <div className="preview-status" role="status">
        {message}
      </div>
      {story ? (
        <div lang={story.locale || 'en'}>
          <StoryContent
            story={story}
            references={referencesFor(story.references ?? [], story.locale)}
            preview={{ cmsUrl, spaceId }}
          />
        </div>
      ) : (
        <main id="content" className="preview-empty">
          <span className="wordmark">fieldwork®</span>
          <h1>
            A window into
            <br />
            your next idea.
          </h1>
          <p>This preview loads live content from the Storypane editor.</p>
          <Link href="/home">See the published site ↗</Link>
        </main>
      )}
    </>
  );
}
