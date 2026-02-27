/**
 * VERIFY-sidebar-scroll — E2E test for focused mode sidebar scroll
 *
 * Verifies:
 * 1. In focused mode with 4+ terminals, the sidebar container has overflowY: auto
 * 2. The sidebar is scrollable (scrollHeight > clientHeight)
 * 3. All sidebar terminal tiles are rendered inside the scroll container
 *
 * Run: npx electron-vite build && npx playwright test --config=playwright.verify.config.ts tests/verify/VERIFY-sidebar-scroll.spec.ts
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const PROJECT = resolve(__dirname, '../..');

test('Focused mode sidebar is scrollable with many terminals', async () => {
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
  await page.waitForTimeout(6000); // Wait for React mount
  await page.waitForLoadState('networkidle');

  try {
    // ── Step 1: Wait for app to load ─────────────────────────────
    console.log('Step 1: Wait for app to load');
    await expect(page.locator('.menu-bar')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    const initialTiles = await page.locator('.tile').count();
    console.log(`  Initial tiles: ${initialTiles}`);

    // ── Step 2: Create terminals until we have 5+ ────────────────
    console.log('Step 2: Create terminals until 5+');
    const addBtn = page.locator('.terminal-grid__fab').first();
    while (await page.locator('.tile').count() < 5) {
      await addBtn.click();
      await page.waitForTimeout(800);
    }
    const totalTiles = await page.locator('.tile').count();
    console.log(`  Total tiles after creation: ${totalTiles}`);
    expect(totalTiles).toBeGreaterThanOrEqual(5);

    // ── Step 3: Double-click first tile to enter focused mode ────
    console.log('Step 3: Enter focused mode via maximize button');
    const maxBtn = page.locator('.tile-max-btn').first();
    await maxBtn.click({ force: true });
    await page.waitForTimeout(1500);

    // Verify focused mode: one tile should have tile-focused class
    const focusedTile = page.locator('.tile-focused');
    await expect(focusedTile).toBeVisible({ timeout: 5000 });
    console.log('  Focused mode active');

    // ── Step 4: Verify sidebar scroll container exists ───────────
    console.log('Step 4: Check sidebar scroll container');

    // The sidebar container should be an absolute-positioned div on the right
    // with overflowY: auto, width: 25%, containing compact tiles
    const sidebarContainer = page.locator('div[style*="overflow-y: auto"][style*="width: 25%"]');
    await expect(sidebarContainer).toBeVisible({ timeout: 5000 });
    console.log('  Sidebar scroll container found');

    // Verify it has overflow-y: auto
    const overflowY = await sidebarContainer.evaluate(el => getComputedStyle(el).overflowY);
    expect(overflowY).toBe('auto');
    console.log(`  overflowY: ${overflowY}`);

    // ── Step 5: Verify sidebar has compact tiles inside ──────────
    console.log('Step 5: Check sidebar tiles');
    // Sidebar should contain (totalTiles - 1) compact tiles (all except focused)
    const sidebarTiles = sidebarContainer.locator('.tile');
    const sidebarCount = await sidebarTiles.count();
    console.log(`  Sidebar tiles: ${sidebarCount}`);
    expect(sidebarCount).toBe(totalTiles - 1);

    // ── Step 6: Verify scrollability ─────────────────────────────
    console.log('Step 6: Check scrollability');
    const scrollInfo = await sidebarContainer.evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    console.log(`  scrollHeight: ${scrollInfo.scrollHeight}, clientHeight: ${scrollInfo.clientHeight}`);
    // With 4+ sidebar terminals at minHeight 150px each, scrollHeight should exceed clientHeight
    expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);
    console.log('  ✅ Sidebar is scrollable');

    // ── Step 7: Verify scroll actually works ─────────────────────
    console.log('Step 7: Test actual scroll');
    await sidebarContainer.evaluate(el => { el.scrollTop = 100; });
    await page.waitForTimeout(200);
    const scrollTop = await sidebarContainer.evaluate(el => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    console.log(`  ✅ Scrolled to: ${scrollTop}px`);

    console.log('All assertions passed!');
  } finally {
    await app.close();
  }
});
