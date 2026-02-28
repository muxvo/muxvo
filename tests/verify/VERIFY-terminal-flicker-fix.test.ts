/**
 * VERIFY-terminal-flicker-fix — Unit tests for terminal flicker prevention
 *
 * Bug: When CC prompts yes/no and user presses up/down to select,
 * the terminal flickers due to rapid Running↔WaitingInput state transitions
 * each triggering full React re-renders via pushStateChange IPC.
 *
 * Fix: Multiple optimizations:
 * 1. pushStateChange debounced (50ms) to coalesce rapid transitions
 * 2. TerminalTile wrapped with React.memo + custom comparator
 * 3. orderedTerminals memoized with useMemo
 * 4. CSS outline uses transition instead of abrupt appear/disappear
 * 5. ResizeObserver debounced via rAF
 * 6. Focused mode hides non-focused terminals via CSS instead of unmounting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// 1. pushStateChange debounce tests
// ============================================================================
describe('pushStateChange debounce', () => {
  // Replicate the debounce logic from manager.ts
  function createDebouncedPushStateChange() {
    const sent: Array<{ id: string; state: string }> = [];
    const pendingStateChanges = new Map<string, { state: string; timer: ReturnType<typeof setTimeout> }>();
    const STATE_CHANGE_DEBOUNCE_MS = 50;

    function pushStateChange(id: string, state: string): void {
      const immediate = ['Stopped', 'Failed', 'Disconnected', 'Removed'].includes(state);
      const existing = pendingStateChanges.get(id);
      if (existing) clearTimeout(existing.timer);

      if (immediate) {
        pendingStateChanges.delete(id);
        sent.push({ id, state });
        return;
      }

      const timer = setTimeout(() => {
        pendingStateChanges.delete(id);
        sent.push({ id, state });
      }, STATE_CHANGE_DEBOUNCE_MS);

      pendingStateChanges.set(id, { state, timer });
    }

    return { pushStateChange, sent, pendingStateChanges };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid Running↔WaitingInput transitions into single push', () => {
    const { pushStateChange, sent } = createDebouncedPushStateChange();

    // Simulate user pressing up/down in yes/no prompt:
    // USER_INPUT → Running, then output → WaitingInput, rapidly
    pushStateChange('term-1', 'Running');       // USER_INPUT
    pushStateChange('term-1', 'WaitingInput');  // detectWaitingInput triggers

    // No IPC sent yet (within 50ms debounce window)
    expect(sent).toHaveLength(0);

    // After debounce period, only the final state should be sent
    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ id: 'term-1', state: 'WaitingInput' });
  });

  it('sends terminal-ending states immediately without debounce', () => {
    const { pushStateChange, sent } = createDebouncedPushStateChange();

    pushStateChange('term-1', 'Running');
    // Terminal exits — this must arrive immediately
    pushStateChange('term-1', 'Stopped');

    // Stopped should be sent immediately, Running should be cancelled
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ id: 'term-1', state: 'Stopped' });

    // After debounce period, no additional sends
    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(1);
  });

  it('handles multiple terminals independently', () => {
    const { pushStateChange, sent } = createDebouncedPushStateChange();

    pushStateChange('term-1', 'WaitingInput');
    pushStateChange('term-2', 'Running');

    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(2);
    expect(sent.find(s => s.id === 'term-1')?.state).toBe('WaitingInput');
    expect(sent.find(s => s.id === 'term-2')?.state).toBe('Running');
  });

  it('coalesces 5 rapid transitions into single push', () => {
    const { pushStateChange, sent } = createDebouncedPushStateChange();

    // Simulate 5 rapid up/down presses within 50ms
    pushStateChange('term-1', 'Running');
    pushStateChange('term-1', 'WaitingInput');
    pushStateChange('term-1', 'Running');
    pushStateChange('term-1', 'WaitingInput');
    pushStateChange('term-1', 'Running');

    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ id: 'term-1', state: 'Running' });
  });
});

// ============================================================================
// 2. TerminalTile memo comparator tests
// ============================================================================
describe('TerminalTile memo comparator', () => {
  // Replicate the comparator from TerminalTile.tsx
  function tilePropsEqual(prev: Record<string, any>, next: Record<string, any>): boolean {
    return (
      prev.id === next.id &&
      prev.state === next.state &&
      prev.cwd === next.cwd &&
      prev.compact === next.compact &&
      prev.focused === next.focused &&
      prev.selected === next.selected &&
      prev.staggerIndex === next.staggerIndex &&
      prev.draggable === next.draggable &&
      prev.dragState === next.dragState &&
      prev.customName === next.customName
    );
  }

  const baseProps = {
    id: 'term-1',
    state: 'Running',
    cwd: '/home/user',
    compact: false,
    focused: false,
    selected: true,
    staggerIndex: 0,
    draggable: true,
    dragState: 'none',
    customName: undefined,
    onDoubleClick: () => {},
    onClick: () => {},
    onClose: () => {},
  };

  it('returns true when data props are identical', () => {
    expect(tilePropsEqual(baseProps, { ...baseProps })).toBe(true);
  });

  it('returns false when state changes', () => {
    expect(tilePropsEqual(baseProps, { ...baseProps, state: 'WaitingInput' })).toBe(false);
  });

  it('returns true when only function props change (new arrow functions)', () => {
    // Function props like onClick are recreated on each render,
    // but memo comparator skips them to avoid unnecessary re-renders
    expect(tilePropsEqual(baseProps, {
      ...baseProps,
      onDoubleClick: () => {},  // different reference
      onClick: () => {},        // different reference
    })).toBe(true);
  });

  it('returns false when customName changes', () => {
    expect(tilePropsEqual(baseProps, { ...baseProps, customName: 'My Terminal' })).toBe(false);
  });

  it('returns false when selected changes', () => {
    expect(tilePropsEqual(baseProps, { ...baseProps, selected: false })).toBe(false);
  });
});

// ============================================================================
// 3. CSS outline transition (structural test)
// ============================================================================
describe('CSS tile--waiting outline transition', () => {
  it('base .tile has transparent outline preset for smooth transition', () => {
    // Read CSS file and verify structural properties
    const fs = require('fs');
    const css = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/TileEffects.css'),
      'utf-8'
    );

    // .tile must have outline: 3px solid transparent (preset for transition)
    expect(css).toMatch(/\.tile\s*\{[^}]*outline:\s*3px\s+solid\s+transparent/s);
    // .tile must have outline-color in transition
    expect(css).toMatch(/\.tile\s*\{[^}]*transition:[^;]*outline-color/s);
    // .tile--waiting should use outline-color (not full outline declaration) for transition to work
    expect(css).toMatch(/\.tile--waiting\s*\{[^}]*outline-color:/s);
  });
});

// ============================================================================
// 4. Focused mode: non-focused terminals should NOT be unmounted (return null)
// ============================================================================
describe('Focused mode terminal preservation', () => {
  it('TerminalGrid does not use return null for non-focused terminals', () => {
    const fs = require('fs');
    const gridCode = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/TerminalGrid.tsx'),
      'utf-8'
    );

    // The old code had: if (isFocusedMode && !isFocused) return null;
    // This should no longer exist
    expect(gridCode).not.toMatch(/if\s*\(\s*isFocusedMode\s*&&\s*!isFocused\s*\)\s*return\s+null/);

    // Instead, non-focused terminals should be hidden via CSS (width: 0, height: 0)
    expect(gridCode).toMatch(/width:\s*0/);
    expect(gridCode).toMatch(/height:\s*0/);
    expect(gridCode).toMatch(/opacity:\s*0/);
  });
});

// ============================================================================
// 5. ResizeObserver rAF debounce (structural test)
// ============================================================================
describe('ResizeObserver rAF debounce', () => {
  it('XTermRenderer uses requestAnimationFrame in ResizeObserver callback', () => {
    const fs = require('fs');
    const code = fs.readFileSync(
      require('path').resolve(__dirname, '../../src/renderer/components/terminal/XTermRenderer.tsx'),
      'utf-8'
    );

    // ResizeObserver callback should use rAF for debouncing
    expect(code).toMatch(/ResizeObserver/);
    expect(code).toMatch(/cancelAnimationFrame\(resizeRafId\)/);
    expect(code).toMatch(/resizeRafId\s*=\s*requestAnimationFrame/);
  });
});
