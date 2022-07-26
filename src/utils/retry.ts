export function retry<F extends (...args: any[]) => Promise<any>>(
  fn: F,
  initialQuota: number
) {
  let quota = initialQuota;
  return async (...args: Parameters<F>) => {
    while (quota > 0) {
      try {
        return await fn(...args);
      } catch {
        quota -= 1;
      }
    }
  };
}
