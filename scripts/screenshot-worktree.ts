/**
 * screenshot-worktree.ts — Playwright E2E script to capture Worktree feature screenshots.
 *
 * Prerequisites: `npx electron-vite dev` must be running (Vite on port 5173).
 *
 * Usage: npx tsx scripts/screenshot-worktree.ts
 */

import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'path';
import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const PROJECT = resolve(__dirname, '..');
const OUT_DIR = resolve(PROJECT, 'docs/screenshots/worktree');
const TEMP_USER_DATA = mkdtempSync(resolve(tmpdir(), 'muxvo-screenshot-'));

mkdirSync(OUT_DIR, { recursive: true });

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('Launching Electron...');
  const app: ElectronApplication = await _electron.launch({
    args: [resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
    },
  });

  const window: Page = await app.firstWindow();

  // Wait for React to mount
  console.log('Waiting for React mount...');
  await window.waitForTimeout(8000);
  await window.waitForLoadState('networkidle');

  // If no terminal tiles yet (empty state), click the "+" FAB to create one
  const hasTile = await window.locator('.tile-header').isVisible().catch(() => false);
  if (!hasTile) {
    console.log('No terminal yet, clicking + button...');
    // The FAB button is the large "+" in bottom-right corner
    const fab = window.locator('.terminal-grid__fab').first();
    if (await fab.isVisible().catch(() => false)) {
      await fab.click();
      await sleep(4000);
    }
  }
  await window.waitForSelector('.tile-header', { timeout: 20000 });
  console.log('Terminal tile found.');

  // ── Shot 1: Full window showing terminal with branch icon ──
  console.log('Taking shot-01: full window with branch icon...');
  await window.screenshot({
    path: resolve(OUT_DIR, 'shot-01-full-window.png'),
  });

  // Find and click the worktree button (branch icon)
  const worktreeBtn = window.locator('.tile-worktree-btn').first();
  const hasBranchBtn = await worktreeBtn.isVisible().catch(() => false);

  if (!hasBranchBtn) {
    console.warn('No worktree button visible — terminal may not be in a git repo.');
    console.warn('Skipping interactive screenshots.');
    await app.close();
    return;
  }

  // ── Shot 2: Click branch icon → Worktree popover (initial, only main) ──
  console.log('Taking shot-02: worktree popover...');
  await worktreeBtn.click();
  await sleep(800);

  // Screenshot the popover element
  const popover = window.locator('.worktree-popover');
  await popover.waitFor({ state: 'visible', timeout: 5000 });

  await window.screenshot({
    path: resolve(OUT_DIR, 'shot-02-popover-initial.png'),
  });

  // Also capture just the popover
  await popover.screenshot({
    path: resolve(OUT_DIR, 'shot-02-popover-closeup.png'),
  });

  // ── Shot 3: Create a new worktree ──
  console.log('Creating new worktree...');
  const createBtn = window.locator('.worktree-popover__create');
  if (await createBtn.isVisible()) {
    await createBtn.click();

    // Wait for new terminal to appear and settle
    await sleep(3000);

    console.log('Taking shot-03: after creating worktree...');
    await window.screenshot({
      path: resolve(OUT_DIR, 'shot-03-after-create.png'),
    });

    // ── Shot 5: Worktree badge close-up ──
    const badge = window.locator('.tile-worktree-badge').first();
    if (await badge.isVisible().catch(() => false)) {
      console.log('Taking shot-05: worktree badge...');
      // Get bounding box and capture with some surrounding context
      const header = window.locator('.tile-header').first();
      await header.screenshot({
        path: resolve(OUT_DIR, 'shot-05-worktree-badge.png'),
      });
    }

    // ── Shot 4: Open popover again to show list with current badge ──
    console.log('Taking shot-04: popover with worktree list...');
    const worktreeBtn2 = window.locator('.tile-worktree-btn').first();
    if (await worktreeBtn2.isVisible().catch(() => false)) {
      await worktreeBtn2.click();
      await sleep(800);

      const popover2 = window.locator('.worktree-popover');
      await popover2.waitFor({ state: 'visible', timeout: 5000 });

      await window.screenshot({
        path: resolve(OUT_DIR, 'shot-04-popover-list.png'),
      });

      await popover2.screenshot({
        path: resolve(OUT_DIR, 'shot-04-popover-list-closeup.png'),
      });

      // Close popover
      await window.keyboard.press('Escape');
      await sleep(300);
    }
  } else {
    console.warn('Create button not visible, skipping create/list screenshots.');
  }

  console.log('All screenshots saved to:', OUT_DIR);
  console.log('Done! Closing Electron...');
  await app.close();
}

main().catch((err) => {
  console.error('Screenshot script failed:', err);
  process.exit(1);
});
