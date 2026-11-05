import { editable } from '@storypane/sdk';
import type { FooterBlock } from '../../types/storypane';
import { linkHref, type SiteReferences } from '../../lib/content';

export function Footer({ block, references }: { block: FooterBlock; references: SiteReferences }) {
  const href = linkHref(block.link, references.paths);
  return (
    <footer {...editable(block)} tabIndex={0} className="site-footer">
      <span className="footer-mark">Ideas welcome.</span>
      <div>
        <p>{block.text}</p>
        {href && (
          <a href={href}>
            Say hello <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      <span className="footer-credit">Fieldwork / Made with Storypane & Astro</span>
    </footer>
  );
}
