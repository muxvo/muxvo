/**
 * Tile CSS style mapping by state.
 */

interface TileStyle {
  border: string;
  opacity: number;
}

const styles: Record<string, TileStyle> = {
  default: { border: 'var(--border)', opacity: 1 },
};

export function getTileStyle(state: string): TileStyle {
  return styles[state.toLowerCase()] ?? styles.default;
}
