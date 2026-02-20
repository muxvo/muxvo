/**
 * CloseConfirmDialog — Confirmation dialog when closing a terminal with a running process.
 * DEV-PLAN A5: 关闭确认对话框
 */

import { useI18n } from '@/renderer/i18n';
import './CloseConfirmDialog.css';

interface Props {
  open: boolean;
  terminalId: string;
  processName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CloseConfirmDialog({ open, processName, onConfirm, onCancel }: Props): JSX.Element | null {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="close-confirm-overlay" onClick={onCancel}>
      <div className="close-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="close-confirm-message">
          {t('close.confirm')}
        </p>
        <div className="close-confirm-actions">
          <button className="close-confirm-cancel" onClick={onCancel}>
            {t('close.cancel')}
          </button>
          <button className="close-confirm-ok" onClick={onConfirm}>
            {t('close.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
