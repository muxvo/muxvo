/**
 * Playwright Electron Screenshot Script — v4
 *
 * Takes dark-theme screenshots of Muxvo for the website.
 * - Forces xterm dark theme via muxvo:theme-change event
 * - Creates multiple terminals via .terminal-grid__fab button
 * - Triggers focused mode via double-click on terminal tile
 * - Blurs chat content for privacy
 *
 * Prerequisites: npx electron-vite build
 * Run: npx tsx web/scripts/take-screenshots.ts
 */

import { _electron as electron } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT = resolve(__dirname, '../..');
const OUTPUT = resolve(__dirname, '../public/screenshots');
const RENDERER_DIR = resolve(PROJECT, 'out/renderer');

async function startStaticServer(): Promise<ChildProcess> {
  const server = spawn('npx', ['serve', RENDERER_DIR, '-l', '5173', '--no-clipboard'], {
    cwd: PROJECT,
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
    const check = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:5173');
        if (res.ok || res.status === 200 || res.status === 304) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      } catch { /* not ready yet */ }
    }, 300);
  });
  return server;
}

/** Force xterm dark theme via the app's custom event */
async function forceXtermDarkTheme(page: any) {
  await page.evaluate(() => {
    // Dispatch the app's theme-change event so xterm picks up dark theme
    window.dispatchEvent(new CustomEvent('muxvo:theme-change', {
      detail: { theme: 'dark' },
    }));
  });
  await page.waitForTimeout(500);
}

async function main() {
  console.log('Starting static server for renderer...');
  const server = await startStaticServer();
  console.log('Static server ready on :5173');

  console.log('Launching Muxvo...');
  const app = await electron.launch({
    args: ['.'],
    cwd: PROJECT,
    timeout: 30000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(6000); // Wait for React mount + data load

  // Force dark theme on the whole app
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // Force xterm dark theme
  await forceXtermDarkTheme(page);

  try {
    // ════════════════════════════════════════════════════════════
    // Screenshot 1: Chat History with blurred content + resume bar
    // ════════════════════════════════════════════════════════════
    console.log('📸 Screenshot 1: dark-resume-chat.jpg');
    const chatTab = page.locator('.menu-bar__tab', { hasText: /历史聊天|Chat/ });
    await chatTab.click();
    await page.waitForTimeout(3000);

    // Click first session to show detail + resume bar
    const sessionCards = page.locator('.session-card');
    const cardCount = await sessionCards.count();
    console.log(`  Found ${cardCount} session cards`);
    if (cardCount > 0) {
      await sessionCards.first().click();
      await page.waitForTimeout(3000);
    }

    // Blur chat content for privacy
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'privacy-blur';
      style.textContent = `
        .session-card__title,
        .session-card__preview,
        .session-card__snippet { filter: blur(4px) !important; }
        .message-bubble__text,
        .message-bubble__content,
        .message-content,
        [class*="message"] p,
        [class*="message"] pre,
        [class*="message"] code,
        .session-detail__messages .msg__body,
        .session-detail__messages .msg__text { filter: blur(4px) !important; }
        .project-item__name { filter: blur(3px) !important; }
      `;
      document.head.appendChild(style);
    });
    await page.waitForTimeout(300);

    await page.screenshot({
      path: resolve(OUTPUT, 'dark-resume-chat.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-resume-chat.jpg saved');

    // Remove blur
    await page.evaluate(() => document.getElementById('privacy-blur')?.remove());

    // ════════════════════════════════════════════════════════════
    // Create 4 terminals for tiling + focused mode screenshots
    // ════════════════════════════════════════════════════════════
    console.log('📸 Preparing terminals...');
    const termTab = page.locator('.menu-bar__tab').first();
    await termTab.click();
    await page.waitForTimeout(1500);

    // Click the FAB "+" button to add terminals (need 3 more for total 4)
    const fabBtn = page.locator('.terminal-grid__fab');
    for (let i = 0; i < 3; i++) {
      const visible = await fabBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (visible) {
        await fabBtn.click();
        await page.waitForTimeout(2000);
        // Re-apply dark xterm theme for each new terminal
        await forceXtermDarkTheme(page);
      } else {
        console.log(`  FAB button not visible at iteration ${i}`);
        break;
      }
    }
    await page.waitForTimeout(1000);
    // Force dark theme again for all terminals
    await forceXtermDarkTheme(page);
    await page.waitForTimeout(500);

    // ════════════════════════════════════════════════════════════
    // Screenshot 2: 4 Terminals tiled
    // ════════════════════════════════════════════════════════════
    console.log('📸 Screenshot 2: dark-4terminals.jpg');
    await page.screenshot({
      path: resolve(OUTPUT, 'dark-4terminals.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-4terminals.jpg saved');

    // ════════════════════════════════════════════════════════════
    // Screenshot 3: Focused mode (double-click first terminal tile)
    // ════════════════════════════════════════════════════════════
    console.log('📸 Screenshot 3: dark-focused.jpg');
    const firstTile = page.locator('.terminal-tile').first();
    const tileVisible = await firstTile.isVisible({ timeout: 3000 }).catch(() => false);
    if (tileVisible) {
      await firstTile.dblclick();
      await page.waitForTimeout(1500);
      await forceXtermDarkTheme(page);
      await page.waitForTimeout(500);
    }

    await page.screenshot({
      path: resolve(OUTPUT, 'dark-focused.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-focused.jpg saved');

    // ════════════════════════════════════════════════════════════
    // Screenshot 4: Skills Panel
    // ════════════════════════════════════════════════════════════
    console.log('📸 Screenshot 4: dark-skills.jpg');
    const skillsTab = page.locator('.menu-bar__tab', { hasText: 'Skills' });
    await skillsTab.click();
    await page.waitForTimeout(2000);

    const skillItem = page.locator('[class*="skill-item"], [class*="skill-list"] [class*="item"]').first();
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

    // Use same skills screenshot for multi-tool
    await page.screenshot({
      path: resolve(OUTPUT, 'dark-multi-tool.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-multi-tool.jpg saved');

    console.log('\n✅ All screenshots saved to web/public/screenshots/');
  } finally {
    await app.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error('❌ Screenshot failed:', err);
  process.exit(1);
});
