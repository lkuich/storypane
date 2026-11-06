import type { StorypaneComponent } from '../types/storypane';
import { Block, type RenderOptions } from './blocks/block';

export function Content({ block, ...options }: RenderOptions & { block: StorypaneComponent }) {
  const content = <Block block={block} {...options} />;
  return block.component === 'footer' ? <main id="content">{content}</main> : content;
}
