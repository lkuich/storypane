'use client';

import { useEffect, useState } from 'react';
import { Button, Modal } from '@storypane/ui';

export function RecommendedSetup({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const storageKey = `storypane:recommended-setup:${userId}`;
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storageKey) !== 'seen');
    } catch {
      setOpen(true);
    }
  }, [storageKey]);

  function dismiss() {
    setOpen(false);
    try {
      // shortcut: remembered per browser; use an account preference if cross-device sync is needed.
      localStorage.setItem(storageKey, 'seen');
    } catch {
      // Keep the workspace usable when browser storage is unavailable.
    }
  }

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title="Welcome to Storypane"
      description="Start with the recommended setup for your first project."
    >
      <p>Our guide walks you through:</p>
      <ul>
        <li>Protecting your production schema.</li>
        <li>Creating a linked development space and connecting your website.</li>
        <li>Adjusting live previews for a smoother editor.</li>
      </ul>
      <p>
        Already joining a team? Start with their existing space. You can find the guide in Docs
        anytime.
      </p>
      <div className="dialog-actions">
        <Button onClick={dismiss}>Maybe later</Button>
        <a
          className="button button--primary"
          href="https://storypane.dev/docs/recommended-setup/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Recommended setup (opens in a new tab)"
          onClick={dismiss}
        >
          Recommended setup ↗
        </a>
      </div>
    </Modal>
  );
}
