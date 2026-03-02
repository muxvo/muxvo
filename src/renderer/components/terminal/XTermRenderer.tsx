/**
 * XTermRenderer — React wrapper for a single xterm.js terminal instance
 * DEV-PLAN A4: Terminal rendering via xterm.js
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import { createAddonManager } from '../../utils/terminal-addon-manager';
import { trackRenderer } from '../../utils/renderer-perf-logger';
import { resolveTerminalTheme } from '@/shared/constants/terminal-themes';
import { DEFAULT_TERMINAL_CONFIG } from '@/renderer/stores/terminal-config';
import { TerminalSearchBar } from './TerminalSearchBar';
import { shellEscapePaths } from '../../utils/shell-escape';
import { stripPromptEolMark } from '@/shared/utils/strip-prompt-eol-mark';
import '@xterm/xterm/css/xterm.css';

/** Minimum terminal dimensions to send to PTY. Prevents hard-wrapping damage
 *  from layout transitions (fullscreen toggle, focus mode switch) where
 *  fitAddon briefly calculates cols from not-yet-settled containers. */
const MIN_COLS_FOR_RESIZE = 10;
const MIN_ROWS_FOR_RESIZE = 2;

/** Diagnostic logging — set to false after debugging */
const RESIZE_DEBUG = true;

function logFit(id: string, src: string, container: HTMLElement | null, cols: number, rows: number, action: string): void {
  if (!RESIZE_DEBUG) return;
  const rect = container?.getBoundingClientRect();
  const w = Math.round(rect?.width ?? 0);
  const h = Math.round(rect?.height ?? 0);
  console.log(`[XTERM:fit] id=${id.slice(0, 5)} src=${src} container=${w}x${h} cols=${cols} rows=${rows} ${action}`);
}

function logResize(id: string, cols: number, rows: number, action: string): void {
  if (!RESIZE_DEBUG) return;
  console.log(`[XTERM:resize] id=${id.slice(0, 5)} cols=${cols} rows=${rows} → ${action}`);
}

