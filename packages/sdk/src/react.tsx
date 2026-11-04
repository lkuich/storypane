'use client';
import { useEffect, useState } from 'react';
import { connectPreview, type PreviewOptions, type PreviewStatus } from './preview.js';
import type { StorypaneStory } from './types.js';
export { editable } from './types.js';
export { useStorypaneStory as useBlokStory };

/** Render with initial build/server content, then replace it with drafts only in preview. */
export function useStorypaneStory<T>(initial:StorypaneStory<T>, options:Omit<PreviewOptions<T>, 'story' | 'onChange' | 'onStatus'>) {
  const [story,setStory] = useState(initial), [status,setStatus] = useState<PreviewStatus>('disabled'), [error,setError] = useState<Error>();
  const mode = JSON.stringify(options.mode ?? {});
  useEffect(() => { setStory(initial); },[initial.id,initial.locale,initial.revision]);
  useEffect(() => connectPreview<T>({ cmsUrl:options.cmsUrl, spaceId:options.spaceId, migrationVersion:options.migrationVersion, story:{ id:initial.id, locale:initial.locale }, mode:JSON.parse(mode), getSession:options.getSession, onChange:setStory, onStatus:(value,cause) => { setStatus(value); setError(cause); } }),[initial.id,initial.locale,options.cmsUrl,options.spaceId,options.migrationVersion,options.getSession,mode]);
  return { story, status, error };
}
