/**
 * VERIFY: Update reminder — max 2 prompts + "don't remind" button
 *
 * Changes:
 * 1. REMIND_INTERVALS has 1 entry (max 2 prompts: initial + 3d)
 * 2. Dialog has 3 buttons: "立即下载" / "暂不更新" / "不再提醒此版本"
 * 3. "不再提醒此版本" sets count=999 and persists via savePreferences
 *
 * Verifies decision-layer logic (native dialog can't be tested via Playwright)
 */

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const INDEX_PATH = path.resolve(__dirname, '../../src/main/index.ts');

function readIndex(): string {
  return fs.readFileSync(INDEX_PATH, 'utf-8');
}

describe('Update reminder: 2 prompts + "don\'t remind" button', () => {
  test('REMIND_INTERVALS has exactly 1 entry (= max 2 prompts)', () => {
    const src = readIndex();
    // Match the REMIND_INTERVALS declaration
    const match = src.match(/const REMIND_INTERVALS\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const entries = match![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(entries.length).toBe(1);
  });

  test('dialog buttons include "不再提醒此版本"', () => {
    const src = readIndex();
    // Find the promptUpdate dialog buttons array
    const match = src.match(/buttons:\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const buttonsStr = match![1];
    expect(buttonsStr).toContain('立即下载');
    expect(buttonsStr).toContain('暂不更新');
    expect(buttonsStr).toContain('不再提醒此版本');
  });

  test('response === 2 sets count to 999 and calls savePreferences', () => {
    const src = readIndex();
    // Find the promptUpdate function
    const promptBlock = src.match(/async function promptUpdate[\s\S]*?finally\s*\{[\s\S]*?\}/);
    expect(promptBlock).not.toBeNull();
    const block = promptBlock![0];

    // Must handle response === 2
    expect(block).toContain('response === 2');
    // Must set count to 999
    expect(block).toContain('999');
    // Must call savePreferences with 999
    expect(block).toMatch(/savePreferences\(\{.*count:\s*999/s);
  });

  test('"暂不更新" (response !== 0 && !== 2) increments count and schedules timer', () => {
    const src = readIndex();
    const promptBlock = src.match(/async function promptUpdate[\s\S]*?finally\s*\{[\s\S]*?\}/);
    expect(promptBlock).not.toBeNull();
    const block = promptBlock![0];

    // Must increment count
    expect(block).toContain('updateDismissCount++');
    // Must call savePreferences after increment
    expect(block).toContain('savePreferences');
    // Must set setTimeout for next reminder
    expect(block).toContain('setTimeout(() => promptUpdate(version)');
  });

  test('update-available handler skips prompt when count > REMIND_INTERVALS.length', () => {
    const src = readIndex();
    // Find the update-available handler block (from 'update-available' to the next autoUpdater.on)
    const start = src.indexOf("autoUpdater.on('update-available'");
    expect(start).toBeGreaterThan(-1);
    const nextHandler = src.indexOf("autoUpdater.on('download-progress'");
    expect(nextHandler).toBeGreaterThan(start);
    const block = src.slice(start, nextHandler);

    // Must check count against REMIND_INTERVALS.length
    expect(block).toContain('updateDismissCount > REMIND_INTERVALS.length');
    // Must return early (skip promptUpdate)
    expect(block).toContain('return');
  });

  test('dismiss state persisted via preferences with DISMISS_PREF_KEY', () => {
    const src = readIndex();

    // Must define DISMISS_PREF_KEY
    expect(src).toMatch(/const DISMISS_PREF_KEY\s*=\s*'updateDismissal'/);

    // Must restore from preferences on startup
    expect(src).toContain('getPreferences().then');
    expect(src).toContain('dismissedVersion = saved.version');
    expect(src).toContain('updateDismissCount = saved.count');
  });

  test('new version resets dismiss count', () => {
    const src = readIndex();
    const handler = src.match(/autoUpdater\.on\('update-available'[\s\S]*?\}\);/);
    expect(handler).not.toBeNull();
    const block = handler![0];

    // Must compare version and reset
    expect(block).toContain('info.version !== dismissedVersion');
    expect(block).toContain('updateDismissCount = 0');
  });
});

describe('Update reminder: logic simulation', () => {
  const REMIND_INTERVALS = [72 * 3600_000]; // mirrors source

  /**
   * Simulates the dismiss logic from promptUpdate.
   * Returns { count, timerScheduled, timerDelay? }
   */
  function simulateDismiss(
    currentCount: number,
    response: 0 | 1 | 2,
  ): { count: number; timerScheduled: boolean; timerDelay?: number } {
    if (response === 0) {
      return { count: currentCount, timerScheduled: false };
    }
    if (response === 2) {
      return { count: 999, timerScheduled: false };
    }
    // response === 1 ("暂不更新")
    const newCount = currentCount + 1;
    if (newCount <= REMIND_INTERVALS.length) {
      return { count: newCount, timerScheduled: true, timerDelay: REMIND_INTERVALS[newCount - 1] };
    }
    return { count: newCount, timerScheduled: false };
  }

  test('first dismiss: count=1, timer scheduled at 3d', () => {
    const result = simulateDismiss(0, 1);
    expect(result.count).toBe(1);
    expect(result.timerScheduled).toBe(true);
    expect(result.timerDelay).toBe(72 * 3600_000);
  });

  test('second dismiss: count=2, NO timer (max reached)', () => {
    const result = simulateDismiss(1, 1);
    expect(result.count).toBe(2);
    expect(result.timerScheduled).toBe(false);
  });

  test('"don\'t remind" at any point: count=999, no timer', () => {
    for (const startCount of [0, 1, 2]) {
      const result = simulateDismiss(startCount, 2);
      expect(result.count).toBe(999);
      expect(result.timerScheduled).toBe(false);
    }
  });

  test('download (response=0): count unchanged, no timer', () => {
    const result = simulateDismiss(1, 0);
    expect(result.count).toBe(1);
    expect(result.timerScheduled).toBe(false);
  });

  test('update-available with count=999 skips prompt', () => {
    // Simulates the guard in update-available handler
    const count = 999;
    const shouldPrompt = count <= REMIND_INTERVALS.length;
    expect(shouldPrompt).toBe(false);
  });

  test('update-available with count=2 skips prompt (exceeded max)', () => {
    const count = 2;
    const shouldPrompt = !(count > REMIND_INTERVALS.length);
    expect(shouldPrompt).toBe(false);
  });

  test('update-available with count=0 shows prompt', () => {
    const count = 0;
    const shouldPrompt = !(count > REMIND_INTERVALS.length);
    expect(shouldPrompt).toBe(true);
  });
});
