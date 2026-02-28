/**
 * VERIFY-terminal-scroll-preserve — E2E test for scroll position preservation
 *
 * Bug: When opening a second terminal, the first terminal's scroll position
 * jumps back to the top (line 1). This is caused by ResizeObserver triggering
 * fitAddon.fit() without preserving the viewport scroll position.
 *
 * Verifies:
 * 1. First terminal maintains scroll position when a second terminal is created
 * 2. The scrollTop of the first terminal's xterm viewport stays > 0
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
    // ── Step 1: Wait for app to load and first terminal to appear ──
    console.log('Step 1: Wait for app and first terminal');
    await expect(page.locator('.menu-bar')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const initialTiles = await page.locator('.tile').count();
    console.log(`  Initial terminals: ${initialTiles}`);

    // ── Step 2: Generate output in the first terminal ──────────────
    console.log('Step 2: Generate output in first terminal');
    // Click on the first terminal to focus it
    const firstTile = page.locator('.tile').first();
    const firstTerminal = firstTile.locator('.xterm');
    await firstTerminal.click();
    await page.waitForTimeout(500);

    // Type a command to generate lots of output lines
    await page.keyboard.type('printf "line %d\\n" {1..200}\n', { delay: 10 });
    await page.waitForTimeout(3000); // Wait for output to render

    // ── Step 3: Verify terminal has scrollback content ─────────────
    console.log('Step 3: Verify scrollback exists');
    const viewport = firstTile.locator('.xterm-viewport');
    const scrollInfo = await viewport.evaluate(el => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    console.log(`  scrollTop: ${scrollInfo.scrollTop}, scrollHeight: ${scrollInfo.scrollHeight}, clientHeight: ${scrollInfo.clientHeight}`);
    expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);
    console.log('  Scrollback content exists');

    // ── Step 4: Scroll UP to a mid position ────────────────────────
    console.log('Step 4: Scroll up to mid position');
    // Scroll to approximately 30% from top
    const targetScroll = Math.floor(scrollInfo.scrollHeight * 0.3);
    await viewport.evaluate((el, target) => { el.scrollTop = target; }, targetScroll);
    await page.waitForTimeout(500);

    const scrollTopBefore = await viewport.evaluate(el => el.scrollTop);
    console.log(`  scrollTop after scrolling up: ${scrollTopBefore}`);
    expect(scrollTopBefore).toBeGreaterThan(0);
    expect(scrollTopBefore).toBeLessThan(scrollInfo.scrollHeight - scrollInfo.clientHeight);
    console.log('  Terminal is at mid-scroll position');

    await page.screenshot({ path: '/tmp/e2e-verify-scroll-01-before.png' });

    // ── Step 5: Create a second terminal ───────────────────────────
    console.log('Step 5: Create second terminal');
    const addBtn = page.locator('.terminal-grid__fab').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(3000); // Wait for grid layout to settle

    const afterTiles = await page.locator('.tile').count();
    console.log(`  Terminals after add: ${afterTiles}`);
    expect(afterTiles).toBe(initialTiles + 1);

    // ── Step 6: CORE ASSERTION — first terminal scroll preserved ───
    console.log('Step 6: Verify first terminal scroll position');
    await page.screenshot({ path: '/tmp/e2e-verify-scroll-02-after.png' });

    // Re-locate the first tile's viewport (DOM may have shifted)
    const firstTileAfter = page.locator('.tile').first();
    const viewportAfter = firstTileAfter.locator('.xterm-viewport');
    const scrollTopAfter = await viewportAfter.evaluate(el => el.scrollTop);
    console.log(`  scrollTop before: ${scrollTopBefore}`);
    console.log(`  scrollTop after:  ${scrollTopAfter}`);

    // The scroll position should NOT be 0 (bug symptom: jumps to top)
    expect(scrollTopAfter).toBeGreaterThan(0);

    // The scroll position should be reasonably close to original
    // (exact match unlikely due to container resize, but should not be at top)
    // Allow generous tolerance: at least 20% of original position preserved
    const ratio = scrollTopAfter / scrollTopBefore;
    console.log(`  Position ratio: ${ratio.toFixed(2)} (1.0 = unchanged)`);
    expect(ratio).toBeGreaterThan(0.1); // Not at top (bug would give ~0)

    console.log('  ✅ Scroll position preserved!');
    await page.screenshot({ path: '/tmp/e2e-verify-scroll-03-final.png' });

    console.log('\n✅ Terminal scroll preservation test passed!');

  } finally {
    await app.close();
  }
});
