/**
 * ResizeHandle — Draggable handle for resizing grid columns/rows.
 */

import './ResizeHandle.css';

interface Props {
  type: 'col' | 'row';
  index: number;
  style?: React.CSSProperties;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
}

export function ResizeHandle({ type, index, style, onMouseDown, onDoubleClick }: Props): JSX.Element {
  return (
    <div
      className={`resize-handle resize-handle--${type}`}
      data-index={index}
      style={style}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
