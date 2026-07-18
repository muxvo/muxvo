/**
 * 工作区管理弹窗屏（specs/behavior/workspace-manager-modal.md）：480px 居中 modal，
 * 列表 + 行内编辑中行（editing.index 行渲染 input）。纯 props 吃 fixture（workspace payload），
 * 永不 mock IPC。标题/条数文案为 legacy 硬编码英文（spec §2），不走 locale。
 */

import '../../styles/surfaces.css';
import './modals.css';

interface WorkspaceItem {
  name: string;
  savedAt: string;
  terminals: { cwd: string }[];
}

export function WorkspaceManagerScreen({ fx }: { fx: any }): JSX.Element {
  const workspaces: WorkspaceItem[] = fx.workspace?.workspaces ?? [];
  const editing: { index: number; value: string } | null = fx.workspace?.editing ?? null;

  return (
    <div className="ws-manager__backdrop">
      <div className="ws-manager">
        <div className="ws-manager__header">
          <span className="ws-manager__title">Manage Workspaces</span>
          <button className="ws-manager__close">{'×'}</button>
        </div>
        <div className="ws-manager__body">
          {workspaces.length === 0 ? (
            <div className="ws-manager__empty">No saved workspaces</div>
          ) : (
            workspaces.map((ws, idx) => (
              <div className="ws-manager__item" key={ws.savedAt}>
                {editing && editing.index === idx ? (
                  <input className="ws-manager__name-input" defaultValue={editing.value} />
                ) : (
                  <span className="ws-manager__name" title="Click to rename">
                    {ws.name}
                  </span>
                )}
                <span className="ws-manager__meta">{ws.terminals.length} terminals</span>
                <button className="ws-manager__delete" title="Delete">
                  {'×'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
