const VISIBLE_LIMIT = 10000;
const HIDDEN_LIMIT = 1000;

export function getBufferLimit(visibility: 'visible' | 'hidden'): number {
  return visibility === 'visible' ? VISIBLE_LIMIT : HIDDEN_LIMIT;
}

export function createBufferManager(opts: { initialLines: number }) {
  let lineCount = opts.initialLines;
  let maxLines = VISIBLE_LIMIT;

  return {
    get lineCount() {
      return lineCount;
    },
    get maxLines() {
      return maxLines;
    },
    setVisibility(v: 'visible' | 'hidden') {
      if (v === 'hidden') {
        maxLines = HIDDEN_LIMIT;
        if (lineCount > HIDDEN_LIMIT) {
          lineCount = HIDDEN_LIMIT;
        }
      } else {
        maxLines = VISIBLE_LIMIT;
        // Lines lost during shrink are NOT restored
      }
    },
  };
}
