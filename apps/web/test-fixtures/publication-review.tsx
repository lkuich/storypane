import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { LocaleSnapshot, PublicationReview } from '@storypane/core';
import { Button, Modal } from '@storypane/ui';
import { PublicationChangesView } from '../src/features/editor/publication-changes-view';
import '../src/app/globals.css';

const live = {
  locale: { slug: '', urlSlug: 'home', rootBlockId: 'root' },
  blocks: [
    {
      id: 'root',
      definitionId: 'page',
      schemaVersionId: 'page',
      parentId: null,
      parentField: null,
      position: 0,
      revision: 1,
      fields: { title: 'Home' },
    },
    ...Array.from({ length: 50 }, (_, index) => ({
      id: `section-${index}`,
      definitionId: 'hero',
      schemaVersionId: 'hero',
      parentId: 'root',
      parentField: 'body',
      position: index,
      revision: 1,
      fields: {
        title: index === 2 ? 'Build something wonderful' : `Section ${index + 1}`,
        description: 'A familiar place to start.',
      },
    })),
  ],
  definitions: [
    {
      id: 'page',
      versionId: 'page',
      name: 'page',
      displayName: 'Page',
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'body', label: 'Body', type: 'blocks' },
      ],
    },
    {
      id: 'hero',
      versionId: 'hero',
      name: 'hero',
      displayName: 'Hero',
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'description', label: 'Description', type: 'text' },
      ],
    },
  ],
} as unknown as LocaleSnapshot;
const snapshot = structuredClone(live);
snapshot.blocks[3].fields.title = 'Your next chapter starts here';
snapshot.blocks[6].fields.description = 'Explore the new collection, made for the way you work.';
const mode = new URLSearchParams(location.search).get('mode');
const review = {
  snapshot: mode === 'unchanged' ? live : snapshot,
  publishedSnapshot: mode === 'first' ? null : live,
} as PublicationReview;

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Review & publish</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Review before publishing"
        className="publish-review-dialog"
        description="This publishes revision 46. Later edits stay in the draft."
        wide
      >
        <div className="content-path-preview">
          <span>URL to publish · Default</span>
          <code>/home</code>
        </div>
        <PublicationChangesView review={review} />
        <details className="publication-full-content">
          <summary>View full saved content</summary>
          <pre>{JSON.stringify(snapshot.blocks, null, 2)}</pre>
        </details>
        <div className="dialog-actions publish-review-actions">
          <Button onClick={() => setOpen(false)}>Keep editing</Button>
          <Button>Add to release</Button>
          <Button variant="primary">Publish revision 46</Button>
        </div>
      </Modal>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
