import Link from 'next/link';
import { editable } from '@storypane/sdk';
import type { PageBlock } from '@/types/storypane';
import type { RenderOptions } from './block';
import { Footer } from './footer';
import { PageBody } from './page-body';

export function Page({ block, references, preview }: RenderOptions & { block: PageBlock }) {
  const body = block.body ?? [];
  const footer = block.footer ? references.footers[block.footer] : undefined;
  const footerAlreadyInBody = body.some((child) => child._uid === footer?._uid);

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
      <main id="content">
        <PageBody blocks={body} references={references} preview={preview} />
      </main>
      {footer && !footerAlreadyInBody && <Footer block={footer} references={references} />}
    </div>
  );
}
