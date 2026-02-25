/**
 * VERIFY-new-terminal-select — E2E test for new terminal auto-select
 *
 * Verifies:
 * 1. Creating a terminal from the terminal tab auto-selects it (tile-selected class)
 * 2. Creating a terminal from a non-terminal tab (Skills) switches back to terminal tab
 *    and auto-selects the new terminal
 *
 * Run: npx electron-vite build && npx playwright test tests/verify/VERIFY-new-terminal-select.spec.ts
 */

import { test, expect, _electron as electron } from '@playwright/test';

test('New terminal is auto-selected after creation', async () => {
  // ── Launch Electron app ────────────────────────────────────────
  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000); // Wait for startup terminals to initialize

  try {
    // ── Step 1: Count existing terminals ─────────────────────────
    console.log('Step 1: Count existing terminals');
    const initialTiles = await page.locator('.tile').count();
    console.log(`  Initial terminals: ${initialTiles}`);

    // Check which terminal is currently selected (if any)
    const initialSelected = await page.locator('.tile-selected').count();
    console.log(`  Initially selected: ${initialSelected}`);

    // ── Step 2: Click + button on terminal tab ──────────────────
    console.log('Step 2: Click + to create new terminal (from terminal tab)');

    // Verify we're on terminal tab
    const terminalTab = page.locator('.menu-bar__tab--active');
    const tabText = await terminalTab.textContent();
    console.log(`  Active tab: ${tabText?.trim()}`);

    // Click the + (FAB) button
    const addBtn = page.locator('.terminal-grid__fab').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    await page.waitForTimeout(1500); // Wait for terminal creation

    // ── Step 3: CORE ASSERTION — new terminal is selected ────────
    console.log('Step 3: Verify new terminal is selected');
    const afterTiles = await page.locator('.tile').count();
    console.log(`  Terminals after add: ${afterTiles}`);
    expect(afterTiles).toBe(initialTiles + 1);

    // The last tile should be the new one and should be selected
    const selectedTiles = page.locator('.tile-selected');
    await expect(selectedTiles).toHaveCount(1, { timeout: 3000 });

    // Verify it's the NEW terminal (the last one added)
    const allTiles = page.locator('.tile');
    const lastTile = allTiles.nth(afterTiles - 1);
    const lastTileClasses = await lastTile.getAttribute('class');
    console.log(`  Last tile classes: ${lastTileClasses}`);
    expect(lastTileClasses).toContain('tile-selected');
    console.log('  ✅ New terminal is selected');

    await page.screenshot({ path: '/tmp/e2e-verify-01-terminal-selected.png' });

    // ── Step 4: Switch to Skills tab ─────────────────────────────
    console.log('Step 4: Switch to Skills tab');
    const skillsTab = page.locator('.menu-bar__tab', { hasText: /Skills/ });
    await expect(skillsTab).toBeVisible({ timeout: 5000 });
    await skillsTab.click();
    await page.waitForTimeout(1000);

    // Verify we're on Skills tab
    const activeAfterSkills = page.locator('.menu-bar__tab--active');
    const skillsTabText = await activeAfterSkills.textContent();
    console.log(`  Active tab after click: ${skillsTabText?.trim()}`);
    expect(skillsTabText?.trim()).toMatch(/Skills/);

    await page.screenshot({ path: '/tmp/e2e-verify-02-skills-tab.png' });

    // ── Step 5: Click + from Skills tab ──────────────────────────
    console.log('Step 5: Click + to create terminal from Skills tab');
    const tilesBeforeSkillsAdd = await page.locator('.tile').count();

    // The FAB button should still be present
    const addBtn2 = page.locator('.terminal-grid__fab').first();
    await expect(addBtn2).toBeVisible({ timeout: 5000 });
    await addBtn2.click();
    await page.waitForTimeout(1500);

    // ── Step 6: CORE ASSERTION — switched back to terminal tab ───
    console.log('Step 6: Verify switched back to terminal tab');
    const activeAfterAdd = page.locator('.menu-bar__tab--active');
    const tabTextAfterAdd = await activeAfterAdd.textContent();
    console.log(`  Active tab after add: ${tabTextAfterAdd?.trim()}`);

    // Terminal tab should be active (none of the other panels are open)
    // In MenuBar.tsx, getActiveTab returns 'terminals' when no panel is open
    expect(tabTextAfterAdd?.trim()).toMatch(/终端|Terminal/);

    await page.screenshot({ path: '/tmp/e2e-verify-03-back-to-terminal.png' });

    // ── Step 7: CORE ASSERTION — new terminal is selected ────────
    console.log('Step 7: Verify new terminal from Skills tab is selected');
    const tilesAfterSkillsAdd = await page.locator('.tile').count();
    console.log(`  Terminals: ${tilesBeforeSkillsAdd} → ${tilesAfterSkillsAdd}`);
    expect(tilesAfterSkillsAdd).toBe(tilesBeforeSkillsAdd + 1);

    const selectedAfterSkills = page.locator('.tile-selected');
    await expect(selectedAfterSkills).toHaveCount(1, { timeout: 3000 });

    // Last tile should be selected
    const lastTile2 = page.locator('.tile').nth(tilesAfterSkillsAdd - 1);
    const lastClasses2 = await lastTile2.getAttribute('class');
    console.log(`  Last tile classes: ${lastClasses2}`);
    expect(lastClasses2).toContain('tile-selected');
    console.log('  ✅ New terminal from Skills tab is selected');

    await page.screenshot({ path: '/tmp/e2e-verify-04-final.png' });
    console.log('\n✅ All new-terminal-select tests passed!');

  } finally {
    await app.close();
  }
});
