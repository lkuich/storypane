'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@storypane/ui';

export function PageId({
  id,
  name,
  showLabel = true,
}: {
  id: string;
  name: string;
  showLabel?: boolean;
}) {
  const [status, setStatus] = useState('');
  return (
    <div className="page-id">
      {showLabel && <span>Page ID</span>}
      <code>{id}</code>
      <Button
        variant="ghost"
        className="icon-button"
        aria-label={`Copy page ID for ${name}`}
        title="Copy page ID"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            setStatus('Page ID copied');
          } catch {
            setStatus('Could not copy. Select the ID to copy it manually.');
          }
        }}
      >
        {status === 'Page ID copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span className={status.startsWith('Could not') ? 'page-id-error' : 'sr-only'} role="status">
        {status}
      </span>
    </div>
  );
}
