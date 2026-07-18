/**
 * 未保存/冲突确认对话框（§4）。复用 .unsaved-prompt-dialog* DOM/CSS，参数化三形态：
 * - closeConfirm：单关 dirty tab → 保存/丢弃/取消
 * - exitSummary：退出多 dirty → 「N 个文件未保存」列表 + 全部保存/全部丢弃/取消
 * - conflict：mtime 冲突 → 「文件已被外部修改」覆盖/放弃（放弃 = cancel）
 * overlay 挂 data-hit-island（洞穿透架构：native 把浮层点击拦回 web）。回调缺省 = 静态 inert。
 */

import type { FileTabsDialog } from './fileTabsReducer';

export type DialogAction = 'save' | 'discard' | 'cancel' | 'saveAll' | 'discardAll' | 'overwrite';

function baseName(path: string): string {
  return path.split('/').pop() || path;
}

export function UnsavedDialog({
  dialog,
  onAction,
}: {
  dialog: FileTabsDialog;
  onAction?: (a: DialogAction) => void;
}): JSX.Element {
  const act = (a: DialogAction) => (onAction ? () => onAction(a) : undefined);
  return (
    <div className="unsaved-prompt-dialog__overlay" data-hit-island="" onClick={act('cancel')}>
      <div className="unsaved-prompt-dialog" onClick={(e) => e.stopPropagation()}>
        {dialog.k === 'closeConfirm' && (
          <>
            <div className="unsaved-prompt-dialog__title">未保存的更改</div>
            <div className="unsaved-prompt-dialog__message">{baseName(dialog.path)} 有未保存的更改。</div>
            <div className="unsaved-prompt-dialog__actions">
              <button className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--cancel" onClick={act('cancel')}>
                取消
              </button>
              <button className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--discard" onClick={act('discard')}>
                丢弃
              </button>
              <button className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--save" onClick={act('save')}>
                保存
              </button>
            </div>
          </>
        )}

        {dialog.k === 'exitSummary' && (
          <>
            <div className="unsaved-prompt-dialog__title">{dialog.paths.length} 个文件未保存</div>
            <ul className="unsaved-prompt-dialog__list">
              {dialog.paths.map((p) => (
                <li key={p} className="unsaved-prompt-dialog__list-item">
                  {baseName(p)}
                </li>
              ))}
            </ul>
            <div className="unsaved-prompt-dialog__actions">
              <button className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--cancel" onClick={act('cancel')}>
                取消
              </button>
              <button className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--discard" onClick={act('discardAll')}>
                全部丢弃
              </button>
              <button className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--save" onClick={act('saveAll')}>
                全部保存
              </button>
            </div>
          </>
        )}

        {dialog.k === 'conflict' && (
          <>
            <div className="unsaved-prompt-dialog__title">文件已被外部修改</div>
            <div className="unsaved-prompt-dialog__message">
              {baseName(dialog.path)} 在磁盘上已变化。覆盖将丢弃外部改动。
            </div>
            <div className="unsaved-prompt-dialog__actions">
              <button className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--cancel" onClick={act('cancel')}>
                放弃
              </button>
              <button className="unsaved-prompt-dialog__btn unsaved-prompt-dialog__btn--save" onClick={act('overwrite')}>
                覆盖
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
