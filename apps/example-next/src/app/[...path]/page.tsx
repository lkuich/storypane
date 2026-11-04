import { notFound } from 'next/navigation';
import { Story } from '../../components/client';
import { cmsUrl,spaceId,previewParameter,publishedPages } from '../../lib/cms';

type Props = { params:Promise<{ path:string[] }> };
export const dynamicParams = false;
export const dynamic = 'force-static';
export async function generateStaticParams() {
  return (await publishedPages()).map(({ params }) => ({ path:params.path.split('/') }));
}
async function pageFor({ params }:Props) {
  const path = (await params).path.join('/');
  return (await publishedPages()).find(page => page.params.path === path)?.props ?? notFound();
}
export async function generateMetadata(props:Props) {
  return { title:(await pageFor(props)).story.name };
}
export default async function Page(props:Props) {
  const { story,references } = await pageFor(props);
  return <div lang={story.locale || 'en'}><Story initial={story} references={references} cmsUrl={cmsUrl} spaceId={spaceId} previewParameter={previewParameter} framework="Next.js" /></div>;
}
