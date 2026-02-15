/**
 * Muxvo — Root Application Component
 * DEV-PLAN A1: 主窗口布局（菜单栏 36px + 内容区 + 底部控制栏）
 * DEV-PLAN A4: Terminal grid integration
 * DEV-PLAN A5: Terminal lifecycle (max 20, close confirm)
 */

import { useState, useEffect, useCallback } from 'react';
import { MenuBar } from './components/layout/MenuBar';
import { BottomBar } from './components/layout/BottomBar';
import { TerminalGrid } from './components/terminal/TerminalGrid';
import { CloseConfirmDialog } from './components/terminal/CloseConfirmDialog';
import './App.css';

const MAX_TERMINALS = 20;

interface TerminalEntry {
  id: string;
  state: string;
}

interface CloseConfirmState {
  open: boolean;
  terminalId: string;
  processName: string;
}

export function App(): JSX.Element {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([]);
  const [closeConfirm, setCloseConfirm] = useState<CloseConfirmState>({
    open: false,
    terminalId: '',
    processName: '',
  });

  useEffect(() => {
    // Load existing terminals on mount
    window.api.terminal.list().then((result: { success: boolean; data?: TerminalEntry[] }) => {
      if (result?.success && result.data) {
        setTerminals(result.data);
      }
    });

    // Listen for terminal exits to remove from grid
    const unsubExit = window.api.terminal.onExit((event) => {
      setTerminals((prev) => prev.filter((t) => t.id !== event.id));
    });

    // Listen for state changes to update terminal state
    const unsubState = window.api.terminal.onStateChange((event) => {
      setTerminals((prev) =>
        prev.map((t) => (t.id === event.id ? { ...t, state: event.state } : t))
      );
    });

    return () => {
      unsubExit();
      unsubState();
    };
  }, []);

  const addTerminal = useCallback(async () => {
    const home = typeof process !== 'undefined' && process.env?.HOME ? process.env.HOME : '/';
    const result = await window.api.terminal.create(home);
    if (result?.success && result.data) {
      setTerminals((prev) => [...prev, { id: result.data.id, state: 'Running' }]);
    }
  }, []);

  const removeTerminal = useCallback(async (id: string) => {
    // Check if there's a foreground process running
    const fgResult = await window.api.terminal.getForegroundProcess(id);
    if (fgResult?.success && fgResult.data && fgResult.data.name !== 'shell') {
      // Show confirmation dialog
      setCloseConfirm({ open: true, terminalId: id, processName: fgResult.data.name });
      return;
    }
    // No active process or just shell — close directly
    await window.api.terminal.close(id);
    setTerminals((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleCloseConfirm = useCallback(async () => {
    const { terminalId } = closeConfirm;
    setCloseConfirm({ open: false, terminalId: '', processName: '' });
    await window.api.terminal.close(terminalId, true);
    setTerminals((prev) => prev.filter((t) => t.id !== terminalId));
  }, [closeConfirm]);

  const handleCloseCancel = useCallback(() => {
    setCloseConfirm({ open: false, terminalId: '', processName: '' });
  }, []);

  const maxReached = terminals.length >= MAX_TERMINALS;

  return (
    <div className="app">
      <MenuBar />
      <main className="app-content">
        <TerminalGrid terminals={terminals} />
      </main>
      <BottomBar
        terminalCount={terminals.length}
        onAddTerminal={addTerminal}
        maxReached={maxReached}
      />
      <CloseConfirmDialog
        open={closeConfirm.open}
        terminalId={closeConfirm.terminalId}
        processName={closeConfirm.processName}
        onConfirm={handleCloseConfirm}
        onCancel={handleCloseCancel}
      />
    </div>
  );
}
