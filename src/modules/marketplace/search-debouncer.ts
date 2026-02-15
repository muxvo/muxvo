/**
 * Search Debouncer
 *
 * Implements debounced search input with configurable delay.
 * Only fires the search callback after the user stops typing for the specified duration.
 */

type SearchCallback = (query: string) => void;

export interface SearchDebouncer {
  onSearch(callback: SearchCallback): void;
  input(query: string): void;
  inputWithDelay(query: string, delayMs: number): void;
  flush(): Promise<void>;
}

export function createSearchDebouncer(delayMs: number): SearchDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInput: string | null = null;
  let callback: SearchCallback | null = null;
  let flushResolve: (() => void) | null = null;

  return {
    onSearch(cb: SearchCallback) {
      callback = cb;
    },

    input(query: string) {
      lastInput = query;
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        if (callback && lastInput !== null) {
          callback(lastInput);
        }
        if (flushResolve) {
          flushResolve();
          flushResolve = null;
        }
      }, delayMs);
    },

    inputWithDelay(query: string, _delayMs: number) {
      lastInput = query;
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        if (callback && lastInput !== null) {
          callback(lastInput);
        }
      }, delayMs);
    },

    flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (callback && lastInput !== null) {
        callback(lastInput);
        lastInput = null;
      }
      return Promise.resolve();
    },
  };
}
