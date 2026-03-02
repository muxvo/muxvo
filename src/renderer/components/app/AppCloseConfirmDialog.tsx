/**
 * AppCloseConfirmDialog — Custom confirmation dialog when closing the app window.
 * Matches Muxvo product style (dark card, amber accent, scale animation).
 */

import { useEffect } from 'react';
import './AppCloseConfirmDialog.css';

interface Props {
  open: boolean;
  terminalCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AppCloseConfirmDialog({ open, terminalCount, onConfirm, onCancel }: Props): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="app-close-overlay" onClick={onCancel}>
      <div className="app-close-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="app-close-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </div>
        <div className="app-close-title">退出 Muxvo</div>
        <div className="app-close-message">
          {terminalCount > 0
            ? `当前有 ${terminalCount} 个终端正在运行，退出后将全部终止。`
            : '确定要退出 Muxvo 吗？'}
        </div>
        <div className="app-close-actions">
          <button className="app-close-btn app-close-btn--cancel" onClick={onCancel}>
            取消
          </button>
          <button className="app-close-btn app-close-btn--quit" onClick={onConfirm}>
            退出
          </button>
        </div>
      </div>
    </div>
  );
}
