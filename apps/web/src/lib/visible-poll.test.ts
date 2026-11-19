import { afterEach, expect, it, vi } from 'vitest';
import { visiblePoll } from './visible-poll';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('pauses hidden reads, shares overlapping refreshes and serializes invalidations', async () => {
  vi.useFakeTimers();
  const tab = Object.assign(new EventTarget(), { hidden: true });
  const browser = Object.assign(new EventTarget(), { setInterval, clearInterval });
  vi.stubGlobal('document', tab);
  vi.stubGlobal('window', browser);
  let finish!: () => void;
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const read = vi.fn(async () => {}).mockImplementationOnce(() => first);
  const poll = visiblePoll(read, 1000);
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(0);
  tab.hidden = false;
  tab.dispatchEvent(new Event('visibilitychange'));
  browser.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(1);
  const refresh = poll.invalidate();
  void poll.invalidate();
  finish();
  await refresh;
  expect(read).toHaveBeenCalledTimes(2);
  tab.hidden = true;
  await vi.advanceTimersByTimeAsync(2000);
  poll.stop();
  tab.hidden = false;
  tab.dispatchEvent(new Event('visibilitychange'));
  browser.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(2);
});
