import { useStorypaneStory } from '@storypane/sdk/react';
import type { StorypaneStory } from '@storypane/sdk';
import { storypaneMigrationVersion,type StorypaneContentType } from '../types/storypane';
import { Block } from './blocks';

export default function Story({ initial,cmsUrl,spaceId }:{ initial:StorypaneStory<StorypaneContentType>; cmsUrl:string; spaceId:string }) {
  const { story,status,error } = useStorypaneStory(initial,{
    cmsUrl,spaceId,migrationVersion:storypaneMigrationVersion,
    mode:{
      query:{ name:(import.meta.env.PUBLIC_STORYPANE_PREVIEW_PARAMETER ?? import.meta.env.PUBLIC_BLOK_PREVIEW_PARAMETER) || 'blok_preview',value:'1' },
      cookie:{ name:'blok_preview',value:'1' },
      env:(import.meta.env.PUBLIC_STORYPANE_PREVIEW ?? import.meta.env.PUBLIC_BLOK_PREVIEW),
    },
  });
  return <>{status !== 'disabled' && <div className="preview-status" role="status">{error?.message || (status === 'connected' ? 'Live preview' : 'Connecting to Storypane…')}</div>}<Block block={story.content} /></>;
}