/** Check if container has sufficient dimensions for a meaningful fit */
function isContainerReady(container: HTMLElement | null): boolean {
  if (!container) return false;
  const { width, height } = container.getBoundingClientRect();
  return width >= 10 && height >= 10;
}

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
  // Ref tracks latest suppressResize value so ResizeObserver closure reads current state.
  // Assigned during render (not useEffect) to avoid race: ResizeObserver fires before
  // useEffect, so the ref must be updated synchronously before paint.
  const suppressResizeRef = useRef(suppressResize ?? false);
  suppressResizeRef.current = suppressResize ?? false;

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
    // loadAll is async (waits for document.fonts.ready before WebGL init).
    // FitAddon is loaded synchronously at the start, so getFitAddon() is safe here.
    // SearchAddon is set after the promise resolves.
    addonManager.loadAll().then(() => {
      if (disposed) return;
      searchAddonRef.current = addonManager.getSearchAddon();
    });
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
    function fitPreservingScroll(source: string = 'unknown'): void {
      const seq = ++fitSeq;
      const prevCols = term.cols;
      const prevRows = term.rows;
      const buf = term.buffer.active;
      const wasAtBottom = buf.viewportY >= buf.baseY;
      const scrollRatio = buf.baseY > 0 ? buf.viewportY / buf.baseY : 1;

      // Hide content during reflow to prevent 1-frame flash of wrong scroll position.
      // visibility:hidden keeps element dimensions (unlike display:none) so fitAddon
      // calculates correct cols/rows. Only hidden for ~16ms (1 frame).
      const viewport = containerRef.current?.querySelector('.xterm-viewport') as HTMLElement | null;
      if (viewport) viewport.style.visibility = 'hidden';

      fitAddon.fit();
      trackRenderer('fitCall');
      logFit(terminalId, source, containerRef.current, term.cols, term.rows,
        `${prevCols}x${prevRows}→${term.cols}x${term.rows}`);
      if (RESIZE_DEBUG && prevCols > 20 && term.cols < prevCols / 2) {
        console.warn(`[XTERM:WARN] id=${terminalId.slice(0, 5)} cols DROPPED ${prevCols}→${term.cols} src=${source}`);
        console.trace();
      }

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
        // Restore visibility after scroll position is correct
        if (viewport) viewport.style.visibility = '';
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
    // Guards: skip if disposed, suppressResize (compact/sidebar), or container too small
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (disposed) return;
        if (!isContainerReady(containerRef.current)) {
          logFit(terminalId, 'initialFit', containerRef.current, term.cols, term.rows, 'SKIPPED(notReady)');
          return;
        }
        const prevCols = term.cols;
        fitAddon.fit();
        logFit(terminalId, 'initialFit', containerRef.current, term.cols, term.rows,
          `${prevCols}x${term.rows}→${term.cols}x${term.rows}`);
      });
    });
    // Safety-net: retry fit after a generous delay to catch cases where the
    // initial double-RAF was too early (e.g. CSS Grid not fully settled).
    // fitAddon.fit() is a no-op when dimensions haven't changed.
    const safetyTimer = setTimeout(() => {
      if (disposed) return;
      if (!isContainerReady(containerRef.current)) {
        logFit(terminalId, 'safetyNet', containerRef.current, term.cols, term.rows, 'SKIPPED(notReady)');
        return;
      }
      const prevCols = term.cols;
      fitAddon.fit();
      logFit(terminalId, 'safetyNet', containerRef.current, term.cols, term.rows,
        `${prevCols}x${term.rows}→${term.cols}x${term.rows}`);
    }, 200);
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
        requestAnimationFrame(() => {
          if (!disposed && isContainerReady(containerRef.current)) {
            fitPreservingScroll('configApply');
          }
        });
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
        trackRenderer('ipcOutput');
        if (!bufferedDataWritten) {
          pendingLiveData.push(event.data);
        } else {
          trackRenderer('termWrite');
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
          if (isContainerReady(containerRef.current)) {
            const prevCols = term.cols;
            fitAddon.fit();
            logFit(terminalId, 'bufferReplay', containerRef.current, term.cols, term.rows,
              `${prevCols}x${term.rows}→${term.cols}x${term.rows}`);
          } else {
            logFit(terminalId, 'bufferReplay', containerRef.current, term.cols, term.rows, 'SKIPPED(notReady)');
          }
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
    // Called synchronously (no rAF) so fitAddon.fit() runs before paint —
    // eliminates 1-frame gap where container is resized but canvas hasn't been fitted yet.
    // ResizeObserver already batches observations per frame, so no extra debouncing needed.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || disposed) return;
      const { width, height } = entry.contentRect;
      if (width < 10 || height < 10) {
        if (RESIZE_DEBUG) console.log(`[XTERM:resizeObs] id=${terminalId.slice(0, 5)} w=${Math.round(width)} h=${Math.round(height)} → SKIP(tooSmall)`);
        return;
      }
      fitPreservingScroll('resizeObs');
      trackRenderer('resizeObs');
    });
    observer.observe(containerRef.current);

    // Notify Main process of terminal size changes (suppressed for compact/sidebar terminals).
    // Min-size gate: never send tiny dimensions to PTY — they cause irreversible
    // hard-wrapping when shell redraws prompt at e.g. 2 columns.
    term.onResize(({ cols, rows }) => {
      if (suppressResizeRef.current) {
        logResize(terminalId, cols, rows, 'BLOCKED(suppressResize)');
      } else if (cols < MIN_COLS_FOR_RESIZE || rows < MIN_ROWS_FOR_RESIZE) {
        logResize(terminalId, cols, rows, `BLOCKED(min:${MIN_COLS_FOR_RESIZE}x${MIN_ROWS_FOR_RESIZE})`);
      } else {
        logResize(terminalId, cols, rows, 'IPC_SENT');
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
      requestAnimationFrame(() => { if (!disposed) fitPreservingScroll('globalZoom'); });
    };
    window.addEventListener('muxvo:global-zoom', onGlobalZoom);

    // Listen for force-refit requests (e.g. after FileTempView overlay closes)
    const onRefit = () => {
      if (!disposed) {
        console.log(`[GLYPH:refit] ${Date.now()} id=${terminalId.slice(0, 5)} cols=${term.cols} rows=${term.rows}`);
        fitPreservingScroll('forceRefit');
        // Force re-send dimensions even if cols/rows unchanged
        window.api.terminal.resize(terminalId, term.cols, term.rows);
      }
    };
    window.addEventListener('muxvo:terminal-refit', onRefit);

    // Sidebar activation: receive focus request from overlay
    const onTerminalFocusReq = (e: Event) => {
      const { detail } = e as CustomEvent;
      if (detail === terminalId && !disposed) {
        term.focus();
      }
    };
    window.addEventListener('muxvo:terminal-focus', onTerminalFocusReq);

    // Sidebar activation: receive scroll forwarding from overlay
    const onTerminalScrollReq = (e: Event) => {
      const { detail } = e as CustomEvent<{ id: string; deltaY: number }>;
      if (detail.id === terminalId && !disposed) {
        const lines = Math.round(detail.deltaY / 20);
        if (lines !== 0) term.scrollLines(lines);
      }
    };
    window.addEventListener('muxvo:terminal-scroll', onTerminalScrollReq);

    // Pause cursor blink when window loses focus to reduce idle CPU usage.
    // WebGL renderer's rAF loop runs continuously when cursorBlink is true,
    // even when the window is behind other windows. Pausing the blink
    // eliminates the primary render trigger when user isn't looking at the app.
    const savedCursorBlink = term.options.cursorBlink;
    const onWindowBlur = () => {
      if (!disposed) {
        term.options.cursorBlink = false;
        console.log(`[GLYPH:cursor] ${Date.now()} id=${terminalId.slice(0, 5)} BLINK_PAUSE reason=blur`);
      }
    };
    const onWindowFocus = () => {
      if (!disposed) {
        term.options.cursorBlink = savedCursorBlink ?? true;
        console.log(`[GLYPH:cursor] ${Date.now()} id=${terminalId.slice(0, 5)} BLINK_RESUME reason=focus`);
      }
    };
    const onVisibilityChange = () => {
      if (disposed) return;
      if (document.hidden) {
        term.options.cursorBlink = false;
        console.log(`[GLYPH:cursor] ${Date.now()} id=${terminalId.slice(0, 5)} BLINK_PAUSE reason=visibility`);
      } else {
        term.options.cursorBlink = savedCursorBlink ?? true;
        console.log(`[GLYPH:cursor] ${Date.now()} id=${terminalId.slice(0, 5)} BLINK_RESUME reason=visibility`);
      }
    };
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      clearTimeout(safetyTimer);
      unsubOutput();
      observer.disconnect();
      window.removeEventListener('muxvo:theme-change', onThemeChange);
      window.removeEventListener('muxvo:global-zoom', onGlobalZoom);
      window.removeEventListener('muxvo:terminal-refit', onRefit);
      window.removeEventListener('muxvo:terminal-focus', onTerminalFocusReq);
      window.removeEventListener('muxvo:terminal-scroll', onTerminalScrollReq);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
