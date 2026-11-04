import { Suspense } from 'react';
import { PreviewStory } from '@/components/preview-story';
import { cmsUrl, spaceId } from '@/lib/storypane';

export const dynamic = 'force-static';
export const metadata = { title: 'Preview', robots: { index: false, follow: false } };

export default function Preview() {
  return (
    <Suspense fallback={<p role="status">Opening preview…</p>}>
      <PreviewStory cmsUrl={cmsUrl} spaceId={spaceId} />
    </Suspense>
  );
}
