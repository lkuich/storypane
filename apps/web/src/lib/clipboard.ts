import { parseBlockClipboard, type BlockClipboard } from '@storypane/core';

let copied: BlockClipboard | null = null;
let copiedText: string | null = null;
let revision = 0;
const listeners = new Set<() => void>();

export const copiedBlock = () => copied;
export const clipboardRevision = () => revision;
export function subscribeClipboard(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function rememberClipboard(text: string) {
  revision++;
  if (text === copiedText) return;
  try {
    copied = parseBlockClipboard(text);
    copiedText = text;
  } catch {
    if (!copied) return;
    copied = null;
    copiedText = null;
  }
  for (const listener of listeners) listener();
}
export async function writeClipboardText(text: string) {
  await navigator.clipboard.writeText(text);
  rememberClipboard(text);
}
