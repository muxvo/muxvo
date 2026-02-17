/**
 * CloseConfirmDialog — Confirmation dialog when closing a terminal with a running process.
 * DEV-PLAN A5: 关闭确认对话框
 */

import './CloseConfirmDialog.css';

interface Props {
  open: boolean;
  terminalId: string;
  processName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CloseConfirmDialog({ open, processName, onConfirm, onCancel }: Props): JSX.Element | null {
  if (!open) return null;

  return (
    <div className="close-confirm-overlay" onClick={onCancel}>
      <div className="close-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="close-confirm-message">
          确定关闭此终端？
        </p>
        <div className="close-confirm-actions">
          <button className="close-confirm-cancel" onClick={onCancel}>
            取消
          </button>
          <button className="close-confirm-ok" onClick={onConfirm}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
