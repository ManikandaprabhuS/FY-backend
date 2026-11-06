// Bounded concurrency with ordered results. Wait for running work before failing,
// so callers can safely roll back successful uploads without late orphan writes.
export const mapConcurrent = async <T, R>(items: readonly T[], limit: number, operation: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Concurrency must be a positive integer");
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await operation(items[index]!, index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failure;
  return results;
};
