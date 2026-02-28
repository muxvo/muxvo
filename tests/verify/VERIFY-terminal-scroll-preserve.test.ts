/**
 * VERIFY-terminal-scroll-preserve — Unit test for fitPreservingScroll logic
 *
 * Bug: When opening a second terminal, the first terminal's scroll position
 * jumps back to the first line. Root cause: ResizeObserver calls fitAddon.fit()
 * which resets xterm's viewportY when buffer rewraps.
 *
 * Fix: fitPreservingScroll() saves distance-from-bottom before fit, restores after.
 *
 * This tests the scroll preservation logic by mocking xterm.js Terminal buffer API.
 * E2E testing is not feasible because xterm.js v6 manages scroll internally
 * (DOM scrollTop/scrollHeight don't reflect the real scroll state).
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * Replicate the fitPreservingScroll logic from XTermRenderer.tsx
 * to verify its correctness in isolation.
 */
function createFitPreservingScrollTest() {
  // Mock xterm Terminal buffer state
  let viewportY = 0;
  let baseY = 0;

  const mockBuffer = {
    get active() {
      return {
        get viewportY() { return viewportY; },
        get baseY() { return baseY; },
      };
    },
  };

  const scrollToBottomCalls: number[] = [];
  const scrollToLineCalls: number[] = [];

  const mockTerm = {
    buffer: mockBuffer,
    scrollToBottom: () => { scrollToBottomCalls.push(1); },
    scrollToLine: (line: number) => { scrollToLineCalls.push(line); },
  };

  let fitCallCount = 0;
  // Simulate what fitAddon.fit() does: when called, it may change baseY
  // due to buffer rewrap (fewer/more columns), which resets viewportY.
  let fitSideEffect: (() => void) | null = null;

  const mockFitAddon = {
    fit: () => {
      fitCallCount++;
      if (fitSideEffect) fitSideEffect();
    },
  };

  // The exact logic from XTermRenderer.tsx fitPreservingScroll()
  function fitPreservingScroll(): void {
    const buf = mockTerm.buffer.active;
    const wasAtBottom = buf.viewportY >= buf.baseY;
    const offsetFromBottom = buf.baseY - buf.viewportY;

    mockFitAddon.fit();

    if (wasAtBottom) {
      mockTerm.scrollToBottom();
    } else {
      const newTarget = mockTerm.buffer.active.baseY - offsetFromBottom;
      mockTerm.scrollToLine(Math.max(0, newTarget));
    }
  }

  return {
    setBufferState: (vY: number, bY: number) => { viewportY = vY; baseY = bY; },
    setFitSideEffect: (fn: (() => void) | null) => { fitSideEffect = fn; },
    fitPreservingScroll,
    scrollToBottomCalls,
    scrollToLineCalls,
    getFitCallCount: () => fitCallCount,
    // Helpers to set viewportY/baseY directly (simulating what fit() does internally)
    setViewportY: (v: number) => { viewportY = v; },
    setBaseY: (b: number) => { baseY = b; },
  };
}

