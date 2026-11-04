import { existsSync,writeFileSync } from 'node:fs';
import type { BlockDefinition,Command,DefinitionInput,Json,Lease,LocaleSnapshot,Story,StoryLocale,SpaceLocale } from '@blok/core';

const envPath = 'apps/example-astro/.env';
if (existsSync(envPath)) {
  console.log('Keeping the existing Astro configuration and content. Schema generation will use its configured space.');
} else {
  const url = process.env.BLOK_URL || 'http://127.0.0.1:3130';
  if (!['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('Example seeding is restricted to the local CMS. Configure .env manually for a deployed space.');
  let cookies = '', spaceId = '';
  async function request<T>(path:string,method = 'GET',body?:unknown):Promise<T> {
    const response = await fetch(new URL(path,url),{ method,headers:{ Origin:new URL(url).origin,Cookie:cookies,'Content-Type':'application/json',...(spaceId ? { 'x-blok-space-id':spaceId } : {}) },body:body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json() as T & { error?:{ message?:string }; message?:string };
    if (!response.ok) throw new Error(`${method} ${path}: ${result.error?.message || result.message || response.status}`);
    const sessionCookies = response.headers.getSetCookie();
    if (sessionCookies.length) cookies = sessionCookies.map(value => value.split(';')[0]).join('; ');
    return result;
  }
  await request('/api/auth/sign-in/email','POST',{ email:'admin@blok.local',password:process.env.BLOK_ADMIN_PASSWORD || 'blok-local-admin' });
  const space = await request<{ id:string }>('/api/spaces','POST',{ name:'Fieldwork · Astro example',description:'A static Astro site with generated block types and live visual preview.' });
  spaceId = space.id;
  const definitions = new Map<string,BlockDefinition>();
  const text = (name:string,label:string,defaultValue:string,required = false):DefinitionInput['fields'][number] => ({ name,label,type:'text',format:name === 'text' || name === 'description' ? 'textarea' : 'singleline',defaultValue,required });
  const schemas:DefinitionInput[] = [
    { name:'feature',displayName:'Feature',kind:'nestable',fields:[text('title','Title','Start with a good question.',true),text('text','Description','We make room for curiosity. The best ideas begin with a fresh way of looking at things.'),{ name:'tag',label:'Category',type:'option',source:{ type:'inline',items:['Discover','Create','Grow'].map(value => ({ value,label:value })) },defaultValue:'Discover' }] },
    { name:'hero',displayName:'Hero',kind:'nestable',fields:[text('eyebrow','Eyebrow','A small studio for big ideas'),text('title','Title','Make room for what’s next.',true),text('description','Description','We bring curious minds and thoughtful design together. Turning the beginnings of an idea into something that matters.')] },
    { name:'footer',displayName:'Footer',kind:'nestable',fields:[text('text','Footer text','Have something in mind? We’d love to hear where you want to go.'),{ name:'link',label:'Link',type:'link',defaultValue:{ type:'email',email:'hello@example.com' } }] },
    { name:'feature_grid',displayName:'Feature grid',kind:'nestable',fields:[text('title','Title','A fresh perspective.\nA considered approach.',true),{ name:'items',label:'Features',type:'blocks' }] },
    { name:'page',displayName:'Page',kind:'content-type',fields:[text('title','Page title','Home',true),{ name:'body',label:'Body',type:'blocks' }] },
  ];
  for (const schema of schemas) {
    for (const field of schema.fields) if (field.type === 'blocks') field.allowedDefinitionIds = (schema.name === 'feature_grid' ? ['feature'] : ['hero','feature_grid','footer']).map(name => definitions.get(name)!.id);
    definitions.set(schema.name,await request<BlockDefinition>('/api/cms/definitions','POST',schema));
  }
  async function createPage(name:string,slug:string) {
    const story = await request<Story>('/api/cms/stories','POST',{ name,slug,definitionId:definitions.get('page')!.id });
    const [locale] = await request<StoryLocale[]>(`/api/cms/stories/${story.id}/locales`);
    const base = `/api/cms/stories/${story.id}/locales/${locale.id}`;
    let snapshot = await request<LocaleSnapshot>(base);
    async function command(type:Command['type'],payload:unknown,blockId?:string) {
      const block = snapshot.blocks.find(block => block.id === blockId);
      const lease = block ? await request<Lease>(`${base}/leases`,'POST',{ blockId }) : undefined;
      try {
        const result = await request<{ snapshot:LocaleSnapshot }>(`${base}/commands`,'POST',{ type,payload,mutationId:crypto.randomUUID(),expectedRevisions:block ? { [block.id]:block.revision } : {},leaseTokens:lease ? { [blockId!]:lease.token } : {} });
        snapshot = result.snapshot;
      } finally { if (lease) await request(`${base}/leases`,'DELETE',{ blockId,token:lease.token }); }
    }
    async function insert(parentId:string,parentField:string,component:string,fields?:Record<string,Json>) {
      const existing = new Set(snapshot.blocks.map(block => block.id));
      await command('insertBlock',{ parentId,parentField,definitionId:definitions.get(component)!.id },parentId);
      const child = snapshot.blocks.find(block => !existing.has(block.id))!;
      if (fields) await command('saveBlock',{ blockId:child.id,fields:{ ...child.fields,...fields } },child.id);
      return child.id;
    }
    await insert(locale.rootBlockId,'body','hero');
    const grid = await insert(locale.rootBlockId,'body','feature_grid');
    await insert(grid,'items','feature');
    await insert(grid,'items','feature',{ title:'Give the idea a shape.',text:'Clear thinking meets a hands-on approach. We build, explore, and refine until everything feels right.',tag:'Create' });
    await insert(grid,'items','feature',{ title:'Leave room to grow.',text:'Good work isn’t a finish line. We create things with the flexibility to evolve alongside you.',tag:'Grow' });
    await insert(locale.rootBlockId,'body','footer');
    return { story,snapshot,publish:() => command('publishCheckpoint',{ checkpointId:snapshot.checkpointId }) };
  }
  const home = await createPage('Home','home');
  await home.publish();
  const configuredFrench = await request<SpaceLocale>('/api/cms/locales','POST',{ slug:'fr',name:'Français' });
  const french = await request<StoryLocale>(`/api/cms/stories/${home.story.id}/locales`,'POST',{ spaceLocaleId:configuredFrench.id,urlSlug:'home' });
  const base = `/api/cms/stories/${home.story.id}/locales/${french.id}`;
  const target = await request<LocaleSnapshot>(base);
  const root = target.blocks.find(block => block.id === french.rootBlockId)!;
  const lease = await request<Lease>(`${base}/leases`,'POST',{ blockId:root.id });
  const imported = await request<{ snapshot:LocaleSnapshot }>(`${base}/commands`,'POST',{
    type:'importBlocks',mutationId:crypto.randomUUID(),expectedRevisions:{ [root.id]:root.revision },leaseTokens:{ [root.id]:lease.token },
    payload:{ sourceLocaleId:home.snapshot.locale.id,blockIds:home.snapshot.blocks.filter(block => block.parentId === home.snapshot.locale.rootBlockId).map(block => block.id),parentId:root.id,parentField:'body' },
  });
  await request(`${base}/leases`,'DELETE',{ blockId:root.id,token:lease.token });
  const hero = imported.snapshot.blocks.find(block => block.definitionId === definitions.get('hero')!.id)!;
  const heroLease = await request<Lease>(`${base}/leases`,'POST',{ blockId:hero.id });
  const translated = await request<{ snapshot:LocaleSnapshot }>(`${base}/commands`,'POST',{ type:'saveBlock',mutationId:crypto.randomUUID(),expectedRevisions:{ [hero.id]:hero.revision },leaseTokens:{ [hero.id]:heroLease.token },payload:{ blockId:hero.id,fields:{ ...hero.fields,eyebrow:'Un petit studio pour de grandes idées',title:'Faites place à la suite.',description:'Des esprits curieux et un design réfléchi. Nous donnons forme aux idées qui comptent.' } } });
  await request(`${base}/leases`,'DELETE',{ blockId:hero.id,token:heroLease.token });
  await request(`${base}/commands`,'POST',{ type:'publishCheckpoint',mutationId:crypto.randomUUID(),expectedRevisions:{},leaseTokens:{},payload:{ checkpointId:translated.snapshot.checkpointId } });
  await createPage('Work in progress','work-in-progress');
  await request('/api/cms/delivery-settings','PUT',{ previewUrl:'http://127.0.0.1:3132/preview?slug={slug}&locale={locale}',previewParameter:'blok_preview' });
  const published = await request<{ token:string }>('/api/cms/delivery-tokens','POST',{ name:'Astro build',scope:'published' });
  const schema = await request<{ token:string }>('/api/cms/delivery-tokens','POST',{ name:'Astro schema tooling',scope:'preview' });
  writeFileSync(envPath,`BLOK_URL=${url}\nBLOK_SPACE_ID=${spaceId}\nBLOK_DELIVERY_TOKEN=${published.token}\nBLOK_PREVIEW_TOKEN=${schema.token}\nPUBLIC_BLOK_PREVIEW_PARAMETER=blok_preview\nPUBLIC_BLOK_PREVIEW=false\n`,{ mode:0o600,flag:'wx' });
  console.log(`Created Fieldwork example space. Open ${url}/?space=${spaceId}\nCredentials saved privately to ${envPath}. Run pnpm dev:example.`);
}
