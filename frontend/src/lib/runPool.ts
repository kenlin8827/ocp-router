/** Run an async task over items with bounded concurrency (never hammers upstreams). */
export async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
}
