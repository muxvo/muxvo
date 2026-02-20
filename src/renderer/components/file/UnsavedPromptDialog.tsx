/**
 * UnsavedPromptDialog Component
 *
 * Modal dialog prompting user to save, discard, or cancel unsaved changes.
 */

import React, { useEffect } from 'react';
import { useI18n } from '@/renderer/i18n';
import './UnsavedPromptDialog.css';

interface UnsavedPromptDialogProps {
  fileName: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedPromptDialog({
  fileName,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedPromptDialogProps) {
  const { t } = useI18n();
  // Esc = cancel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="unsaved-prompt-dialog__overlay" onClick={onCancel}>
      <div
        className="unsaved-prompt-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="unsaved-prompt-dialog__title">
          {t('unsaved.title')}
        </div>
        <div className="unsaved-prompt-dialog__message">
          {t('unsaved.message', { fileName })}
        </div>
        <div className="unsaved-prompt-dialog__actions">
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--cancel"
            onClick={onCancel}
          >
            {t('unsaved.cancel')}
          </button>
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--discard"
            onClick={onDiscard}
          >
            {t('unsaved.discard')}
          </button>
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--save"
            onClick={onSave}
          >
            {t('unsaved.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
