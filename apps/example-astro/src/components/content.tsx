import type { StorypaneContentType } from '../types/storypane';
import { Block, type RenderOptions } from './blocks/block';

export function Content({ block, ...options }: RenderOptions & { block: StorypaneContentType }) {
  const content = <Block block={block} {...options} />;
  return block.component === 'footer' ? <main id="content">{content}</main> : content;
}
