export interface BlokBlock { _uid: string; component: string; [field:string]: unknown }
export interface BlokLocale { id:string; name:string; slug:string }
export interface BlokAsset { assetId:string; alt?:string }
export type BlokLink = { type:'story'; storyId:string } | { type:'external'; url:string } | { type:'email'; email:string } | { type:'asset'; assetId:string };
export interface BlokRichText { type:string; text?:string; attrs?:Record<string,unknown>; content?:BlokRichText[]; marks?:{ type:string; attrs?:Record<string,unknown> }[] }
export interface BlokSchemaField {
  name:string;
  type:'text' | 'number' | 'datetime' | 'boolean' | 'option' | 'options' | 'asset' | 'link' | 'blocks';
  required?:boolean;
  format?:'singleline' | 'textarea' | 'richtext' | 'markdown';
  options?:string[];
  allowedDefinitionIds?:string[];
}
export interface BlokSchema {
  components:{ id:string; name:string; kind:'nestable' | 'content-type' | 'universal'; version:number; fields:BlokSchemaField[] }[];
}
export interface BlokStory<T = BlokBlock> {
  id:string; name:string; slug:string; locale:string; localeId:string;
  revision:number; content:T; publishedAt:string | null;
}
export type StoryReference = { id:string; slug?:never; locale?:string } | { slug:string; id?:never; locale?:string };
export interface PreviewSession { token:string; expiresAt:string; spaceId:string; storyId:string; localeId:string; slug:string; locale:string }
export interface PreviewMode {
  draft?:boolean;
  env?:boolean | string;
  query?:false | { name:string; value?:string };
  cookie?:false | { name:string; value?:string };
}

/** Flags activate preview code; they are not credentials and never authorize drafts. */
export function isPreviewMode(mode: PreviewMode = {}, context?: { url?:string; cookie?:string }): boolean {
  if (mode.draft === true || mode.env === true || mode.env === 'true' || mode.env === '1') return true;
  const url = context?.url ?? (typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
  const cookie = context?.cookie ?? (typeof document !== 'undefined' ? document.cookie : '');
  const queryRule = mode.query === undefined ? { name:'blok_preview', value:'1' } : mode.query;
  if (queryRule) { const value = new URL(url).searchParams.get(queryRule.name); if (value !== null && (queryRule.value === undefined || value === queryRule.value)) return true; }
  if (mode.cookie) {
    for (const pair of cookie.split(';')) {
      const index = pair.indexOf('=');
      if (index < 0) continue;
      try { if (decodeURIComponent(pair.slice(0,index).trim()) === mode.cookie.name && (mode.cookie.value === undefined || decodeURIComponent(pair.slice(index+1).trim()) === mode.cookie.value)) return true; } catch { /* Ignore malformed unrelated cookies. */ }
    }
  }
  return false;
}

export function editable(block: Pick<BlokBlock, '_uid'>, field?:string) {
  return { 'data-blok-id':block._uid, ...(field ? { 'data-blok-field':field } : {}) };
}
