export async function reviewInBatches<T, R>(items: T[], review: (item: T) => Promise<R>) {
  const results: R[] = [];
  // Each publication review opens two requests; leave capacity for other editors.
  for (let index = 0; index < items.length; index += 4) {
    results.push(...(await Promise.all(items.slice(index, index + 4).map(review))));
  }
  return results;
}
