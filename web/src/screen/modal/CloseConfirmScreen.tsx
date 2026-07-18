/**
 * 关闭确认对话框屏（specs/behavior/close-confirm-dialog.md）：终端版代表作。
 * 纯 props 吃 fixture（closeConfirm payload）。processName 随 fixture 携带但不渲染
 * （legacy 实况，spec §1）；文案固定 zh（golden 即 zh）。
 */

import './modals.css';

export function CloseConfirmScreen({ fx: _fx }: { fx: any }): JSX.Element {
  return (
    <div className="close-confirm-overlay">
      <div className="close-confirm-dialog">
        <p className="close-confirm-message">确定关闭此终端？</p>
        <div className="close-confirm-actions">
          <button className="close-confirm-cancel">取消</button>
          <button className="close-confirm-ok">确定</button>
        </div>
      </div>
    </div>
  );
}
