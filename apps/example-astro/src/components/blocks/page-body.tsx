import type { StorypaneComponent } from '../../types/storypane';
import { Block, type RenderOptions } from './block';

/** Adjacent feature cards share a grid; all other blocks keep their position. */
export function PageBody({ blocks, ...options }: RenderOptions & { blocks: StorypaneComponent[] }) {
  const groups: StorypaneComponent[][] = [];
  const firstFeature = blocks.find((block) => block.component === 'feature');

  for (const block of blocks) {
    const previousGroup = groups.at(-1);

    if (block.component === 'feature' && previousGroup?.[0]?.component === 'feature') {
      previousGroup.push(block);
    } else {
      groups.push([block]);
    }
  }

  return groups.map((group) => {
    const first = group[0];

    if (first.component !== 'feature') {
      return <Block key={first._uid} block={first} {...options} />;
    }

    return (
      <section
        key={first._uid}
        className="ideas"
        id={first === firstFeature ? 'ideas' : undefined}
        aria-label="Our approach"
      >
        <div className="feature-grid">
          {group.map((block) => (
            <Block key={block._uid} block={block} {...options} />
          ))}
        </div>
      </section>
    );
  });
}
