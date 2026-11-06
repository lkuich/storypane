import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { Json } from '@storypane/core';
import { FieldInput } from '../src/features/editor/field-input';
import '../src/app/globals.css';

function Harness() {
  const [value, setValue] = useState<Json>({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha bravo charlie.' }] },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [
          {
            type: 'text',
            text: 'Formatted heading',
            marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#123456' } }],
          },
        ],
      },
    ],
  });
  const [pending, setPending] = useState<Json>();
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      // PostgreSQL jsonb returns object keys by length, then lexical order.
      setValue(
        JSON.parse(
          JSON.stringify(pending, (_key, item) =>
            item && typeof item === 'object' && !Array.isArray(item)
              ? Object.fromEntries(
                  Object.entries(item).sort(
                    ([a], [b]) => a.length - b.length || a.localeCompare(b),
                  ),
                )
              : item,
          ),
        ),
      );
      setPending(undefined);
      setSaves((count) => count + 1);
    }, 500);
    return () => clearTimeout(timer);
  }, [pending]);
  return (
    <>
      <FieldInput
        field={{ name: 'body', label: 'Body', type: 'text', format: 'richtext' }}
        value={value}
        onChange={(next) => {
          setValue(next);
          setPending(next);
        }}
        disabled={false}
      />
      <output aria-label="Completed saves">{saves}</output>
      <button
        onClick={() =>
          setValue({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored version' }] }],
          })
        }
      >
        Restore saved version
      </button>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
