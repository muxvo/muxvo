/**
 * 未保存确认对话框（live）：复用 file.css 的 .unsaved-prompt-dialog* 视觉件（B4 先例），
 * 只加交互（保存/放弃/取消）。data-hit-island 让 native 把点击拦回 web（浮层=岛，DOGFOOD_M3_04）。
 */
import { createPortal } from 'react-dom';
import '../../file/file.css';

export function UnsavedPromptLive({
  name,
  onSave,
  onDiscard,
  onCancel,
}: {
  name: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}): JSX.Element {
  return createPortal(
    <div className="unsaved-prompt-dialog__overlay" data-hit-island="" onClick={onCancel}>
      <div className="unsaved-prompt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="unsaved-prompt-dialog__title">未保存的更改</div>
        <div className="unsaved-prompt-dialog__message">{name} 有未保存的更改。</div>
        <div className="unsaved-prompt-dialog__actions">
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--discard"
            onClick={onDiscard}
          >
            放弃更改
          </button>
          <button
            className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--save"
            onClick={onSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
