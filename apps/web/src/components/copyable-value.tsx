'use client';

import { writeClipboardText } from '../lib/clipboard';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@storypane/ui';

export function CopyableValue({
  value,
  label,
  name,
  showLabel = true,
  href,
}: {
  value: string;
  label: string;
  name: string;
  showLabel?: boolean;
  href?: string;
}) {
  const [status, setStatus] = useState('');
  return (
    <div className="copyable-value">
      {showLabel && <span>{label}</span>}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${name} at ${value} in a new tab`}
        >
          <code>{value}</code>
        </a>
      ) : (
        <code>{value}</code>
      )}
      <Button
        variant="ghost"
        className="icon-button"
        aria-label={`Copy ${label.toLowerCase()} for ${name}`}
        title={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          try {
            await writeClipboardText(value);
            setStatus(`${label} copied`);
          } catch {
            setStatus('Could not copy. Select the text to copy it manually.');
          }
        }}
      >
        {status === `${label} copied` ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span
        className={status.startsWith('Could not') ? 'copyable-value-error' : 'sr-only'}
        role="status"
      >
        {status}
      </span>
    </div>
  );
}
