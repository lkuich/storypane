import { PreviewShell } from '../../components/client';
import { cmsUrl,spaceId,publishedStories } from '../../lib/cms';
import { referencesFor } from '../../../../example-astro/src/lib/content';

export const dynamic = 'force-static';
export const metadata = { title:'Preview',robots:{ index:false,follow:false } };
export default async function Preview() {
  const stories = await publishedStories();
  const references = Object.fromEntries([...new Set(['',...stories.map(story => story.locale)])].map(locale => [locale,referencesFor(stories,locale)]));
  return <PreviewShell cmsUrl={cmsUrl} spaceId={spaceId} references={references} framework="Next.js" />;
}
