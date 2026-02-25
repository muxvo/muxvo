/**
 * E2E verification: Skill search keyword highlighting
 *
 * Connects to vite dev server (localhost:5173) via Playwright chromium.
 * Note: window.api (Electron preload) is not available in browser mode,
 * but we can still verify that the SkillList component renders <mark> tags
 * when search query is entered, since the filtering is client-side.
 *
 * Prerequisite: `npx electron-vite dev` must be running.
 */
import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Connect to vite dev server
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/verify-01-initial.png' });
  console.log('Screenshot 1: Initial state');

  // Check page content
  const bodyLen = (await page.locator('body').innerHTML()).length;
  console.log(`Body HTML length: ${bodyLen}`);

  // List all visible classes to understand page structure
  const topClasses = await page.evaluate(() => {
    const root = document.querySelector('#root') || document.body;
    return Array.from(root.querySelectorAll('*'))
      .slice(0, 50)
      .map(el => el.className)
      .filter(Boolean);
  });
  console.log('Top element classes:', topClasses.slice(0, 20));

  // Look for skills panel or its trigger
  const skillsPanel = page.locator('.skills-panel');
  const skillList = page.locator('.skill-list');

  if (await skillsPanel.isVisible().catch(() => false)) {
    console.log('Skills panel already visible');
  } else if (await skillList.isVisible().catch(() => false)) {
    console.log('Skill list already visible');
  } else {
    // Need to open the skills panel - find and click the trigger
    console.log('Skills panel not open, looking for trigger...');

    // Dump all buttons/clickable elements
    const buttons = await page.locator('button, [role="button"]').all();
    console.log(`Found ${buttons.length} buttons`);
    for (const btn of buttons.slice(0, 15)) {
      const text = (await btn.textContent().catch(() => ''))?.trim();
      const cls = await btn.getAttribute('class').catch(() => '');
      const title = await btn.getAttribute('title').catch(() => '');
      if (text || title || cls) console.log(`  btn: text="${text?.slice(0,30)}" title="${title}" class="${cls}"`);
    }

    // Try clicking skill-related button
    const skillTrigger = page.locator('button[title*="Skill" i], button[title*="skill" i], [class*="skill" i]').first();
    if (await skillTrigger.isVisible().catch(() => false)) {
      await skillTrigger.click();
      await page.waitForTimeout(1000);
      console.log('Clicked skill trigger');
    }

    await page.screenshot({ path: '/tmp/verify-02-after-trigger.png' });
  }

  // Verify skill list and search highlighting
  if (await skillList.isVisible().catch(() => false)) {
    const searchInput = skillList.locator('.search-input-wrap__input');
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('auto');
      await page.waitForTimeout(500);
      await page.screenshot({ path: '/tmp/verify-03-search.png' });
      console.log('Screenshot 3: After search "auto"');

      const marks = skillList.locator('mark.search-highlight');
      const markCount = await marks.count();
      console.log(`Found ${markCount} <mark class="search-highlight"> elements`);

      if (markCount > 0) {
        const firstText = await marks.first().textContent();
        console.log(`First highlighted text: "${firstText}"`);
        console.log('GREEN PASS: Keyword highlighting works in SkillList');
      } else {
        console.log('GREEN FAIL: No search-highlight marks found in skill list');
        process.exitCode = 1;
      }
    } else {
      console.log('GREEN FAIL: Search input not visible in skill list');
      process.exitCode = 1;
    }
  } else {
    console.log('NOTE: Skill list not visible (may require Electron preload for window.api)');
    console.log('Checking if HighlightText component is correctly wired by inspecting source...');

    // Fallback: verify via source code analysis that HighlightText is imported and used
    const resp = await page.goto('http://localhost:5173/src/renderer/components/skill/SkillList.tsx', { waitUntil: 'load' }).catch(() => null);
    if (resp) {
      const src = await resp.text().catch(() => '');
      const hasImport = src.includes('HighlightText');
      console.log(`SkillList.tsx imports HighlightText: ${hasImport}`);
    }

    // Since window.api isn't available, the app can't load skills data
    // But we can verify the wiring is correct by checking the compiled JS
    const compiledJs = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      return scripts.map(s => s.src);
    });
    console.log('Script sources:', compiledJs);

    console.log('INCONCLUSIVE: Cannot fully test without Electron preload. App must be tested manually or via _electron.launch().');
    process.exitCode = 1;
  }

  await page.screenshot({ path: '/tmp/verify-04-final.png' });
  await browser.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
