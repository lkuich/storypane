import { useEffect,useState } from 'react';
import { connectPreview } from '@storypane/sdk/preview';
import type { StorypaneStory } from '@storypane/sdk';
import type { StorypaneContentType } from '../types/storypane';
import { Block } from './blocks';

/** A built shell lets the editor preview stories/locales that have never been published. */
export default function PreviewShell({ cmsUrl,spaceId }:{ cmsUrl:string; spaceId:string }) {
  const [story,setStory] = useState<StorypaneStory<StorypaneContentType>>();
  const [message,setMessage] = useState('Open a story in Storypane and choose Preview.');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), slug = params.get('slug');
    if (!slug) { setMessage('Choose a story in Storypane to load its preview.'); return; }
    if (window.parent === window) return;
    return connectPreview<StorypaneContentType>({ cmsUrl,spaceId,story:{ slug,locale:params.get('locale') ?? '' },mode:{ draft:true },onChange:setStory,onStatus:(status,error) => setMessage(error?.message || (status === 'connected' ? 'Live preview' : 'Connecting to Storypane…')) });
  },[cmsUrl,spaceId]);
  return <><div className="preview-status" role="status">{message}</div>{story ? <Block block={story.content} /> : <main id="content" className="preview-empty"><span className="wordmark">fieldwork®</span><h1>A window into<br />your next idea.</h1><p>This preview loads live content from the Storypane editor.</p><a href="/home">See the published site ↗</a></main>}</>;
}
