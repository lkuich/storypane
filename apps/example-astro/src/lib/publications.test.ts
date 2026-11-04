import { expect,it } from 'vitest';
import type { StorypaneStory } from '@storypane/sdk';
import type { StorypaneContentType } from '../types/storypane';
import { fetchPublishedStories,pageEntries } from './publications';

const story:StorypaneStory<StorypaneContentType> = { id:'home',name:'Home',slug:'home',locale:'',localeId:'default',revision:1,publishedAt:'2026-11-04T00:00:00Z',content:{ _uid:'root',component:'page',title:'Home',body:[],footer:'shared' } };
it('builds nested/localized routes with the selected footer and rejects ambiguous or reserved paths',() => {
  const footer:StorypaneStory<StorypaneContentType> = { ...story,id:'shared',slug:'footer',content:{ _uid:'footer',component:'footer',text:'Contact us' } };
  const pages = pageEntries([story,footer,{ ...story,locale:'fr',slug:'studio/home' }]);
  expect(pages[2]?.params.path).toBe('fr/studio/home');
  expect(pages[2]?.props.references.footers.shared?.text).toBe('Contact us');
  expect(() => pageEntries([story,story])).toThrow('duplicate');
  for (const slug of ['preview','../secret','bad?query']) expect(() => pageEntries([{ ...story,slug }])).toThrow('Invalid');
});
it('fetches every publication page for every configured locale',async () => {
  const calls:unknown[]=[];
  const client = {
    listLocales:async () => [{ slug:'' },{ slug:'fr' }],
    listStories:async (query:{locale:string;offset:number}) => {
      calls.push(query);
      return { stories:[{ ...story,locale:query.locale }],nextOffset:query.offset === 0 ? 100 : null };
    },
  } as unknown as Parameters<typeof fetchPublishedStories>[0];
  expect(await fetchPublishedStories(client)).toHaveLength(4);
  expect(calls).toEqual([{ locale:'',offset:0,limit:100 },{ locale:'',offset:100,limit:100 },{ locale:'fr',offset:0,limit:100 },{ locale:'fr',offset:100,limit:100 }]);
});
