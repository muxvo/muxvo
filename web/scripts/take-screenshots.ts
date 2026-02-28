/**
 * Playwright Electron Screenshot Script — v2
 *
 * Takes dark-theme screenshots for the Muxvo website.
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
  await page.waitForTimeout(5000);

  // Force dark theme
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  try {
    // ── Screenshot 1: Chat History with Resume Bar ──────────────
    console.log('📸 Screenshot 1: dark-resume-chat.jpg');
    const chatTab = page.locator('.menu-bar__tab', { hasText: /历史聊天|Chat/ });
    await chatTab.click();
    await page.waitForTimeout(2000);

    // Click first session to show detail panel + resume bar
    const sessionCard = page.locator('.session-card').first();
    const hasSession = await sessionCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasSession) {
      await sessionCard.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: resolve(OUTPUT, 'dark-resume-chat.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-resume-chat.jpg saved');

    // ── Screenshot 2: Terminals (default view) ──────────────────
    console.log('📸 Screenshot 2: dark-terminals.jpg (terminals view)');
    const termTab = page.locator('.menu-bar__tab').first();
    await termTab.click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: resolve(OUTPUT, 'dark-terminals.jpg'),
      type: 'jpeg',
      quality: 90,
    });
    console.log('  ✅ dark-terminals.jpg saved');

    // ── Screenshot 3: Skills Panel ──────────────────────────────
    console.log('📸 Screenshot 3: dark-skills.jpg');
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

    console.log('\n✅ Screenshots saved to web/public/screenshots/');
  } finally {
    await app.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error('❌ Screenshot failed:', err);
  process.exit(1);
});
