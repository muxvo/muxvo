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
    env: { ...process.env, NODE_ENV: 'production' },
  });

  const window = await app.firstWindow();

  // Wait for app to fully render (Electron + React mount takes time)
  await window.waitForTimeout(5000);
  await window.waitForLoadState('domcontentloaded');

  // Wait for any React element to appear
  try {
    await window.waitForSelector('[class*="sidebar"], [class*="panel"], [class*="app"]', { timeout: 10000 });
  } catch {
    console.log('WARN: Could not find app container element');
  }

  await window.screenshot({ path: '/tmp/verify-01-initial.png' });
  console.log('Screenshot 1: Initial state');

  // Dump page structure for debugging
  const bodyHtml = await window.locator('body').innerHTML();
  console.log(`Body length: ${bodyHtml.length} chars`);
  console.log(`Body preview: ${bodyHtml.slice(0, 500)}`);

  // Find all clickable elements on page
  const allElements = await window.locator('*').all();
  console.log(`Total elements: ${allElements.length}`);

  // Look for anything skill-related
  const skillElements = await window.locator('[class*="skill" i]').all();
  console.log(`Skill-related elements: ${skillElements.length}`);

  // Look for the skill panel opener - check sidebar/navigation
  const sidebarItems = await window.locator('.sidebar-content a, .sidebar-content button, .sidebar-content div[class*="item"]').all();
  console.log(`Sidebar items: ${sidebarItems.length}`);
  for (const item of sidebarItems.slice(0, 10)) {
    const text = (await item.textContent().catch(() => ''))?.trim();
    const cls = await item.getAttribute('class').catch(() => '');
    console.log(`  Sidebar: text="${text}" class="${cls}"`);
  }

  // Try to open skills panel via keyboard shortcut or click
  // Check what panels exist
  const panels = await window.locator('[class*="panel"]').all();
  console.log(`Panel elements: ${panels.length}`);
  for (const p of panels.slice(0, 5)) {
    const cls = await p.getAttribute('class').catch(() => '');
    console.log(`  Panel class: "${cls}"`);
  }

  // Check if SkillsPanel might already be a full overlay that needs to be opened
  // Look for the Skills tab/button in the main layout
  const allBtns = await window.locator('button, a, [role="button"], [class*="tab"]').all();
  console.log(`Buttons/tabs found: ${allBtns.length}`);
  for (const btn of allBtns.slice(0, 20)) {
    const text = (await btn.textContent().catch(() => ''))?.trim();
    if (text) console.log(`  Btn: "${text.slice(0, 50)}"`);
  }

  // Try to dispatch the OPEN_SKILLS_PANEL action via the app
  // This is a React SPA so we may need to trigger navigation
  await window.evaluate(() => {
    // Try dispatching keyboard shortcut or clicking skills icon
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
    window.dispatchEvent(event);
  });
  await window.waitForTimeout(1000);

  await window.screenshot({ path: '/tmp/verify-02-after-key.png' });
  console.log('Screenshot 2: After keyboard attempt');

  // Check for skill list now
  const skillList = window.locator('.skill-list');
  const isVisible = await skillList.isVisible().catch(() => false);
  console.log(`Skill list visible after keyboard: ${isVisible}`);

  if (isVisible) {
    await runHighlightTest(window, skillList);
  } else {
    console.log('Skills panel not open. Trying to find open method...');
    // Last resort: look for any element with "skill" text
    const skillText = await window.locator('text=/skill/i').all();
    console.log(`Elements with "skill" text: ${skillText.length}`);
    for (const el of skillText.slice(0, 5)) {
      const tag = await el.evaluate(e => e.tagName).catch(() => '');
      const text = (await el.textContent().catch(() => ''))?.trim();
      console.log(`  ${tag}: "${text?.slice(0, 50)}"`);
    }
    process.exitCode = 1;
  }

  await window.screenshot({ path: '/tmp/verify-04-final.png' });
  await app.close();
  console.log('Done');
}

async function runHighlightTest(window, skillList) {
  const searchInput = skillList.locator('.search-input-wrap__input');
  if (!(await searchInput.isVisible().catch(() => false))) {
    console.log('GREEN FAIL: Search input not found in skill list');
    process.exitCode = 1;
    return;
  }

  await searchInput.fill('auto');
  await window.waitForTimeout(500);
  await window.screenshot({ path: '/tmp/verify-03-search.png' });
  console.log('Screenshot 3: After search "auto"');

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
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
