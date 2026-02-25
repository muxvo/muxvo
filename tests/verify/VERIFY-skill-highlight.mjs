/**
 * E2E verification: Skill search keyword highlighting in Electron app.
 *
 * Prerequisite: `npx electron-vite dev` already running (vite on 5173).
 */
import { _electron } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, '../..');

async function main() {
  const app = await _electron.launch({
    args: [resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    env: { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' },
  });

  const win = await app.firstWindow();
  win.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`));
  await win.waitForTimeout(6000);
  await win.waitForLoadState('networkidle');

  // 1. Click "Skills" tab in the menu bar
  const skillsTab = win.locator('button.menu-bar__tab', { hasText: 'Skills' });
  if (!(await skillsTab.isVisible())) {
    console.log('GREEN FAIL: Skills tab not found');
    await app.close();
    process.exit(1);
  }
  await skillsTab.click();
  await win.waitForTimeout(2000);
  await win.screenshot({ path: '/tmp/verify-02-skills-panel.png' });
  console.log('Skills panel opened');

  // 2. Verify skill list is visible
  const skillList = win.locator('.skill-list');
  if (!(await skillList.isVisible())) {
    console.log('GREEN FAIL: Skill list not visible after clicking Skills tab');
    await app.close();
    process.exit(1);
  }

  // 3. Type search query
  const searchInput = skillList.locator('.search-input-wrap__input');
  await searchInput.fill('auto');
  await win.waitForTimeout(500);
  await win.screenshot({ path: '/tmp/verify-03-search.png' });
  console.log('Typed "auto" in search');

  // 4. Check for highlighted <mark> elements
  const marks = skillList.locator('mark.search-highlight');
  const markCount = await marks.count();
  console.log(`Found ${markCount} <mark class="search-highlight"> elements`);

  if (markCount > 0) {
    const firstText = await marks.first().textContent();
    console.log(`First highlighted text: "${firstText}"`);
    console.log('GREEN PASS: Keyword highlighting works in SkillList');
  } else {
    console.log('GREEN FAIL: No search-highlight marks found');
    await win.screenshot({ path: '/tmp/verify-fail.png' });
    await app.close();
    process.exit(1);
  }

  await win.screenshot({ path: '/tmp/verify-04-final.png' });
  await app.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
