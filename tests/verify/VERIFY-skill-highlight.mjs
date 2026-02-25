/**
 * E2E verification: Skill search keyword highlighting
 *
 * Prerequisite: `npx electron-vite dev` must be running (vite server on 5173).
 * This script launches a NEW Electron instance pointing at the vite renderer,
 * navigates to Skills panel, and verifies <mark> highlighting appears.
 */
import { _electron } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, '../..');

async function main() {
  console.log('Launching Electron with ELECTRON_RENDERER_URL=http://localhost:5173 ...');

  const app = await _electron.launch({
    args: [resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
    },
  });

  const window = await app.firstWindow();
  await window.waitForTimeout(5000);
  await window.waitForLoadState('networkidle');

  await window.screenshot({ path: '/tmp/verify-01-initial.png' });
  const bodyLen = (await window.locator('body').innerHTML()).length;
  console.log(`Screenshot 1: Initial state (body ${bodyLen} chars)`);

  if (bodyLen < 100) {
    console.log('Page seems empty, waiting more...');
    await window.waitForTimeout(5000);
    await window.screenshot({ path: '/tmp/verify-01b-retry.png' });
    const retry = (await window.locator('body').innerHTML()).length;
    console.log(`After retry: body ${retry} chars`);
  }

  // Check for sidebar/navigation
  const allBtns = await window.locator('button, [role="button"]').all();
  console.log(`Buttons found: ${allBtns.length}`);
  for (const btn of allBtns.slice(0, 15)) {
    const text = (await btn.textContent().catch(() => ''))?.trim();
    const title = await btn.getAttribute('title').catch(() => '');
    if (text || title) console.log(`  btn: "${text?.slice(0,40)}" title="${title}"`);
  }

  // Try to open Skills panel
  let skillsOpened = false;

  // Look for skills icon/button by title or text
  for (const selector of [
    'button[title*="Skill" i]',
    'button[title*="skill" i]',
    '[class*="sidebar"] [class*="skill" i]',
    'text=/Skills?$/i',
  ]) {
    const el = window.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      await window.waitForTimeout(1000);
      skillsOpened = true;
      console.log(`Opened skills via: ${selector}`);
      break;
    }
  }

  await window.screenshot({ path: '/tmp/verify-02-skills.png' });
  console.log('Screenshot 2: Skills panel state');

  // Check skill list
  const skillList = window.locator('.skill-list');
  if (await skillList.isVisible().catch(() => false)) {
    console.log('Skill list is visible');

    const searchInput = skillList.locator('.search-input-wrap__input');
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('auto');
      await window.waitForTimeout(500);
      await window.screenshot({ path: '/tmp/verify-03-search.png' });
      console.log('Screenshot 3: After search "auto"');

      const marks = skillList.locator('mark.search-highlight');
      const markCount = await marks.count();
      console.log(`Found ${markCount} <mark class="search-highlight"> elements`);

      if (markCount > 0) {
        const firstText = await marks.first().textContent();
        console.log(`First highlighted text: "${firstText}"`);
        console.log('GREEN PASS: Keyword highlighting works in SkillList');
      } else {
        console.log('GREEN FAIL: No highlighted marks found');
        process.exitCode = 1;
      }
    } else {
      console.log('GREEN FAIL: Search input not visible');
      process.exitCode = 1;
    }
  } else {
    console.log('Skills panel not open, dumping structure...');
    const classes = await window.evaluate(() =>
      [...document.querySelectorAll('[class]')].slice(0, 30).map(el => el.className)
    );
    console.log('Classes:', classes);
    process.exitCode = 1;
  }

  await window.screenshot({ path: '/tmp/verify-04-final.png' });
  await app.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
