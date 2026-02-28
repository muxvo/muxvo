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
import { spawn, type ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT = resolve(__dirname, '../..');
const OUTPUT = resolve(__dirname, '../public/screenshots');
const RENDERER_DIR = resolve(PROJECT, 'out/renderer');

async function startStaticServer(): Promise<ChildProcess> {
  // Serve the built renderer files on port 5173
  const server = spawn('npx', ['serve', RENDERER_DIR, '-l', '5173', '--no-clipboard'], {
    cwd: PROJECT,
    stdio: 'pipe',
  });

  // Wait for server to be ready
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
  // Start a static file server for the built renderer
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
  await page.waitForTimeout(5000); // Wait for React mount + data load

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
    await termTab.click({ timeout: 15000 });
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
    server.kill();
  }
}

main().catch((err) => {
  console.error('❌ Screenshot failed:', err);
  process.exit(1);
});
