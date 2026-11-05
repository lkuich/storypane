import { editable } from '@storypane/sdk';
import { RichText } from '@storypane/sdk/rich-text';
import type { FeatureBlock } from '../../types/storypane';
import { linkHref, type SiteReferences } from '../../lib/content';

export function Feature({
  block,
  references,
}: {
  block: FeatureBlock;
  references: SiteReferences;
}) {
  const href = linkHref(block.page, references.paths);
  return (
    <article {...editable(block)} tabIndex={0} className="feature">
      <span className="feature-tag">{block.tag || 'Idea'}</span>
      <h3>
        {href ? (
          <a className="feature-link" href={href}>
            {block.title}
          </a>
        ) : (
          block.title
        )}
      </h3>
      <div className="feature-description">
        <RichText value={block.text} />
      </div>
      <span className="feature-arrow" aria-hidden="true">
        ↗
      </span>
    </article>
  );
}
