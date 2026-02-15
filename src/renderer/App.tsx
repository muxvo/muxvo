/**
 * Muxvo — Root Application Component
 * DEV-PLAN A1: 主窗口布局（菜单栏 36px + 内容区 + 底部控制栏）
 * DEV-PLAN A4: Terminal grid integration
 */

import { useState, useEffect, useCallback } from 'react';
import { MenuBar } from './components/layout/MenuBar';
import { BottomBar } from './components/layout/BottomBar';
import { TerminalGrid } from './components/terminal/TerminalGrid';
import './App.css';

interface TerminalEntry {
  id: string;
  state: string;
}

export function App(): JSX.Element {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([]);

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
    await window.api.terminal.close(id);
    setTerminals((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <div className="app">
      <MenuBar />
      <main className="app-content">
        <TerminalGrid terminals={terminals} />
      </main>
      <BottomBar
        terminalCount={terminals.length}
        onAddTerminal={addTerminal}
      />
    </div>
  );
}
