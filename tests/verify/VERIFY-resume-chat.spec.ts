/**
 * VERIFY-resume-chat — E2E test for Resume Chat feature
 *
 * Verifies:
 * 1. Resume button is visible in SessionDetail for CC sessions
 * 2. Clicking the button closes chat panel and creates a new terminal
 *
 * Run: npx playwright test tests/verify/VERIFY-resume-chat.spec.ts --config=playwright-verify.config.ts
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'path';

const PROJECT = resolve(__dirname, '../..');

test('Resume Chat: button visible for CC session and click creates terminal', async () => {
  const app = await electron.launch({
    args: [resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    timeout: 30000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
    },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(6000);
  await page.waitForLoadState('networkidle');

  try {
    // ── Debug: capture initial page state ──────────────────────
    await page.screenshot({ path: '/tmp/e2e-resume-debug-init.png' });
    const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
    const url = page.url();
    console.log(`  DEBUG: url=${url}, body.innerHTML.length=${bodyLen}`);
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    // ── Step 1: Wait for app to fully load ─────────────────────
    console.log('Step 1: Wait for app to fully load');
    await expect(page.locator('.menu-bar')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.tile').first()).toBeVisible({ timeout: 15000 });
    const initialTiles = await page.locator('.tile').count();
    console.log(`  Initial terminals: ${initialTiles}`);

    // ── Step 2: Navigate to Chat History tab ───────────────────
    console.log('Step 2: Navigate to Chat History tab');
    const chatTab = page.locator('.menu-bar__tab', { hasText: /历史聊天|Chat History/ });
    await expect(chatTab).toBeVisible({ timeout: 10000 });
    await chatTab.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.chat-history-panel')).toBeVisible({ timeout: 10000 });
    console.log('  ✅ Chat history panel visible');
    await page.screenshot({ path: '/tmp/e2e-resume-01-chat-panel.png' });

    // ── Step 3: Wait for sessions to load ──────────────────────
    console.log('Step 3: Wait for sessions to load');
    await expect(page.locator('.session-card').first()).toBeVisible({ timeout: 20000 });
    const cardCount = await page.locator('.session-card').count();
    console.log(`  ✅ ${cardCount} session cards loaded`);

    // ── Step 4: Click on a session card to open detail ─────────
    console.log('Step 4: Click on a session card');
    await page.locator('.session-card').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/e2e-resume-02-session-detail.png' });

    // ── Step 5: CORE ASSERTION — resume button is visible ──────
    console.log('Step 5: Verify resume button is visible');
    const resumeBtn = page.locator('.session-detail__resume-btn');
    await expect(resumeBtn).toBeVisible({ timeout: 5000 });
    console.log('  ✅ Resume button is visible');
    await page.screenshot({ path: '/tmp/e2e-resume-03-resume-btn.png' });

    // ── Step 6: Click resume button ────────────────────────────
    console.log('Step 6: Click resume button');
    await resumeBtn.click();
    await page.waitForTimeout(2000);

    // ── Step 7: CORE ASSERTION — chat panel closed ─────────────
    console.log('Step 7: Verify chat panel closed');
    await expect(page.locator('.chat-history-panel')).not.toBeVisible({ timeout: 5000 });
    console.log('  ✅ Chat panel closed');

    // ── Step 8: CORE ASSERTION — new terminal created ──────────
    console.log('Step 8: Verify new terminal created');
    await expect(page.locator('.tile')).toHaveCount(initialTiles + 1, { timeout: 5000 });
    console.log(`  ✅ Terminal count: ${initialTiles} → ${initialTiles + 1}`);
    await page.screenshot({ path: '/tmp/e2e-resume-04-terminal-created.png' });

    console.log('\n✅ All resume-chat tests passed!');

  } finally {
    await app.close();
  }
});
