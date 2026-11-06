import { afterEach, expect, it, vi } from 'vitest';
import {
  copiedBlock,
  rememberClipboard,
  subscribeClipboard,
  writeClipboardText,
} from './clipboard';

const block = JSON.stringify({
  type: 'storypane/block',
  version: 1,
  spaceId: '11111111-1111-4111-8111-111111111111',
  migrationVersion: 1,
  blocks: [
    {
      definitionId: '22222222-2222-4222-8222-222222222222',
      parentIndex: null,
      parentField: null,
      position: 0,
      fields: { title: 'Copied' },
    },
  ],
});
afterEach(() => {
  rememberClipboard('');
  vi.unstubAllGlobals();
});

it('makes only valid copied blocks available and clears them when ordinary content is copied', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const listener = vi.fn();
  const unsubscribe = subscribeClipboard(listener);
  expect(copiedBlock()).toBeNull();
  await writeClipboardText(block);
  expect(copiedBlock()?.blocks[0].fields).toEqual({ title: 'Copied' });
  expect(listener).toHaveBeenCalled();
  await writeClipboardText('Just some text');
  expect(copiedBlock()).toBeNull();
  rememberClipboard('{"type":"storypane/block"}');
  expect(copiedBlock()).toBeNull();
  unsubscribe();
});

it('does not advertise a copy that failed, or forget a block when a later write fails', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
  });
  await expect(writeClipboardText(block)).rejects.toThrow('Denied');
  expect(copiedBlock()).toBeNull();
  rememberClipboard(block);
  await expect(writeClipboardText('Text that was not copied')).rejects.toThrow('Denied');
  expect(copiedBlock()?.blocks[0].fields.title).toBe('Copied');
  await expect(writeClipboardText('')).rejects.toThrow('Denied');
  expect(copiedBlock()?.blocks[0].fields.title).toBe('Copied');
});

it('clears the system clipboard and forgets the copied block after a successful empty write', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  rememberClipboard(block);
  const listener = vi.fn();
  const unsubscribe = subscribeClipboard(listener);
  await writeClipboardText('');
  expect(writeText).toHaveBeenCalledWith('');
  expect(copiedBlock()).toBeNull();
  expect(listener).toHaveBeenCalledOnce();
  // The clipboard poll must not restore a cleared block.
  rememberClipboard('');
  expect(copiedBlock()).toBeNull();
  unsubscribe();
});
