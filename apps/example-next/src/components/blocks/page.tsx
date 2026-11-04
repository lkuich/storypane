import type { ReactNode } from 'react';
import Link from 'next/link';
import { editable } from '@storypane/sdk';
import type { PageBlock, FeatureBlock } from '@/types/storypane';
import { Block, type RenderOptions } from './block';
import { Footer } from './footer';

export function Page({ block, ...options }: RenderOptions & { block: PageBlock }) {
  const { references } = options,
    body = block.body ?? [],
    sections: ReactNode[] = [];
  const footer = block.footer ? references.footers[block.footer] : undefined;
  let hasIdeas = false;
  for (let index = 0; index < body.length; index++) {
    const child = body[index]!;
    if (child.component !== 'feature') {
      sections.push(<Block key={child._uid} block={child} {...options} />);
      continue;
    }
    const features: FeatureBlock[] = [child];
    while (body[index + 1]?.component === 'feature') {
      features.push(body[++index] as FeatureBlock);
    }
    sections.push(
      <section
        key={child._uid}
        className="ideas"
        id={hasIdeas ? undefined : 'ideas'}
        aria-label="Our approach"
      >
        <div className="feature-grid">
          {features.map((feature) => (
            <Block key={feature._uid} block={feature} {...options} />
          ))}
        </div>
      </section>,
    );
    hasIdeas = true;
  }
  return (
    <div {...editable(block)}>
      <header className="site-header">
        <Link className="wordmark" href="/home" aria-label="Fieldwork home">
          fieldwork<span>®</span>
        </Link>
        <span className="header-note">
          Independent by nature.
          <br />
          Thoughtful by design.
        </span>
        <a className="header-link" href="#content">
          Explore the studio <span aria-hidden="true">↘</span>
        </a>
      </header>
      <main id="content">{sections}</main>
      {footer && !body.some((child) => child._uid === footer._uid) && (
        <Footer block={footer} references={references} />
      )}
    </div>
  );
}
