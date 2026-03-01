/**
 * XTermRenderer — React wrapper for a single xterm.js terminal instance
 * DEV-PLAN A4: Terminal rendering via xterm.js
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import { createAddonManager } from '../../utils/terminal-addon-manager';
import { resolveTerminalTheme } from '@/shared/constants/terminal-themes';
import { DEFAULT_TERMINAL_CONFIG } from '@/renderer/stores/terminal-config';
import { TerminalSearchBar } from './TerminalSearchBar';
import { shellEscapePaths } from '../../utils/shell-escape';
import { stripPromptEolMark } from '@/shared/utils/strip-prompt-eol-mark';
import '@xterm/xterm/css/xterm.css';

interface Props {
  terminalId: string;
  suppressResize?: boolean;
}

/** Check if a drag event carries file data (Finder or Muxvo internal) */
function hasFilePayload(e: React.DragEvent): boolean {
  return (
    e.dataTransfer.types.includes('Files') ||
    e.dataTransfer.types.includes('application/x-muxvo-file-paths')
  );
}

/** Extract file paths from a drop event */
function extractFilePaths(e: React.DragEvent): string[] {
  // Priority 1: Muxvo internal file drag
  const muxvoData = e.dataTransfer.getData('application/x-muxvo-file-paths');
  if (muxvoData) {
    try {
      return JSON.parse(muxvoData) as string[];
    } catch { /* fall through */ }
  }
  // Priority 2: System file drop (Finder)
  if (e.dataTransfer.files.length > 0) {
    const paths: string[] = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const p = window.api.getPathForFile(e.dataTransfer.files[i]);
      if (p) paths.push(p);
    }
    return paths;
  }
  return [];
}

