/**
 * UnsavedPromptDialog Component
 *
 * Modal dialog prompting user to save, discard, or cancel unsaved changes.
 */

import React, { useEffect } from 'react';
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
          Unsaved Changes
        </div>
        <div className="unsaved-prompt-dialog__message">
          File{' '}
          <span className="unsaved-prompt-dialog__filename">{fileName}</span>{' '}
          has unsaved changes.
        </div>
        <div className="unsaved-prompt-dialog__actions">
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--discard"
            onClick={onDiscard}
          >
            Discard
          </button>
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--save"
            onClick={onSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
