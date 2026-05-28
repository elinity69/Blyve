/** Debounce — coalesce rapid triggers into one run after `ms` of quiet. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, ms);
  }) as T;
}

/** Run `fn` at most once per `ms` (trailing edge). */
export function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let lastRun = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = ms - (now - lastRun);

    const invoke = () => {
      lastRun = Date.now();
      fn(...args);
    };

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      invoke();
      return;
    }

    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        invoke();
      }, remaining);
    }
  }) as T;
}

/** Remember keys already prefetched in this tab session. */
export function createPrefetchRegistry() {
  const keys = new Set<string>();
  return {
    run(key: string, fn: () => void) {
      if (keys.has(key)) return;
      keys.add(key);
      fn();
    },
    has(key: string) {
      return keys.has(key);
    },
    clear() {
      keys.clear();
    },
  };
}
