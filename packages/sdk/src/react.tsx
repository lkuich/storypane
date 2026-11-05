'use client';
import { useEffect, useRef, useState } from 'react';
import { connectPreview, type PreviewOptions, type PreviewStatus } from './preview.js';
import type { StorypaneStory, StoryReference } from './types.js';
export { editable } from './types.js';

/** Preview a story that may never have been published. The editor supplies its short-lived session. */
export function useStorypanePreview<T = StorypaneStory['content']>({
  story: reference,
  cmsUrl,
  spaceId,
  migrationVersion,
  getSession,
}: Omit<PreviewOptions<T>, 'story' | 'mode' | 'onChange' | 'onStatus'> & {
  story?: StoryReference;
}) {
  const id = reference?.id;
  const slug = reference?.slug;
  const locale = reference?.locale;
  const key = JSON.stringify([cmsUrl, spaceId, id, slug, locale, migrationVersion]);
  const [result, setResult] = useState<{
    key: string;
    story?: StorypaneStory<T>;
    status: PreviewStatus;
    error?: Error;
  }>({ key, status: 'disabled' });

  useEffect(() => {
    if ((!id && !slug) || (window.parent === window && !getSession)) {
      setResult({ key, status: 'disabled' });
      return;
    }
    setResult({ key, status: 'waiting' });
    return connectPreview<T>({
      cmsUrl,
      spaceId,
      migrationVersion,
      getSession,
      story: id ? { id, locale } : { slug: slug!, locale },
      mode: { draft: true },
      onChange: (story) => setResult((current) => ({ ...current, key, story })),
      onStatus: (status, error) => setResult((current) => ({ ...current, key, status, error })),
    });
  }, [cmsUrl, spaceId, id, slug, locale, migrationVersion, getSession, key]);

  // Never display the previous story while a new route is authorizing.
  const current =
    result.key === key
      ? result
      : { status: 'disabled' as const, story: undefined, error: undefined };
  return { story: current.story, status: current.status, error: current.error };
}

/** Render with initial build/server content, then replace it with drafts only in preview. */
export function useStorypaneStory<T>(
  initial: StorypaneStory<T>,
  options: Omit<PreviewOptions<T>, 'story' | 'onChange' | 'onStatus'>,
) {
  const [story, setStory] = useState(initial),
    [status, setStatus] = useState<PreviewStatus>('disabled'),
    [error, setError] = useState<Error>();
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const mode = JSON.stringify(options.mode ?? {});
  useEffect(() => {
    setStory(initialRef.current);
  }, [initial.id, initial.locale, initial.revision]);
  useEffect(
    () =>
      connectPreview<T>({
        cmsUrl: options.cmsUrl,
        spaceId: options.spaceId,
        migrationVersion: options.migrationVersion,
        story: { id: initial.id, locale: initial.locale },
        mode: JSON.parse(mode),
        getSession: options.getSession,
        onChange: setStory,
        onStatus: (value, cause) => {
          setStatus(value);
          setError(cause);
        },
      }),
    [
      initial.id,
      initial.locale,
      options.cmsUrl,
      options.spaceId,
      options.migrationVersion,
      options.getSession,
      mode,
    ],
  );
  return { story, status, error };
}