export function XTermRenderer({ terminalId, suppressResize }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [fileDropActive, setFileDropActive] = useState(false);
  const dragEnterCountRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false; // Guard: skip async callbacks after unmount

    // Create terminal synchronously with defaults (ensures immediate render)
    const term = new Terminal({
      cursorBlink: DEFAULT_TERMINAL_CONFIG.cursorBlink,
      cursorStyle: DEFAULT_TERMINAL_CONFIG.cursorStyle,
      fontSize: DEFAULT_TERMINAL_CONFIG.fontSize,
      fontFamily: DEFAULT_TERMINAL_CONFIG.fontFamily,
      theme: resolveTerminalTheme(DEFAULT_TERMINAL_CONFIG.themeName),
      allowProposedApi: true, // Required by Unicode11Addon and ImageAddon
    });

    term.open(containerRef.current);
    // Hide terminal until buffer replay completes, preventing blank/partial content flash
    if (containerRef.current) {
      containerRef.current.style.opacity = '0';
    }
    const addonManager = createAddonManager(term);
    addonManager.loadAll();
    searchAddonRef.current = addonManager.getSearchAddon();
    const fitAddon = addonManager.getFitAddon();

    // Expose xterm scroll state on the container div for E2E testability.
    // xterm.js v6 manages scroll internally — DOM scrollTop is always 0.
    function syncScrollDataAttrs(): void {
      if (containerRef.current) {
        containerRef.current.dataset.viewportY = String(term.buffer.active.viewportY);
        containerRef.current.dataset.baseY = String(term.buffer.active.baseY);
      }
    }
    const scrollDisposable = term.onScroll(() => syncScrollDataAttrs());
    // Also sync after any write (covers initial buffer replay)
    const writeDisposable = term.onWriteParsed(() => syncScrollDataAttrs());

    // Helper: fit terminal while preserving scroll position.
    // Uses proportional (ratio-based) scroll position to survive buffer rewrap
    // when column count changes significantly (e.g. tiled → focused mode switch).
    // Absolute offset would overshoot when baseY shrinks after unwrapping lines.
    // Scroll restoration is deferred to next frame because xterm.js v6
    // processes buffer rewrap asynchronously after fit().
    let fitSeq = 0;
    function fitPreservingScroll(): void {
      const seq = ++fitSeq;
      const buf = term.buffer.active;
      const wasAtBottom = buf.viewportY >= buf.baseY;
      const scrollRatio = buf.baseY > 0 ? buf.viewportY / buf.baseY : 1;

      fitAddon.fit();

      // Defer scroll restoration to next frame — xterm needs a tick to
      // complete buffer rewrap and update baseY/viewportY after fit().
      requestAnimationFrame(() => {
        if (disposed || seq !== fitSeq) return; // stale restore → skip
        if (wasAtBottom) {
          term.scrollToBottom();
        } else {
          const newBaseY = term.buffer.active.baseY;
          const targetViewportY = Math.round(scrollRatio * newBaseY);
          const newOffset = newBaseY - targetViewportY;
          term.scrollToBottom();
          if (newOffset > 0) {
            term.scrollLines(-newOffset);
          }
        }
        syncScrollDataAttrs();
      });
    }

    // Cmd/Ctrl+F toggles terminal search bar
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      const isMod = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
      if (isMod && e.key === 'f' && e.type === 'keydown') {
        setSearchVisible((prev) => !prev);
        return false;
      }
      // Cmd/Ctrl +/- global zoom (delegated to useGlobalZoom via custom event)
      if (isMod && (e.key === '=' || e.key === '+') && e.type === 'keydown') {
        window.dispatchEvent(new CustomEvent('muxvo:global-zoom-request', { detail: 'in' }));
        return false;
      }
      if (isMod && e.key === '-' && e.type === 'keydown') {
        window.dispatchEvent(new CustomEvent('muxvo:global-zoom-request', { detail: 'out' }));
        return false;
      }
      if (isMod && e.key === '0' && e.type === 'keydown') {
        window.dispatchEvent(new CustomEvent('muxvo:global-zoom-request', { detail: 'reset' }));
        return false;
      }
      return true;
    });
    // 延迟 fit，等待容器完成布局后再计算列宽行高
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    termRef.current = term;

    // Async: load persisted config and apply (theme/font changes take effect live)
    window.api.app.getConfig().then((result) => {
      if (disposed) return;
      if (result?.data?.terminal) {
        const cfg = { ...DEFAULT_TERMINAL_CONFIG, ...result.data.terminal };
        term.options.theme = resolveTerminalTheme(cfg.themeName);
        term.options.fontSize = cfg.fontSize;
        term.options.fontFamily = cfg.fontFamily;
        term.options.cursorStyle = cfg.cursorStyle;
        term.options.cursorBlink = cfg.cursorBlink;
        requestAnimationFrame(() => { if (!disposed) fitPreservingScroll(); });
      }
    }).catch(() => { /* use defaults on error */ });

    // Terminal input -> send to Main process
    term.onData((data) => {
      window.api.terminal.write(terminalId, data);
    });

    // Queue/flush pattern: subscribe first, fetch buffer, replay, then go live
    let bufferedDataWritten = false;
    const pendingLiveData: string[] = [];

    const unsubOutput = window.api.terminal.onOutput((event) => {
      if (event.id === terminalId) {
        if (!bufferedDataWritten) {
          pendingLiveData.push(event.data);
        } else {
          term.write(event.data);
        }
      }
    });

    // Fetch buffered output (captures anything from before subscription)
    console.log(`[MUXVO:restore] XTermRenderer mounted for id=${terminalId}`);
    window.api.terminal.getBuffer(terminalId).then((result: { success: boolean; data?: string }) => {
      if (disposed) return; // Component unmounted — discard
      if (result?.success && result.data) {
        console.log(`[MUXVO:restore] buffer received for id=${terminalId} bytes=${result.data.length}`);
        term.write(stripPromptEolMark(result.data));
      }
      // Flush any live data that arrived during getBuffer round-trip
      for (const data of pendingLiveData) {
        if (disposed) break;
        term.write(data);
      }
      pendingLiveData.length = 0;
      bufferedDataWritten = true;

      // Buffer replay complete — reveal terminal
      if (containerRef.current) {
        containerRef.current.style.opacity = '1';
      }

      // buffer 写入完成后重新 fit + scrollToBottom，确保列宽与内容匹配且 viewport 显示最新内容
      requestAnimationFrame(() => {
        if (!disposed) {
          fitAddon.fit();
          term.scrollToBottom();
        }
      });

      // Self-verification
      const lines = term.buffer.active.length;
      console.log(`[MUXVO:restore] xterm lines after buffer replay: ${lines} for id=${terminalId}`);
      if (lines <= 1) {
        console.warn(`[MUXVO:restore] WARNING: terminal ${terminalId} may still be blank after buffer replay`);
      }
    });

    // Resize observer -> fit terminal (skip when container is too small, e.g. during layout transition)
    // Debounced via rAF to coalesce multiple resize events within the same frame
    let resizeRafId: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || disposed) return;
      const { width, height } = entry.contentRect;
      if (width < 10 || height < 10) return;
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        if (!disposed) fitPreservingScroll();
      });
    });
    observer.observe(containerRef.current);

    // Notify Main process of terminal size changes (skip for compact/sidebar instances)
    term.onResize(({ cols, rows }) => {
      if (!suppressResize) {
        window.api.terminal.resize(terminalId, cols, rows);
      }
    });

    // Listen for UI theme changes to update xterm theme live
    const onThemeChange = (e: Event) => {
      const theme = (e as CustomEvent).detail?.theme;
      const terminalThemeName = theme === 'light' ? 'light' : 'dark';
      term.options.theme = resolveTerminalTheme(terminalThemeName);
    };
    window.addEventListener('muxvo:theme-change', onThemeChange);

    // Refit after global zoom changes (webFrame.setZoomFactor alters viewport dimensions)
    const onGlobalZoom = () => {
      requestAnimationFrame(() => { if (!disposed) fitPreservingScroll(); });
    };
    window.addEventListener('muxvo:global-zoom', onGlobalZoom);

    // Listen for force-refit requests (e.g. after FileTempView overlay closes)
    const onRefit = () => {
      if (!disposed && !suppressResize) {
        fitPreservingScroll();
        // Force re-send dimensions even if cols/rows unchanged (another instance may have altered PTY size)
        window.api.terminal.resize(terminalId, term.cols, term.rows);
      }
    };
    window.addEventListener('muxvo:terminal-refit', onRefit);

    return () => {
      disposed = true;
      unsubOutput();
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      observer.disconnect();
      window.removeEventListener('muxvo:theme-change', onThemeChange);
      window.removeEventListener('muxvo:global-zoom', onGlobalZoom);
      window.removeEventListener('muxvo:terminal-refit', onRefit);
      scrollDisposable.dispose();
      writeDisposable.dispose();
      addonManager.disposeAll();
      term.dispose();
    };
  }, [terminalId]);

  const handleFileDragOver = (e: React.DragEvent) => {
    if (hasFilePayload(e)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleFileDragEnter = (e: React.DragEvent) => {
    if (hasFilePayload(e)) {
      e.preventDefault();
      e.stopPropagation();
      dragEnterCountRef.current++;
      setFileDropActive(true);
    }
  };

  const handleFileDragLeave = (e: React.DragEvent) => {
    if (hasFilePayload(e)) {
      dragEnterCountRef.current--;
      if (dragEnterCountRef.current <= 0) {
        dragEnterCountRef.current = 0;
        setFileDropActive(false);
      }
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    if (!hasFilePayload(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDropActive(false);
    dragEnterCountRef.current = 0;

    const paths = extractFilePaths(e);
    if (paths.length > 0) {
      const escaped = shellEscapePaths(paths);
      window.api.terminal.write(terminalId, escaped);
    }
  };

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onDragOver={handleFileDragOver}
      onDragEnter={handleFileDragEnter}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {fileDropActive && (
        <div className="xterm-file-drop-overlay">
          Drop to insert path
        </div>
      )}
      {searchAddonRef.current && (
        <TerminalSearchBar
          searchAddon={searchAddonRef.current}
          visible={searchVisible}
          onClose={() => setSearchVisible(false)}
        />
      )}
    </div>
  );
}
