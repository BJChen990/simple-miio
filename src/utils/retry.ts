export function retry<A extends any[], R>(
  fn: (...args: A) => Promise<R>,
  initialQuota: number
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    let quota = initialQuota;
    let lastError: Error | undefined;
    while (quota > 0) {
      try {
        return await fn(...args);
      } catch (err) {
        quota -= 1;
        lastError = err as Error;
      }
    }
    throw new Error('Running out of retry quota. Error: ' + lastError?.message);
  };
}
