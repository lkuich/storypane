import { expect, it } from 'vitest';
import { reviewInBatches } from './review-batches';

it('loads a full bulk selection without exhausting database capacity and keeps selection order', async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 50 }, (_, index) => index);
  const results = await reviewInBatches(items, async (item) => {
    active += 2;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, item % 3));
    active -= 2;
    return item;
  });
  expect(peak).toBe(8);
  expect(active).toBe(0);
  expect(results).toEqual(items);
});

it('preserves review errors and does not start another batch after a failure', async () => {
  const started: number[] = [];
  await expect(
    reviewInBatches([0, 1, 2, 3, 4], async (item) => {
      started.push(item);
      if (item === 1) throw new Error('Permission denied');
      return item;
    }),
  ).rejects.toThrow('Permission denied');
  expect(started).toEqual([0, 1, 2, 3]);
  expect(await reviewInBatches([], async () => 1)).toEqual([]);
});
