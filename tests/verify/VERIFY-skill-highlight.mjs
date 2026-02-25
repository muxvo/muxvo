/**
 * E2E verification: Skill search keyword highlighting
 * Uses Playwright Electron to launch Muxvo and test the SkillList search.
 */
import { _electron } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, '../..');

async function main() {
  console.log('Launching Electron app...');
  const app = await _electron.launch({
    args: [resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    env: { ...process.env, NODE_ENV: 'development' },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('networkidle');
  console.log('App loaded');

  // Screenshot initial state
  await window.screenshot({ path: '/tmp/verify-01-initial.png' });
  console.log('Screenshot 1: Initial state');

  // Find and click Skills tab in the sidebar
  // Look for navigation elements
  const allButtons = await window.locator('button, [role="tab"], .sidebar-btn, .nav-btn').all();
  console.log(`Found ${allButtons.length} button-like elements`);
  for (const btn of allButtons.slice(0, 15)) {
    const text = (await btn.textContent().catch(() => ''))?.trim();
    const cls = await btn.getAttribute('class').catch(() => '');
    if (text || cls) console.log(`  Button: "${text}" class="${cls}"`);
  }

  // Try to find the skills panel trigger
  let foundSkills = false;

  // Strategy 1: data attribute
  const dataPanel = window.locator('[data-panel="skills"]');
  if (await dataPanel.count() > 0) {
    await dataPanel.first().click();
    foundSkills = true;
    console.log('Clicked data-panel=skills');
  }

  // Strategy 2: text content
  if (!foundSkills) {
    const skillBtn = window.locator('button:has-text("Skill")');
    if (await skillBtn.count() > 0) {
      await skillBtn.first().click();
      foundSkills = true;
      console.log('Clicked Skill button');
    }
  }

  // Strategy 3: look for sidebar items with skill-related class
  if (!foundSkills) {
    const sideItems = await window.locator('[class*="sidebar"] [class*="item"], [class*="nav"] [class*="item"]').all();
    for (const item of sideItems) {
      const text = (await item.textContent().catch(() => ''))?.trim().toLowerCase();
      if (text?.includes('skill')) {
        await item.click();
        foundSkills = true;
        console.log(`Clicked sidebar item with text: ${text}`);
        break;
      }
    }
  }

  await window.waitForTimeout(1000);
  await window.screenshot({ path: '/tmp/verify-02-skills-panel.png' });
  console.log('Screenshot 2: Skills panel state');

  // Check if skill-list is visible
  const skillList = window.locator('.skill-list');
  const skillListVisible = await skillList.isVisible().catch(() => false);
  console.log(`Skill list visible: ${skillListVisible}`);

  if (skillListVisible) {
    // Type in the search input within skill list
    const searchInput = skillList.locator('.search-input-wrap__input');
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('auto');
      await window.waitForTimeout(500);
      await window.screenshot({ path: '/tmp/verify-03-search.png' });
      console.log('Screenshot 3: After search "auto"');

      // Check for highlighted marks
      const marks = skillList.locator('mark.search-highlight');
      const markCount = await marks.count();
      console.log(`Found ${markCount} highlighted <mark> elements`);

      if (markCount > 0) {
        const firstMarkText = await marks.first().textContent();
        console.log(`First mark text: "${firstMarkText}"`);
        console.log('GREEN PASS: Keyword highlighting works in SkillList');
      } else {
        console.log('GREEN FAIL: No search-highlight marks found');
        process.exitCode = 1;
      }
    } else {
      console.log('GREEN FAIL: Search input not found');
      process.exitCode = 1;
    }
  } else {
    console.log('WARN: Skill list not visible');
    // Dump page structure for debugging
    const bodyHtml = await window.locator('body').innerHTML();
    const classMatches = bodyHtml.match(/class="[^"]*skill[^"]*"/gi) || [];
    console.log(`Skill-related classes in page: ${classMatches.length}`);
    classMatches.forEach(m => console.log(`  ${m}`));
    process.exitCode = 1;
  }

  await window.screenshot({ path: '/tmp/verify-04-final.png' });
  console.log('Screenshot 4: Final state');

  await app.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
