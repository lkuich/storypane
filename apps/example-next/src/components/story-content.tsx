import type { StorypaneStory } from '@storypane/sdk';
import type { StorypaneContentType } from '@/types/storypane';
import { Block, type RenderOptions } from './blocks/block';

/** The same pure renderer works in a Server Component and in the live preview. */
export function StoryContent({
  story,
  ...options
}: RenderOptions & { story: StorypaneStory<StorypaneContentType> }) {
  const content = <Block block={story.content} {...options} />;
  return story.content.component === 'footer' ? <main id="content">{content}</main> : content;
}
