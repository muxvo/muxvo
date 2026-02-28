/**
 * VERIFY-terminal-scroll-preserve — E2E test for scroll position preservation
 *
 * Bug: When opening a second terminal, the first terminal's scroll position
 * jumps back to the first line. Caused by ResizeObserver → fitAddon.fit()
 * resetting xterm's viewportY without saving/restoring it.
 *
 * Strategy: XTermRenderer exposes xterm's viewportY/baseY via data-viewport-y
 * and data-base-y attributes on the container div. This bypasses xterm.js v6's
 * internal scroll management which doesn't surface in DOM scrollTop.
 *
 * Run: npx electron-vite build && npx playwright test --config=playwright-verify.config.ts tests/verify/VERIFY-terminal-scroll-preserve.spec.ts
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const PROJECT = resolve(__dirname, '../..');

test('Terminal scroll position preserved when creating a new terminal', async () => {
  const rendererUrl = pathToFileURL(resolve(PROJECT, 'out/renderer/index.html')).href;
  const app = await electron.launch({
    args: ['--user-data-dir=/tmp/muxvo-e2e-test', '.'],
    cwd: PROJECT,
    timeout: 30000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(6000);
  await page.waitForLoadState('networkidle');

  try {
    // ── Step 1: Wait for app and first terminal ────────────────────
    console.log('Step 1: Wait for app and first terminal');
    await expect(page.locator('.menu-bar')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000); // Shell init
    const initialTiles = await page.locator('.tile').count();
    console.log(`  Initial terminals: ${initialTiles}`);

    // ── Step 2: Generate output via IPC ────────────────────────────
    console.log('Step 2: Generate output in first terminal');
    const termList = await page.evaluate(async () => {
      const r = await (window as any).api.terminal.list();
      return r?.data ?? r ?? [];
    });
    if (termList.length === 0) { test.skip(); return; }
    const firstTermId = termList[0].id;
    console.log(`  Terminal ID: ${firstTermId}`);

    await page.evaluate(async (id: string) => {
      await (window as any).api.terminal.write(id, 'seq 1 300\n');
    }, firstTermId);
    await page.waitForTimeout(5000);

    // ── Step 3: Read xterm scroll state via data attributes ────────
    console.log('Step 3: Check xterm buffer state via data attrs');
    const firstTile = page.locator('.tile').first();
    // The container div inside XTermRenderer has data-viewport-y and data-base-y
    const xtermContainer = firstTile.locator('[data-viewport-y]');
    const hasDataAttr = await xtermContainer.count();
    console.log(`  data-viewport-y elements found: ${hasDataAttr}`);

    if (hasDataAttr === 0) {
      console.log('  ⚠️ data-viewport-y not found — build may be stale');
      test.skip();
      return;
    }

    const baseY = parseInt(await xtermContainer.getAttribute('data-base-y') ?? '0', 10);
    const viewportY = parseInt(await xtermContainer.getAttribute('data-viewport-y') ?? '0', 10);
    console.log(`  viewportY: ${viewportY}, baseY: ${baseY}`);

    if (baseY === 0) {
      console.log('  ⚠️ No scrollback generated');
      test.skip();
      return;
    }

    // Terminal should be at bottom after seq output
    expect(viewportY).toBe(baseY);
    console.log('  ✅ Terminal at bottom with scrollback');

    // ── Step 4: Scroll up to mid position ──────────────────────────
    console.log('Step 4: Scroll terminal up');
    // Scroll up via xterm's built-in scroll — use mouse wheel on the terminal
    const xtermScreen = firstTile.locator('.xterm-screen');
    await xtermScreen.click();
    await page.waitForTimeout(300);

    // Scroll up significantly (negative deltaY = scroll up)
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -500);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(500);

    const viewportYAfterScroll = parseInt(
      await xtermContainer.getAttribute('data-viewport-y') ?? '0', 10
    );
    const baseYAfterScroll = parseInt(
      await xtermContainer.getAttribute('data-base-y') ?? '0', 10
    );
    console.log(`  After scroll up — viewportY: ${viewportYAfterScroll}, baseY: ${baseYAfterScroll}`);

    // Should have scrolled back (viewportY < baseY)
    if (viewportYAfterScroll >= baseYAfterScroll) {
      console.log('  ⚠️ Mouse wheel scroll did not change viewportY, trying keyboard');
      // Fallback: use Shift+PageUp to scroll
      await page.keyboard.press('Shift+PageUp');
      await page.keyboard.press('Shift+PageUp');
      await page.keyboard.press('Shift+PageUp');
      await page.waitForTimeout(500);
    }

    const viewportYBefore = parseInt(
      await xtermContainer.getAttribute('data-viewport-y') ?? '0', 10
    );
    const baseYBefore = parseInt(
      await xtermContainer.getAttribute('data-base-y') ?? '0', 10
    );
    console.log(`  Final pre-add state — viewportY: ${viewportYBefore}, baseY: ${baseYBefore}`);

    if (viewportYBefore >= baseYBefore) {
      console.log('  ⚠️ Could not scroll terminal up — cannot test preservation');
      test.skip();
      return;
    }

    expect(viewportYBefore).toBeLessThan(baseYBefore);
    console.log('  ✅ Terminal scrolled back from bottom');
    await page.screenshot({ path: '/tmp/e2e-scroll-01-before.png' });

    // ── Step 5: Create second terminal ─────────────────────────────
    console.log('Step 5: Create second terminal');
    const addBtn = page.locator('.terminal-grid__fab').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(4000); // Grid layout + resize settle

    const afterTiles = await page.locator('.tile').count();
    console.log(`  Terminals: ${initialTiles} → ${afterTiles}`);
    expect(afterTiles).toBe(initialTiles + 1);

    // ── Step 6: CORE ASSERTION — viewportY preserved ───────────────
    console.log('Step 6: CORE ASSERTION — scroll position preserved');
    await page.screenshot({ path: '/tmp/e2e-scroll-02-after.png' });

    // Re-locate first tile's xterm container (DOM order preserved by key={t.id})
    const firstTileAfter = page.locator('.tile').first();
    const xtermContainerAfter = firstTileAfter.locator('[data-viewport-y]');

    const viewportYAfter = parseInt(
      await xtermContainerAfter.getAttribute('data-viewport-y') ?? '0', 10
    );
    const baseYAfter = parseInt(
      await xtermContainerAfter.getAttribute('data-base-y') ?? '0', 10
    );
    console.log(`  Before — viewportY: ${viewportYBefore}, baseY: ${baseYBefore}`);
    console.log(`  After  — viewportY: ${viewportYAfter}, baseY: ${baseYAfter}`);

    // BUG symptom: viewportY resets to 0 (first line)
    // FIX assertion: viewportY should still be > 0 and NOT at the top
    expect(viewportYAfter).toBeGreaterThan(0);

    // viewportY should still be away from bottom (user didn't scroll down)
    expect(viewportYAfter).toBeLessThan(baseYAfter);

    // The offset-from-bottom should be approximately preserved
    const offsetBefore = baseYBefore - viewportYBefore;
    const offsetAfter = baseYAfter - viewportYAfter;
    console.log(`  Offset from bottom — before: ${offsetBefore}, after: ${offsetAfter}`);

    // Allow some tolerance for buffer rewrap, but should be in same ballpark
    // Bug would give offsetAfter ≈ baseYAfter (at top), fix preserves offsetBefore
    expect(Math.abs(offsetAfter - offsetBefore)).toBeLessThan(offsetBefore * 0.5);

    console.log('  ✅ Scroll position preserved!');
    await page.screenshot({ path: '/tmp/e2e-scroll-03-final.png' });
    console.log('\n✅ Terminal scroll preservation E2E test passed!');

  } finally {
    await app.close();
  }
});
