import { editable } from '@storypane/sdk';
import type { StorypaneComponent } from '@/types/storypane';
import type { SiteReferences } from '@/lib/content';
import { Page } from './page';
import { Hero } from './hero';
import { Feature } from './feature';
import { FeatureGrid } from './feature-grid';
import { Footer } from './footer';

export type RenderOptions = {
  references: SiteReferences;
  preview?: { cmsUrl: string; spaceId: string };
};

/** Add a case here when you add a component to your Storypane schema. */
export function Block({ block, ...options }: RenderOptions & { block: StorypaneComponent }) {
  const name = block.component;
  switch (block.component) {
    case 'page':
      return <Page block={block} {...options} />;
    case 'hero':
      return <Hero block={block} preview={options.preview} />;
    case 'feature':
      return <Feature block={block} references={options.references} />;
    case 'feature_grid':
      return <FeatureGrid block={block} {...options} />;
    case 'footer':
      return <Footer block={block} references={options.references} />;
    default:
      return (
        <p {...editable(block)} className="unsupported">
          No renderer registered for “{name}”.
        </p>
      );
  }
}
