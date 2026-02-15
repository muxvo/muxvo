/**
 * XTermRenderer — React wrapper for a single xterm.js terminal instance
 * DEV-PLAN A4: Terminal rendering via xterm.js
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface Props {
  terminalId: string;
}

export function XTermRenderer({ terminalId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    // Terminal input -> send to Main process
    term.onData((data) => {
      window.api.terminal.write(terminalId, data);
    });

    // Receive terminal output
    const unsubOutput = window.api.terminal.onOutput((event) => {
      if (event.id === terminalId) {
        term.write(event.data);
      }
    });

    // Resize observer -> fit terminal
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(containerRef.current);

    // Notify Main process of terminal size changes
    term.onResize(({ cols, rows }) => {
      window.api.terminal.resize(terminalId, cols, rows);
    });

    return () => {
      unsubOutput();
      observer.disconnect();
      term.dispose();
    };
  }, [terminalId]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
