/**
 * 会话卡右键菜单 + 删除确认弹窗（M5-R1 批3 W8）。**live-only**：由 ChatHistoryLive 容器按状态渲染，
 * 静态/golden 路径永不挂载（fx.live 缺席 → 屏不渲卡片 onContextMenu → 容器无菜单状态）。样式走 chat-live.css
 * （token 化、暗亮双主题；容器侧 import，不入截图 bundle）。
 *
 * 关闭语义（菜单/弹窗一致）：点菜单外 mousedown（capture）关闭；Esc（capture + stopPropagation + preventDefault）
 * 关闭且**阻断面板 Esc 关闭**（ChatHistoryLive 的 document keydown 兜底以 !defaultPrevented 守卫）。
 */

import { useEffect, useRef } from 'react';

/** 关闭时既阻断冒泡（防面板 Esc）又标记 defaultPrevented（双保险）。 */
function guardEscape(e: KeyboardEvent): void {
  e.stopPropagation();
  e.preventDefault();
}

export function SessionContextMenu({
  x,
  y,
  onRename,
  onExport,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onRename(): void;
  onExport(): void;
  onDelete(): void;
  onClose(): void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        guardEscape(e);
        onClose();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="session-context-menu" style={{ left: x, top: y }} role="menu">
      <button type="button" className="session-context-menu__item" role="menuitem" onClick={onRename}>
        <span className="session-context-menu__icon" aria-hidden="true">
          ✏️
        </span>
        重命名
      </button>
      <button type="button" className="session-context-menu__item" role="menuitem" onClick={onExport}>
        <span className="session-context-menu__icon" aria-hidden="true">
          📄
        </span>
        导出为 Markdown
      </button>
      <div className="session-context-menu__sep" role="separator" />
      <button
        type="button"
        className="session-context-menu__item session-context-menu__item--danger"
        role="menuitem"
        onClick={onDelete}
      >
        <span className="session-context-menu__icon" aria-hidden="true">
          🗑
        </span>
        删除聊天记录
      </button>
    </div>
  );
}

export function DeleteConfirmModal({
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  /** rejected 内联提示（如「Codex 会话暂不支持删除」）；null=无。 */
  error: string | null;
  /** 删除请求进行中：禁用确认钮防重复提交。 */
  busy: boolean;
  onConfirm(): void;
  onCancel(): void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        guardEscape(e);
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="chat-confirm-modal__backdrop" onMouseDown={onCancel}>
      <div
        className="chat-confirm-modal__dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="chat-confirm-modal__text">确定删除此聊天记录？删除后无法恢复。</div>
        {error != null && <div className="chat-confirm-modal__error">{error}</div>}
        <div className="chat-confirm-modal__actions">
          <button type="button" className="chat-confirm-modal__btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="chat-confirm-modal__btn chat-confirm-modal__btn--danger"
            onClick={onConfirm}
            disabled={busy}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