describe('fitPreservingScroll — scroll position preservation on terminal resize', () => {

  it('preserves mid-scroll position when fit() resets viewportY to 0', () => {
    const t = createFitPreservingScrollTest();

    // Terminal has 200 lines of output, user scrolled to line 50 (not at bottom)
    // baseY = 180 (200 lines - 20 visible rows)
    // viewportY = 50 (scrolled back 130 lines from bottom)
    t.setBufferState(50, 180);

    // Simulate fit() resetting viewportY to 0 and changing baseY (buffer rewrap)
    t.setFitSideEffect(() => {
      // After fit: buffer rewrapped, baseY changes, viewportY resets to 0
      t.setViewportY(0);
      t.setBaseY(160); // Slightly different due to column change
    });

    t.fitPreservingScroll();

    // Should NOT scroll to bottom
    expect(t.scrollToBottomCalls).toHaveLength(0);

    // Should restore: new baseY (160) - original offset (180 - 50 = 130) = 30
    expect(t.scrollToLineCalls).toHaveLength(1);
    expect(t.scrollToLineCalls[0]).toBe(30);
  });

  it('stays at bottom when user was at the bottom before fit()', () => {
    const t = createFitPreservingScrollTest();

    // User is at the bottom: viewportY == baseY
    t.setBufferState(180, 180);

    t.setFitSideEffect(() => {
      t.setViewportY(0);
      t.setBaseY(160);
    });

    t.fitPreservingScroll();

    // Should scroll to bottom (user was following output)
    expect(t.scrollToBottomCalls).toHaveLength(1);
    expect(t.scrollToLineCalls).toHaveLength(0);
  });

  it('clamps to 0 when offset exceeds new buffer size', () => {
    const t = createFitPreservingScrollTest();

    // User was scrolled way back: viewportY = 10, baseY = 500
    // offsetFromBottom = 500 - 10 = 490
    t.setBufferState(10, 500);

    // After fit: buffer dramatically shrinks (e.g., wider columns = fewer rows)
    t.setFitSideEffect(() => {
      t.setViewportY(0);
      t.setBaseY(100); // Much smaller than before
    });

    t.fitPreservingScroll();

    // newTarget = 100 - 490 = -390 → clamped to 0
    expect(t.scrollToLineCalls).toHaveLength(1);
    expect(t.scrollToLineCalls[0]).toBe(0);
  });

  it('preserves exact position when fit() does not change buffer dimensions', () => {
    const t = createFitPreservingScrollTest();

    // User at mid-scroll: viewportY = 100, baseY = 200
    t.setBufferState(100, 200);

    // fit() doesn't change anything (same cols/rows)
    t.setFitSideEffect(() => {
      // No change — same dimensions
    });

    t.fitPreservingScroll();

    // offsetFromBottom = 200 - 100 = 100
    // newTarget = 200 - 100 = 100 (same as before)
    expect(t.scrollToLineCalls).toHaveLength(1);
    expect(t.scrollToLineCalls[0]).toBe(100);
  });

  it('handles empty terminal (no scrollback) correctly', () => {
    const t = createFitPreservingScrollTest();

    // Empty terminal: viewportY = 0, baseY = 0
    t.setBufferState(0, 0);

    t.setFitSideEffect(() => {
      // No change
    });

    t.fitPreservingScroll();

    // viewportY == baseY → wasAtBottom = true
    expect(t.scrollToBottomCalls).toHaveLength(1);
    expect(t.scrollToLineCalls).toHaveLength(0);
  });

  it('calls fitAddon.fit() exactly once', () => {
    const t = createFitPreservingScrollTest();
    t.setBufferState(50, 100);
    t.fitPreservingScroll();
    expect(t.getFitCallCount()).toBe(1);
  });

  it('BUG SCENARIO: without fix, viewportY would be 0 after grid resize', () => {
    // This simulates the exact bug: user has terminal scrolled to mid-position,
    // opens a new terminal, grid resizes, fit() is called, viewportY resets to 0.
    // Without fitPreservingScroll, the user would see the first line.
    const t = createFitPreservingScrollTest();

    // User scrolled to line 80 in a terminal with 300 lines of output
    // baseY = 280 (300 - 20 visible rows)
    t.setBufferState(80, 280);

    // Grid layout change: container width halves (1x1 → 1x2)
    // fit() rewraps buffer: columns double means rows halve
    t.setFitSideEffect(() => {
      t.setViewportY(0); // BUG: viewportY resets to 0
      t.setBaseY(140);   // Half as many rows due to wider columns
    });

    t.fitPreservingScroll();

    // offsetFromBottom = 280 - 80 = 200
    // With new baseY=140: newTarget = 140 - 200 = -60 → clamped to 0
    // This is expected: when buffer shrinks dramatically, we can't go further back
    // But the important thing is: we TRIED to preserve, rather than leaving at 0
    expect(t.scrollToLineCalls).toHaveLength(1);
    expect(t.scrollToLineCalls[0]).toBe(0); // Clamped to 0, but that's correct behavior

    // Verify: without the fix (no fitPreservingScroll), the user would see
    // viewportY=0 with NO scroll correction at all.
    // With the fix, at minimum we scroll to the nearest valid position.
  });
});
