import type { ComponentType } from 'react';
import { editable } from '@storypane/sdk';
import type { StorypaneComponent,StorypaneComponentMap,PageBlock,HeroBlock,FeatureGridBlock,FeatureBlock,FooterBlock } from '../types/storypane';

function Page({ block }:{ block:PageBlock }) {
  return <div {...editable(block)}>
    <header className="site-header"><a className="wordmark" href="/home" aria-label="Fieldwork home">fieldwork<span>®</span></a><span className="header-note">Independent by nature.<br />Thoughtful by design.</span><a className="header-link" href="#content">Explore the studio <span aria-hidden="true">↘</span></a></header>
    <main id="content">{(block.body ?? []).map(child => <Block key={child._uid} block={child} />)}</main>
  </div>;
}
function Hero({ block }:{ block:HeroBlock }) {
  return <section {...editable(block)} tabIndex={0} className="hero">
    <div className="hero-copy"><p className="eyebrow"><span className="live-dot" />{block.eyebrow}</p><h1>{block.title || 'Your next idea starts here.'}</h1><p className="hero-description">{block.description}</p><a className="round-link" href="#ideas">A little of what we do <span aria-hidden="true">↗</span></a></div>
    <div className="hero-art" aria-hidden="true"><span className="art-caption">Good things take shape.</span><div className="shape shape-one" /><div className="shape shape-two" /><div className="shape shape-three" /><span className="art-mark">f/w.</span><span className="art-edition">INDEPENDENT STUDIO — VOL. 01</span></div>
    <div className="hero-baseline"><span>A space for ideas to become something.</span><span>Built with care. Made to last.</span></div>
  </section>;
}
function FeatureGrid({ block }:{ block:FeatureGridBlock }) {
  return <section {...editable(block)} tabIndex={0} className="ideas" id="ideas"><div className="section-title"><p className="eyebrow">01 / Our approach</p><h2>{block.title}</h2></div><div className="feature-grid">{(block.items ?? []).map(child => <Block key={child._uid} block={child} />)}</div></section>;
}
function Feature({ block }:{ block:FeatureBlock }) {
  return <article {...editable(block)} tabIndex={0} className="feature"><span className="feature-tag">{block.tag || 'Idea'}</span><h3>{block.title}</h3><p>{block.text}</p><span className="feature-arrow" aria-hidden="true">↗</span></article>;
}
function Footer({ block }:{ block:FooterBlock }) {
  const link = block.link;
  const href = link && link.type === 'external' && /^https?:\/\//i.test(link.url) ? link.url : link && link.type === 'email' ? `mailto:${link.email}` : undefined;
  return <footer {...editable(block)} tabIndex={0} className="site-footer"><span className="footer-mark">Ideas welcome.</span><div><p>{block.text}</p>{href && <a href={href}>Say hello <span aria-hidden="true">↗</span></a>}</div><span className="footer-credit">Fieldwork / Made with Storypane & Astro</span></footer>;
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
