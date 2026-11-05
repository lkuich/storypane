import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { FieldDefinition, Json } from '@storypane/core';
import { FieldInput } from '../src/features/editor/field-input';
import '../src/app/globals.css';

function Harness() {
  const type = new URLSearchParams(location.search).get('type');
  const field: Exclude<FieldDefinition, { type: 'blocks' }> =
    type === 'link'
      ? { name: 'footer', label: 'Footer', type: 'link' }
      : {
          name: 'footer',
          label: 'Footer',
          type: type === 'options' ? 'options' : 'option',
          source: { type: 'stories' },
        };
  const [value, setValue] = useState<Json>(
    type === 'link'
      ? { type: 'story', storyId: 'footer' }
      : type === 'options'
        ? ['footer', 'navigation']
        : 'footer',
  );
  const [publicationId, setPublicationId] = useState('');
  return (
    <>
      <button onClick={() => setPublicationId(crypto.randomUUID())}>Apply publication</button>
      <FieldInput
        field={field}
        value={value}
        onChange={setValue}
        disabled={false}
        referenceRefreshKey={publicationId}
      />
      <output aria-label="Stored reference">{JSON.stringify(value)}</output>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
