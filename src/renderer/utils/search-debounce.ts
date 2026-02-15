/**
 * Search Debouncer
 *
 * Debounces search input to reduce unnecessary search calls.
 */

interface DebouncerOpts {
  delayMs: number;
  onSearch: (query: string) => void;
}

export function createSearchDebouncer(opts: DebouncerOpts) {
  let lastValue = '';
  let pending = false;

  return {
    input(value: string) {
      lastValue = value;
      pending = true;
    },

    async flush() {
      if (pending) {
        opts.onSearch(lastValue);
        pending = false;
      }
    },
  };
}
