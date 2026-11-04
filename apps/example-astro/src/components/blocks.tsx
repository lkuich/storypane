import type { ComponentType } from 'react';
import { editable } from '@blok/sdk';
import type { BlokComponent,BlokComponentMap,PageBlok,HeroBlok,FeatureGridBlok,FeatureBlok,FooterBlok } from '../types/blok';

function Page({ blok }:{ blok:PageBlok }) {
  return <div {...editable(blok)}>
    <header className="site-header"><a className="wordmark" href="/home" aria-label="Fieldwork home">fieldwork<span>®</span></a><span className="header-note">Independent by nature.<br />Thoughtful by design.</span><a className="header-link" href="#content">Explore the studio <span aria-hidden="true">↘</span></a></header>
    <main id="content">{(blok.body ?? []).map(child => <Block key={child._uid} blok={child} />)}</main>
  </div>;
}
function Hero({ blok }:{ blok:HeroBlok }) {
  return <section {...editable(blok)} tabIndex={0} className="hero">
    <div className="hero-copy"><p className="eyebrow"><span className="live-dot" />{blok.eyebrow}</p><h1>{blok.title || 'Your next idea starts here.'}</h1><p className="hero-description">{blok.description}</p><a className="round-link" href="#ideas">A little of what we do <span aria-hidden="true">↗</span></a></div>
    <div className="hero-art" aria-hidden="true"><span className="art-caption">Good things take shape.</span><div className="shape shape-one" /><div className="shape shape-two" /><div className="shape shape-three" /><span className="art-mark">f/w.</span><span className="art-edition">INDEPENDENT STUDIO — VOL. 01</span></div>
    <div className="hero-baseline"><span>A space for ideas to become something.</span><span>Built with care. Made to last.</span></div>
  </section>;
}
function FeatureGrid({ blok }:{ blok:FeatureGridBlok }) {
  return <section {...editable(blok)} tabIndex={0} className="ideas" id="ideas"><div className="section-title"><p className="eyebrow">01 / Our approach</p><h2>{blok.title}</h2></div><div className="feature-grid">{(blok.items ?? []).map(child => <Block key={child._uid} blok={child} />)}</div></section>;
}
function Feature({ blok }:{ blok:FeatureBlok }) {
  return <article {...editable(blok)} tabIndex={0} className="feature"><span className="feature-tag">{blok.tag || 'Idea'}</span><h3>{blok.title}</h3><p>{blok.text}</p><span className="feature-arrow" aria-hidden="true">↗</span></article>;
}
function Footer({ blok }:{ blok:FooterBlok }) {
  const link = blok.link;
  const href = link && link.type === 'external' && /^https?:\/\//i.test(link.url) ? link.url : link && link.type === 'email' ? `mailto:${link.email}` : undefined;
  return <footer {...editable(blok)} tabIndex={0} className="site-footer"><span className="footer-mark">Ideas welcome.</span><div><p>{blok.text}</p>{href && <a href={href}>Say hello <span aria-hidden="true">↗</span></a>}</div><span className="footer-credit">Fieldwork / Made with Blok & Astro</span></footer>;
}

// Each registry entry must accept exactly the schema generated for that API name.
const components = { page:Page,hero:Hero,feature_grid:FeatureGrid,feature:Feature,footer:Footer } satisfies {
  [K in keyof BlokComponentMap]:ComponentType<{ blok:BlokComponentMap[K] }>;
};
export function Block({ blok }:{ blok:BlokComponent }) {
  const Component = components[blok.component] as ComponentType<{ blok:BlokComponent }> | undefined;
  if (!Component) return <p {...editable(blok)} className="unsupported">No renderer registered for “{blok.component}”.</p>;
  return <Component blok={blok} />;
}
