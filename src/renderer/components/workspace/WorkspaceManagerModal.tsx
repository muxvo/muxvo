import { useState, useEffect, useCallback, useRef } from 'react';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import type { SavedWorkspace } from '@/shared/types/config.types';
import './WorkspaceManagerModal.css';

export function WorkspaceManagerModal(): JSX.Element | null {
  const { state, dispatch } = usePanelContext();
  const [workspaces, setWorkspaces] = useState<SavedWorkspace[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Load workspaces when modal opens
  useEffect(() => {
    if (!state.workspaceManager.open) return;
    window.api.app.getConfig().then((result: any) => {
      setWorkspaces(result?.data?.savedWorkspaces || []);
    }).catch(() => {});
  }, [state.workspaceManager.open]);

  const handleClose = useCallback(() => {
    setEditingIdx(null);
    dispatch({ type: 'CLOSE_WORKSPACE_MANAGER' });
  }, [dispatch]);

  // ESC to close
  useEffect(() => {
    if (!state.workspaceManager.open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.workspaceManager.open, handleClose]);

  const saveWorkspaces = useCallback((updated: SavedWorkspace[]) => {
    setWorkspaces(updated);
    window.api.app.getConfig().then((result: any) => {
      window.api.app.saveConfig({ ...result?.data, savedWorkspaces: updated });
    }).catch(() => {});
  }, []);

  const handleDelete = useCallback((idx: number) => {
    const updated = workspaces.filter((_, i) => i !== idx);
    saveWorkspaces(updated);
  }, [workspaces, saveWorkspaces]);

  const startEditing = useCallback((idx: number) => {
    setEditingIdx(idx);
    setEditValue(workspaces[idx].name);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [workspaces]);

  const commitRename = useCallback(() => {
    if (editingIdx === null) return;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== workspaces[editingIdx].name) {
      const updated = workspaces.map((ws, i) =>
        i === editingIdx ? { ...ws, name: trimmed } : ws,
      );
      saveWorkspaces(updated);
    }
    setEditingIdx(null);
  }, [editingIdx, editValue, workspaces, saveWorkspaces]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      setEditingIdx(null);
    }
  }, [commitRename]);

  if (!state.workspaceManager.open) return null;

  return (
    <div className="ws-manager__backdrop" onClick={handleClose}>
      <div className="ws-manager" onClick={(e) => e.stopPropagation()}>
        <div className="ws-manager__header">
          <span className="ws-manager__title">Manage Workspaces</span>
          <button className="ws-manager__close" onClick={handleClose}>&times;</button>
        </div>
        <div className="ws-manager__body">
          {workspaces.length === 0 ? (
            <div className="ws-manager__empty">No saved workspaces</div>
          ) : (
            workspaces.map((ws, idx) => (
              <div className="ws-manager__item" key={ws.savedAt}>
                {editingIdx === idx ? (
                  <input
                    ref={inputRef}
                    className="ws-manager__name-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleKeyDown}
                    autoFocus
                  />
                ) : (
                  <span
                    className="ws-manager__name"
                    onClick={() => startEditing(idx)}
                    title="Click to rename"
                  >
                    {ws.name}
                  </span>
                )}
                <span className="ws-manager__meta">
                  {ws.terminals.length} terminals
                </span>
                <button
                  className="ws-manager__delete"
                  onClick={() => handleDelete(idx)}
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
