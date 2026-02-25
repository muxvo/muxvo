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

  // 2. Type search query
  const skillList = win.locator('.skill-list');
  const searchInput = skillList.locator('.search-input-wrap__input');
  await searchInput.fill('auto');
  await win.waitForTimeout(500);
  console.log('Typed "auto" in search');

  // 3. Check ▲▼ nav buttons exist
  const navButtons = skillList.locator('.search-input-wrap__nav-btn');
  const navCount = await navButtons.count();
  if (navCount < 2) {
    console.log(`GREEN FAIL: Expected 2 nav buttons, got ${navCount}`);
    await win.screenshot({ path: '/tmp/verify-skill-nav-fail.png' });
    await app.close();
    process.exit(1);
  }
  console.log('▲▼ nav buttons found');

  // 4. Check initial match count display (0/N before any selection)
  const navCountEl = skillList.locator('.search-input-wrap__nav-count');
  const initial = await navCountEl.textContent();
  console.log(`Initial nav count: "${initial}"`);

  // 5. Click ▼ (next) to select first skill → should show "1/N"
  const downBtn = navButtons.nth(1);
  await downBtn.click();
  await win.waitForTimeout(300);
  const after1stDown = await navCountEl.textContent();
  console.log(`After 1st ▼: "${after1stDown}"`);

  if (!after1stDown?.startsWith('1/')) {
    console.log('GREEN FAIL: Expected "1/N" after first ▼ click');
    await win.screenshot({ path: '/tmp/verify-skill-nav-fail.png' });
    await app.close();
    process.exit(1);
  }

  // 6. Click ▼ again → should show "2/N"
  await downBtn.click();
  await win.waitForTimeout(300);
  const after2ndDown = await navCountEl.textContent();
  console.log(`After 2nd ▼: "${after2ndDown}"`);

  if (!after2ndDown?.startsWith('2/')) {
    console.log('GREEN FAIL: Expected "2/N" after second ▼ click');
    await win.screenshot({ path: '/tmp/verify-skill-nav-fail.png' });
    await app.close();
    process.exit(1);
  }

  // 7. Click ▲ (prev) → should go back to "1/N"
  const upBtn = navButtons.nth(0);
  await upBtn.click();
  await win.waitForTimeout(300);
  const afterUp = await navCountEl.textContent();
  console.log(`After ▲: "${afterUp}"`);

  if (!afterUp?.startsWith('1/')) {
    console.log('GREEN FAIL: Expected "1/N" after ▲ click');
    await win.screenshot({ path: '/tmp/verify-skill-nav-fail.png' });
    await app.close();
    process.exit(1);
  }

  await win.screenshot({ path: '/tmp/verify-skill-nav-pass.png' });
  console.log('GREEN PASS: ▲▼ nav buttons work correctly in SkillList search');

  await app.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
