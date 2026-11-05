import { useSyncExternalStore } from 'react';
import { useStorypanePreview } from '@storypane/sdk/react';
import { storypaneMigrationVersion, type StorypaneContentType } from '../types/storypane';
import { Content } from './content';
import { referencesFor } from '../lib/content';

function subscribeToLocation(onChange: () => void) {
  const { pushState, replaceState } = window.history;
  // The History API does not emit popstate for pushState or replaceState.
  window.history.pushState = function (...args) {
    pushState.apply(this, args);
    onChange();
  };
  window.history.replaceState = function (...args) {
    replaceState.apply(this, args);
    onChange();
  };
  window.addEventListener('popstate', onChange);
  return () => {
    window.history.pushState = pushState;
    window.history.replaceState = replaceState;
    window.removeEventListener('popstate', onChange);
  };
}

/** A built shell lets the editor preview stories/locales that have never been published. */
export default function PreviewShell({ cmsUrl, spaceId }: { cmsUrl: string; spaceId: string }) {
  const search = useSyncExternalStore(
    subscribeToLocation,
    () => window.location.search,
    () => '',
  );
  const params = new URLSearchParams(search),
    slug = params.get('slug');
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
          <Content
            block={story.content}
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
          <a href="/home">See the published site ↗</a>
        </main>
      )}
    </>
  );
}
