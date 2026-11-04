import { createContext,useContext,useState,type ComponentType,type ReactNode } from 'react';
import { editable } from '@storypane/sdk';
import type { StorypaneComponent,StorypaneComponentMap,StorypaneContentType,PageBlock,HeroBlock,FeatureGridBlock,FeatureBlock,FooterBlock } from '../types/storypane';
import { assetPath,linkHref,type SiteReferences } from '../lib/content';
import { RichText } from './RichText';

type ContentContext = { references:SiteReferences; cmsUrl:string; spaceId:string; preview?:boolean; framework?:'Astro'|'Next.js' };
const contentContext=createContext<ContentContext>({references:{paths:{},footers:{}},cmsUrl:'',spaceId:''});
export function Content({block,...context}:ContentContext & {block:StorypaneContentType}) {
  return <contentContext.Provider value={context}>{block.component==='footer'?<main id="content"><Block block={block} /></main>:<Block block={block} />}</contentContext.Provider>;
}

function Page({ block }:{ block:PageBlock }) {
  const {references}=useContext(contentContext),body=block.body ?? [],sections:ReactNode[]=[];
  const footer=block.footer?references.footers[block.footer]:undefined;
  let hasIdeas=false;
  for(let index=0;index<body.length;index++) {
    const child=body[index]!;
    if(child.component!=='feature'){sections.push(<Block key={child._uid} block={child} />);continue;}
    const features:FeatureBlock[]=[child];
    while(body[index+1]?.component==='feature')features.push(body[++index] as FeatureBlock);
    sections.push(<section key={child._uid} className="ideas" id={hasIdeas?undefined:'ideas'} aria-label="Our approach"><div className="feature-grid">{features.map(feature=><Block key={feature._uid} block={feature} />)}</div></section>);
    hasIdeas=true;
  }
  return <div {...editable(block)}>
    <header className="site-header"><a className="wordmark" href="/home" aria-label="Fieldwork home">fieldwork<span>®</span></a><span className="header-note">Independent by nature.<br />Thoughtful by design.</span><a className="header-link" href="#content">Explore the studio <span aria-hidden="true">↘</span></a></header>
    <main id="content">{sections}</main>
    {footer && !body.some(child=>child._uid===footer._uid) && <Footer block={footer} />}
  </div>;
}
function Hero({ block }:{ block:HeroBlock }) {
  const {cmsUrl,spaceId,preview}=useContext(contentContext);
  const [failedImage,setFailedImage]=useState('');
  const asset=block.hero_image;
  const image=asset ? (preview?`${cmsUrl}/api/cms/assets/${encodeURIComponent(asset.assetId)}/content?space=${encodeURIComponent(spaceId)}`:assetPath(asset.assetId)) : '';
  const showImage=!!image && failedImage!==image;
  return <section {...editable(block)} tabIndex={0} className="hero">
    <div className="hero-copy"><p className="eyebrow"><span className="live-dot" />{block.eyebrow}</p><h1>{block.title || 'Your next idea starts here.'}</h1><p className="hero-description">{block.description}</p><a className="round-link" href="#ideas">A little of what we do <span aria-hidden="true">↗</span></a></div>
    {showImage ? <div {...editable(block,'hero_image')} className="hero-art hero-art--image"><img className="hero-image" src={image} alt={asset?asset.alt ?? '':''} fetchPriority="high" onError={()=>setFailedImage(image)} /></div> : <div className="hero-art" aria-hidden="true"><span className="art-caption">Good things take shape.</span><div className="shape shape-one" /><div className="shape shape-two" /><div className="shape shape-three" /><span className="art-mark">f/w.</span><span className="art-edition">INDEPENDENT STUDIO — VOL. 01</span></div>}
    <div className="hero-baseline"><span>A space for ideas to become something.</span><span>Built with care. Made to last.</span></div>
  </section>;
}
function FeatureGrid({ block }:{ block:FeatureGridBlock }) {
  return <section {...editable(block)} tabIndex={0} className="ideas" id="ideas"><div className="section-title"><p className="eyebrow">01 / Our approach</p><h2>{block.title}</h2></div><div className="feature-grid">{(block.items ?? []).map(child => <Block key={child._uid} block={child} />)}</div></section>;
}
function Feature({ block }:{ block:FeatureBlock }) {
  const {references}=useContext(contentContext),href=linkHref(block.page,references.paths);
  return <article {...editable(block)} tabIndex={0} className="feature"><span className="feature-tag">{block.tag || 'Idea'}</span><h3>{href?<a className="feature-link" href={href}>{block.title}</a>:block.title}</h3><div className="feature-description"><RichText value={block.text} /></div><span className="feature-arrow" aria-hidden="true">↗</span></article>;
}
function Footer({ block }:{ block:FooterBlock }) {
  const {references,framework='Astro'}=useContext(contentContext),href=linkHref(block.link,references.paths);
  return <footer {...editable(block)} tabIndex={0} className="site-footer"><span className="footer-mark">Ideas welcome.</span><div><p>{block.text}</p>{href && <a href={href}>Say hello <span aria-hidden="true">↗</span></a>}</div><span className="footer-credit">Fieldwork / Made with Storypane & {framework}</span></footer>;
}

// Each registry entry must accept exactly the schema generated for that API name.
const components = { page:Page,hero:Hero,feature_grid:FeatureGrid,feature:Feature,footer:Footer } satisfies {
  [K in keyof StorypaneComponentMap]:ComponentType<{ block:StorypaneComponentMap[K] }>;
};
export function Block({ block }:{ block:StorypaneComponent }) {
  const Component = components[block.component] as ComponentType<{ block:StorypaneComponent }> | undefined;
  if (!Component) return <p {...editable(block)} className="unsupported">No renderer registered for “{block.component}”.</p>;
  return <Component block={block} />;
}
