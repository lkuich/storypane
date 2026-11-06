'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useStorypanePreview } from '@storypane/sdk/react';
import { storypaneMigrationVersion, type StorypaneComponent } from '@/types/storypane';
import { referencesFor } from '@/lib/content';
import { StoryContent } from './story-content';

export function PreviewStory({ cmsUrl, spaceId }: { cmsUrl: string; spaceId: string }) {
  const params = useSearchParams();
  const slug = params.get('slug');
  const [component, setComponent] = useState<StorypaneComponent>();
  const { story, status, error } = useStorypanePreview<StorypaneComponent>({
    cmsUrl,
    spaceId,
    migrationVersion: storypaneMigrationVersion,
    onComponent: setComponent,
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
      {!component && (
        <div className="preview-status" role="status">
          {message}
        </div>
      )}
      {story ? (
        <div lang={story.locale || 'en'}>
          <StoryContent
            story={component ? { ...story, content: component } : story}
            references={referencesFor(
              story.references ?? [],
              story.locale,
              story.references?.find((reference) => reference.locale !== story.locale)?.locale,
            )}
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
