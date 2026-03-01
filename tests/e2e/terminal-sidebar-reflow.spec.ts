/**
 * VERIFY: Sidebar terminal should NOT reflow on Tiling → Focused mode switch.
 *
 * Bug: When switching to focused mode, ResizeObserver on sidebar terminals
 * fires fitAddon.fit(), causing xterm buffer rewrap → visible flash.
 *
 * Fix: Guard fitPreservingScroll() with suppressResizeRef in ResizeObserver callback.
 * When compact=true (sidebar), fit is skipped → no reflow → no flash.
 *
 * Assertion: After switching to focused mode, the sidebar terminal's
 * .xterm-screen offsetWidth remains at tiling-mode width (fit did NOT run).
 * Without the fix, offsetWidth shrinks to ~25% sidebar width (fit ran).
 *
 * Run: npx playwright test --config=playwright.verify.config.ts VERIFY-terminal-sidebar-reflow
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const PROJECT = resolve(__dirname, '../..');

test('Sidebar terminal xterm-screen width unchanged after mode switch (no fit → no flash)', async () => {
  const rendererUrl = pathToFileURL(resolve(PROJECT, 'out/renderer/index.html')).href;

  const app = await electron.launch({
    args: ['.'],
    cwd: PROJECT,
    timeout: 30000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  try {
    // ── Step 1: Wait for app to fully load ────────────────────────
    console.log('Step 1: Wait for app to load');
    await expect(page.locator('.menu-bar')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000); // Wait for xterm init + buffer replay

    const initialTiles = await page.locator('.tile').count();
    console.log(`  Initial terminals: ${initialTiles}`);

    // ── Step 2: Ensure at least 2 terminals ───────────────────────
    if (initialTiles < 2) {
      console.log('Step 2: Creating 2nd terminal');
      const addBtn = page.locator('.terminal-grid__fab').first();
      await expect(addBtn).toBeVisible({ timeout: 5000 });
      await addBtn.click();
      await page.waitForTimeout(3000); // Wait for terminal creation + xterm init
    }

    const tileCount = await page.locator('.tile').count();
    expect(tileCount).toBeGreaterThanOrEqual(2);
    console.log(`  Terminals: ${tileCount}`);

    // ── Step 3: Record xterm-screen offsetWidth of 2nd terminal (tiling mode) ──
    console.log('Step 3: Measure xterm-screen in tiling mode');
    const secondTile = page.locator('.tile').nth(1);

    // Wait for xterm-screen to exist inside the tile
    await expect(secondTile.locator('.xterm-screen')).toBeVisible({ timeout: 10000 });

    const widthBefore = await secondTile.locator('.xterm-screen').first().evaluate(
      (el) => el.offsetWidth
    );
    console.log(`  2nd terminal .xterm-screen offsetWidth (tiling): ${widthBefore}px`);
    expect(widthBefore).toBeGreaterThan(100); // Sanity: must be a real terminal

    // ── Step 4: Switch to focused mode (double-click 1st terminal) ──
    // Use evaluate to bypass resize-handle pointer event interception
    console.log('Step 4: Double-click 1st tile → focused mode');
    await page.locator('.tile').first().evaluate((el: HTMLElement) => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await page.waitForTimeout(2000); // Wait for mode switch + any potential fit

    // Verify focused mode is active
    const focusedTiles = await page.locator('.tile-focused').count();
    console.log(`  Focused tiles: ${focusedTiles}`);
    expect(focusedTiles).toBe(1);

    // ── Step 5: CORE ASSERTION — sidebar terminal xterm-screen width ──
    console.log('Step 5: Measure xterm-screen in sidebar (after mode switch)');

    const widthAfter = await secondTile.locator('.xterm-screen').first().evaluate(
      (el) => el.offsetWidth
    );
    console.log(`  2nd terminal .xterm-screen offsetWidth (sidebar): ${widthAfter}px`);

    // With fix: widthAfter ≈ widthBefore (no fit → no reflow)
    // Without fix: widthAfter ≈ 25% of screen (fit adjusted to sidebar container)
    const ratio = widthAfter / widthBefore;
    console.log(`  Width ratio (after/before): ${ratio.toFixed(3)}`);

    // If fit ran, the ratio would be roughly 0.25-0.5 (sidebar is 25% of total).
    // If fit was suppressed, the ratio should be ~1.0 (width unchanged).
    expect(ratio).toBeGreaterThan(0.85);
    console.log('  ✅ Sidebar terminal did NOT reflow — no flash');

    // ── Step 6: CSS animation layer check ──
    // Verify no stale tile-enter animation class on sidebar terminals
    // (tile-enter was a root cause in earlier rounds — regression protection)
    console.log('Step 6: CSS animation class check');
    const sidebarClasses = await secondTile.evaluate(
      (el) => el.querySelector('.tile')?.className ?? ''
    );
    console.log(`  Sidebar tile classes: ${sidebarClasses}`);
    expect(sidebarClasses).not.toContain('tile-enter');
    console.log('  ✅ No stale tile-enter animation on sidebar');

    await page.screenshot({ path: '/tmp/e2e-verify-sidebar-reflow.png' });
    console.log('\n✅ Sidebar reflow test passed!');

  } finally {
    await app.close();
  }
});
