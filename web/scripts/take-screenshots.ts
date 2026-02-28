/**
 * Playwright Electron Screenshot Script
 *
 * Automatically takes dark-theme screenshots of Muxvo for the website.
 *
 * Prerequisites: npx electron-vite build
 * Run: npx playwright test web/scripts/take-screenshots.ts --config=playwright.config.ts
 */

import { test, _electron as electron } from '@playwright/test';
import { resolve } from 'path';

const PROJECT = resolve(__dirname, '../..');
const OUTPUT = resolve(__dirname, '../public/screenshots');

test('Take dark-theme screenshots for website', async () => {
  // Launch Electron
  const app = await electron.launch({
    args: ['.'],
    cwd: PROJECT,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000); // Wait for React mount + config load

  // Force dark theme
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(500);

  // Set a large viewport for high-quality screenshots
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  try {
    // ── Screenshot 1: Terminals (default view) ──────────────────
    console.log('📸 Screenshot 1: dark-terminals.jpg');
    // Click Terminals tab to ensure we're on the grid view
    const termTab = page.locator('.menu-bar__tab').first();
    await termTab.click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: resolve(OUTPUT, 'dark-terminals.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-terminals.jpg saved');

    // ── Screenshot 2: Chat History ──────────────────────────────
    console.log('📸 Screenshot 2: dark-chat-history.jpg');
    const chatTab = page.locator('.menu-bar__tab', { hasText: /历史聊天|Chat History/ });
    await chatTab.click();
    await page.waitForTimeout(2000);

    // Wait for chat panel and try to click a session for richer content
    const sessionCard = page.locator('.session-card').first();
    const hasSession = await sessionCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasSession) {
      await sessionCard.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: resolve(OUTPUT, 'dark-chat-history.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-chat-history.jpg saved');

    // ── Screenshot 3: Skills Panel ──────────────────────────────
    console.log('📸 Screenshot 3: dark-skills.jpg');
    const skillsTab = page.locator('.menu-bar__tab', { hasText: 'Skills' });
    await skillsTab.click();
    await page.waitForTimeout(2000);

    // Try to click the first skill for richer content
    const skillItem = page.locator('.skills-panel .skill-item, .skills-list .skill-item, [class*="skill"]').first();
    const hasSkill = await skillItem.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasSkill) {
      await skillItem.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({
      path: resolve(OUTPUT, 'dark-skills.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-skills.jpg saved');

    // ── Screenshot 4: Multi-tool / Terminal with nav bar visible ─
    console.log('📸 Screenshot 4: dark-multi-tool.jpg');
    // Go back to terminals to show the full app with nav bar
    const termTab2 = page.locator('.menu-bar__tab').first();
    await termTab2.click();
    await page.waitForTimeout(1000);

    // This screenshot shows the terminal grid with the full menu bar visible
    // (Terminals, Skills, MCP, Hooks, Plugins, 历史聊天)
    await page.screenshot({
      path: resolve(OUTPUT, 'dark-multi-tool.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-multi-tool.jpg saved');

    console.log('\n✅ All 4 screenshots saved to web/public/screenshots/');
  } finally {
    await app.close();
  }
});
