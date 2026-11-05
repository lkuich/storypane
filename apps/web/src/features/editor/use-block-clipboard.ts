'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  clipboardRevision,
  copiedBlock,
  rememberClipboard,
  subscribeClipboard,
} from '../../lib/clipboard';

export function useBlockClipboard() {
  const copied = useSyncExternalStore(subscribeClipboard, copiedBlock, () => null);
  useEffect(() => {
    let stopped = false;
    async function refresh(clearUnknown = false) {
      if (document.hidden || !document.hasFocus()) return;
      const revision = clipboardRevision();
      let text: string | undefined;
      try {
        const permission = await navigator.permissions.query({
          name: 'clipboard-read' as PermissionName,
        });
        if (permission.state === 'granted') text = await navigator.clipboard.readText();
      } catch {
        /* Browsers without clipboard read permission use explicit copy/paste events. */
      }
      if (!stopped && revision === clipboardRevision() && (text !== undefined || clearUnknown))
        rememberClipboard(text ?? '');
    }
    const focus = () => void refresh(true);
    const copy = (event: ClipboardEvent) => {
      const target = event.target;
      rememberClipboard(
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
          ? target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0)
          : (window.getSelection()?.toString() ?? ''),
      );
    };
    const paste = (event: ClipboardEvent) =>
      rememberClipboard(event.clipboardData?.getData('text/plain') ?? '');
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    document.addEventListener('copy', copy);
    document.addEventListener('cut', copy);
    document.addEventListener('paste', paste);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', copy);
      document.removeEventListener('paste', paste);
    };
  }, []);
  return copied;
}
