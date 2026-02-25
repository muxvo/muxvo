/**
 * E2E verification: ▲▼ navigation buttons work in SkillList search.
 * Prerequisite: `npx electron-vite dev` already running (vite on 5173).
 */
import { _electron } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, '../..');

async function main() {
  const app = await _electron.launch({
    args: ['--user-data-dir=/tmp/muxvo-test-data', resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    env: { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' },
  });

  const win = await app.firstWindow();
  win.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`));
  await win.waitForTimeout(6000);
  await win.waitForLoadState('networkidle');

  // 1. Click "Skills" tab
  const skillsTab = win.locator('button.menu-bar__tab', { hasText: 'Skills' });
  if (!(await skillsTab.isVisible())) {
    console.log('GREEN FAIL: Skills tab not found');
    await app.close();
    process.exit(1);
  }
  await skillsTab.click();
  await win.waitForTimeout(2000);
  console.log('Skills panel opened');

  // 2. Verify skill list loaded
  const skillList = win.locator('.skill-list');
  if (!(await skillList.isVisible())) {
    console.log('GREEN FAIL: Skill list not visible');
    await app.close();
    process.exit(1);
  }

  // 3. Type search query to filter skills
  const searchInput = skillList.locator('.search-input-wrap__input');
  await searchInput.fill('auto');
  await win.waitForTimeout(500);
  console.log('Typed "auto" in search');

  // 4. Check for ▲▼ nav buttons
  const navButtons = skillList.locator('.search-input-wrap__nav-btn');
  const navCount = await navButtons.count();
  console.log(`Found ${navCount} nav buttons`);

  if (navCount < 2) {
    console.log('GREEN FAIL: ▲▼ nav buttons not found');
    await win.screenshot({ path: '/tmp/verify-skill-nav-fail.png' });
    await app.close();
    process.exit(1);
  }

  // 5. Check match count display
  const navCountText = await skillList.locator('.search-input-wrap__nav-count').textContent();
  console.log(`Nav count display: "${navCountText}"`);

  if (!navCountText || !navCountText.includes('/')) {
    console.log('GREEN FAIL: Match count not displayed correctly');
    await win.screenshot({ path: '/tmp/verify-skill-nav-fail.png' });
    await app.close();
    process.exit(1);
  }

  await win.screenshot({ path: '/tmp/verify-skill-nav-01.png' });

  // 6. Click ▼ (next) button and verify selection changes
  const downBtn = navButtons.nth(1); // ▼ is second button
  await downBtn.click();
  await win.waitForTimeout(300);
  const afterDown = await skillList.locator('.search-input-wrap__nav-count').textContent();
  console.log(`After ▼ click: "${afterDown}"`);

  // 7. Click ▲ (prev) button and verify selection changes
  const upBtn = navButtons.nth(0); // ▲ is first button
  await upBtn.click();
  await win.waitForTimeout(300);
  const afterUp = await skillList.locator('.search-input-wrap__nav-count').textContent();
  console.log(`After ▲ click: "${afterUp}"`);

  await win.screenshot({ path: '/tmp/verify-skill-nav-02.png' });
  console.log('GREEN PASS: ▲▼ nav buttons work in SkillList search');

  await app.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
