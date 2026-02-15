/**
 * Tile interaction state -> CSS style mapping.
 */

interface TileInteractionStyle {
  border: string;
  opacity: number;
  transform: string;
  extra?: string;
}

const styleMap: Record<string, TileInteractionStyle> = {
  Default: {
    border: 'var(--border)',
    opacity: 1,
    transform: 'none',
  },
  Hover: {
    border: 'var(--border)',
    opacity: 1,
    transform: 'rotateX/Y(+-4deg)',
    extra: '光泽反射层',
  },
  Selected: {
    border: 'var(--accent)',
    opacity: 1,
    transform: 'none',
    extra: 'amber 边框 glow',
  },
  Dragging: {
    border: 'var(--border)',
    opacity: 0.4,
    transform: 'none',
    extra: '半透明',
  },
  DragOver: {
    border: 'var(--accent)',
    opacity: 1,
    transform: 'none',
    extra: 'box-shadow: accent-glow',
  },
};

export function getTileInteractionStyle(state: string): TileInteractionStyle {
  return styleMap[state] ?? styleMap.Default;
}
