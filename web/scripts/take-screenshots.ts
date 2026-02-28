/**
 * Playwright Electron Screenshot Script
 *
 * Automatically takes dark-theme screenshots of Muxvo for the website.
 *
 * Prerequisites: npx electron-vite build
 * Run: npx tsx web/scripts/take-screenshots.ts
 */

import { _electron as electron } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT = resolve(__dirname, '../..');
const OUTPUT = resolve(__dirname, '../public/screenshots');

async function main() {
  console.log('Launching Muxvo...');

  // Start Vite dev server first
  const { spawn } = await import('child_process');
  const vite = spawn('npx', ['electron-vite', 'dev'], {
    cwd: PROJECT,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env },
  });

  // Wait for Vite to be ready
  console.log('Waiting for Vite dev server...');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite startup timeout')), 30000);
    const check = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:5173');
        if (res.ok) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      } catch { /* not ready yet */ }
    }, 500);
  });
  console.log('Vite dev server ready');

  // Wait a bit more for electron-vite to start Electron
  await new Promise(r => setTimeout(r, 8000));

  // Kill the electron-vite spawned Electron and vite, then launch our own
  try { process.kill(-vite.pid!, 'SIGTERM'); } catch {}
  await new Promise(r => setTimeout(r, 2000));

  const app = await electron.launch({
    args: ['.'],
    cwd: PROJECT,
    timeout: 30000,
    env: { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000); // Wait for React mount + config load

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

    // Try to click a session for richer content
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

    // Try to click a skill for richer content
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

    // ── Screenshot 4: Terminal with full nav bar visible ─────────
    console.log('📸 Screenshot 4: dark-multi-tool.jpg');
    const termTab2 = page.locator('.menu-bar__tab').first();
    await termTab2.click();
    await page.waitForTimeout(1000);

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
}

main().catch((err) => {
  console.error('❌ Screenshot failed:', err);
  process.exit(1);
});
