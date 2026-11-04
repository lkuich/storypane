import { useEffect,useState } from 'react';
import { connectPreview } from '@blok/sdk/preview';
import type { BlokStory } from '@blok/sdk';
import type { BlokContentType } from '../types/blok';
import { Block } from './blocks';

/** A built shell lets the editor preview stories/locales that have never been published. */
export default function PreviewShell({ cmsUrl,spaceId }:{ cmsUrl:string; spaceId:string }) {
  const [story,setStory] = useState<BlokStory<BlokContentType>>();
  const [message,setMessage] = useState('Open a story in Blok and choose Preview.');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), slug = params.get('slug');
    if (!slug) { setMessage('Choose a story in Blok to load its preview.'); return; }
    if (window.parent === window) return;
    return connectPreview<BlokContentType>({ cmsUrl,spaceId,story:{ slug,locale:params.get('locale') ?? '' },mode:{ draft:true },onChange:setStory,onStatus:(status,error) => setMessage(error?.message || (status === 'connected' ? 'Live preview' : 'Connecting to Blok…')) });
  },[cmsUrl,spaceId]);
  return <><div className="preview-status" role="status">{message}</div>{story ? <Block blok={story.content} /> : <main id="content" className="preview-empty"><span className="wordmark">fieldwork®</span><h1>A window into<br />your next idea.</h1><p>This preview loads live content from the Blok editor.</p><a href="/home">See the published site ↗</a></main>}</>;
}
