import { useBlokStory } from '@blok/sdk/react';
import type { BlokStory } from '@blok/sdk';
import type { BlokContentType } from '../types/blok';
import { Block } from './blocks';

export default function Story({ initial,cmsUrl,spaceId }:{ initial:BlokStory<BlokContentType>; cmsUrl:string; spaceId:string }) {
  const { story,status,error } = useBlokStory(initial,{
    cmsUrl,spaceId,
    mode:{
      query:{ name:import.meta.env.PUBLIC_BLOK_PREVIEW_PARAMETER || 'blok_preview',value:'1' },
      cookie:{ name:'blok_preview',value:'1' },
      env:import.meta.env.PUBLIC_BLOK_PREVIEW,
    },
  });
  return <>{status !== 'disabled' && <div className="preview-status" role="status">{error?.message || (status === 'connected' ? 'Live preview' : 'Connecting to Blok…')}</div>}<Block blok={story.content} /></>;
}
