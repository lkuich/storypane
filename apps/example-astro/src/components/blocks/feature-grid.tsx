import { editable } from '@storypane/sdk';
import type { FeatureGridBlock } from '../../types/storypane';
import { Block, type RenderOptions } from './block';

export function FeatureGrid({ block, ...options }: RenderOptions & { block: FeatureGridBlock }) {
  return (
    <section {...editable(block)} tabIndex={0} className="ideas" id="ideas">
      <div className="section-title">
        <p className="eyebrow">01 / Our approach</p>
        <h2>{block.title}</h2>
      </div>
      <div className="feature-grid">
        {(block.items ?? []).map((child) => (
          <Block key={child._uid} block={child} {...options} />
        ))}
      </div>
    </section>
  );
}
