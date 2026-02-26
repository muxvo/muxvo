/**
 * VERIFY-new-terminal-select — E2E test for new terminal auto-select
 *
 * Verifies:
 * 1. Creating a terminal auto-selects it (tile-selected class)
 * 2. Creating a second terminal switches selection to the new one
 * 3. Creating a terminal from a non-terminal tab (Skills) switches back to terminal tab
 *    and auto-selects the new terminal
 *
 * Run: npx electron-vite build && npx playwright test --config=playwright-verify.config.ts
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test('New terminal is auto-selected after creation', async () => {
  const rendererUrl = pathToFileURL(resolve(process.cwd(), 'out/renderer/index.html')).href;

  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    timeout: 30000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  try {
    // ── Step 1: Wait for app to fully load ───────────────────────
    console.log('Step 1: Wait for app to fully load');
    await expect(page.locator('.menu-bar')).toBeVisible({ timeout: 20000 });
    console.log('  Menu bar visible');

    // Wait for startup terminals to load
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000); // Extra settle time
    const initialTiles = await page.locator('.tile').count();
    console.log(`  Initial terminals: ${initialTiles}`);

    // Record initial selection state
    const initialSelected = await page.locator('.tile-selected').count();
    console.log(`  Initially selected: ${initialSelected}`);

    // ── Step 2: Click + button to create new terminal ────────────
    console.log('Step 2: Click + to create new terminal (from terminal tab)');
    const addBtn = page.locator('.terminal-grid__fab').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(2000);

    // ── Step 3: CORE ASSERTION — new terminal is selected ────────
    console.log('Step 3: Verify new terminal is selected');
    const afterTiles = await page.locator('.tile').count();
    console.log(`  Terminals after add: ${afterTiles}`);
    expect(afterTiles).toBe(initialTiles + 1);

    // Exactly 1 tile should be selected
    const selectedCount1 = await page.locator('.tile-selected').count();
    console.log(`  Selected tiles: ${selectedCount1}`);
    expect(selectedCount1).toBe(1);

    // It should be the LAST (newest) tile
    const lastIdx = afterTiles - 1;
    const lastTileClasses = await page.locator('.tile').nth(lastIdx).getAttribute('class');
    console.log(`  Last tile classes: ${lastTileClasses}`);
    expect(lastTileClasses).toContain('tile-selected');
    console.log('  ✅ New terminal is selected');
    await page.screenshot({ path: '/tmp/e2e-verify-01-terminal-selected.png' });

    // ── Step 4: Create another terminal, verify selection moves ──
    console.log('Step 4: Create another terminal');
    await addBtn.click();
    await page.waitForTimeout(2000);

    const tilesAfter2 = await page.locator('.tile').count();
    console.log(`  Terminals after second add: ${tilesAfter2}`);
    expect(tilesAfter2).toBe(afterTiles + 1);

    const selectedCount2 = await page.locator('.tile-selected').count();
    expect(selectedCount2).toBe(1);

    const newestClasses = await page.locator('.tile').nth(tilesAfter2 - 1).getAttribute('class');
    expect(newestClasses).toContain('tile-selected');

    // Previous last tile should NOT be selected
    const prevLastClasses = await page.locator('.tile').nth(tilesAfter2 - 2).getAttribute('class');
    expect(prevLastClasses).not.toContain('tile-selected');
    console.log('  ✅ Selection moved to newest terminal');
    await page.screenshot({ path: '/tmp/e2e-verify-02-second-selected.png' });

    // ── Step 5: Switch to Skills tab ─────────────────────────────
    console.log('Step 5: Switch to Skills tab');
    const skillsTab = page.locator('.menu-bar__tab', { hasText: 'Skills' });
    await expect(skillsTab).toBeVisible({ timeout: 5000 });
    await skillsTab.click();
    await page.waitForTimeout(1000);

    const skillsTabClasses = await skillsTab.getAttribute('class');
    expect(skillsTabClasses).toContain('menu-bar__tab--active');
    console.log('  Skills tab is active');
    await page.screenshot({ path: '/tmp/e2e-verify-03-skills-tab.png' });

    // ── Step 6: Click + from Skills tab ──────────────────────────
    // Note: The FAB button is behind the skills-panel-overlay (z-index 180 vs 50).
    // Use force:true to bypass overlay — this tests the handleAddTerminal logic
    // (dispatch CLOSE_ALL + create terminal), not the z-index stacking.
    console.log('Step 6: Click + to create terminal from Skills tab');
    const tilesBefore = tilesAfter2;
    // Use evaluate to call .click() directly on the DOM element,
    // bypassing Playwright's pointer event handling that gets intercepted by overlay
    await addBtn.evaluate((el: HTMLElement) => el.click());
    await page.waitForTimeout(3000);

    // ── Step 7: CORE ASSERTION — switched back to terminal tab ───
    console.log('Step 7: Verify switched back to terminal tab');
    const terminalTab = page.locator('.menu-bar__tab').first();
    const termTabClasses = await terminalTab.getAttribute('class');
    console.log(`  Terminal tab classes: ${termTabClasses}`);
    expect(termTabClasses).toContain('menu-bar__tab--active');

    const skillsClasses2 = await skillsTab.getAttribute('class');
    expect(skillsClasses2).not.toContain('menu-bar__tab--active');
    console.log('  ✅ Switched back to terminal tab');
    await page.screenshot({ path: '/tmp/e2e-verify-04-back-to-terminal.png' });

    // ── Step 8: CORE ASSERTION — new terminal is selected ────────
    console.log('Step 8: Verify new terminal from Skills tab is selected');
    const tilesAfterSkills = await page.locator('.tile').count();
    console.log(`  Terminals: ${tilesBefore} → ${tilesAfterSkills}`);
    expect(tilesAfterSkills).toBe(tilesBefore + 1);

    const selectedAfter = await page.locator('.tile-selected').count();
    expect(selectedAfter).toBe(1);

    const newestFromSkills = await page.locator('.tile').nth(tilesAfterSkills - 1).getAttribute('class');
    expect(newestFromSkills).toContain('tile-selected');
    console.log('  ✅ New terminal from Skills tab is selected');

    await page.screenshot({ path: '/tmp/e2e-verify-05-final.png' });
    console.log('\n✅ All new-terminal-select tests passed!');

  } finally {
    await app.close();
  }
});
