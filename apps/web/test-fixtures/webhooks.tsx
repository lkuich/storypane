import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { WebhookSettings } from '../src/features/spaces/webhook-settings';
import '../src/app/globals.css';
import '../src/features/spaces/spaces.css';

function Harness() {
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <>
      <WebhookSettings onDirty={setDirty} onBusy={setBusy} />
      <output aria-label="Navigation guard">{busy ? 'Busy' : dirty ? 'Unsaved' : 'Ready'}</output>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
