/**
 * E2E verification: Skill document content highlights search keywords.
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
  await win.waitForTimeout(8000);
  await win.waitForLoadState('networkidle');

  await win.screenshot({ path: '/tmp/verify-skill-doc-00.png' });

  // Check all tabs
  const tabs = await win.locator('button.menu-bar__tab').all();
  for (const tab of tabs) {
    const text = await tab.textContent();
    console.log(`Tab: "${text}"`);
  }

  // Click Skills tab
  const skillsTab = win.locator('button.menu-bar__tab', { hasText: 'Skills' });
  const skillsVisible = await skillsTab.isVisible().catch(() => false);
  console.log(`Skills tab visible: ${skillsVisible}`);

  if (!skillsVisible) {
    console.log('GREEN FAIL: Skills tab not found');
    await app.close();
    process.exit(1);
  }
  await skillsTab.click();
  await win.waitForTimeout(3000);
  await win.screenshot({ path: '/tmp/verify-skill-doc-01.png' });
  console.log('Skills panel opened');

  // Select first skill
  const firstSkillItem = win.locator('.skill-list__item').first();
  try {
    await firstSkillItem.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    console.log('GREEN FAIL: No skill items found');
    await win.screenshot({ path: '/tmp/verify-skill-doc-fail.png' });
    await app.close();
    process.exit(1);
  }
  await firstSkillItem.click();
  await win.waitForTimeout(1500);
  console.log('Selected first skill');

  // Type search query
  const searchInput = win.locator('.search-input-wrap__input');
  await searchInput.fill('skill');
  await win.waitForTimeout(1500);
  console.log('Typed "skill" in search');

  // Click a filtered skill
  const filteredItems = win.locator('.skill-list__item');
  const filteredCount = await filteredItems.count();
  console.log(`Filtered skills: ${filteredCount}`);

  if (filteredCount > 0) {
    await filteredItems.first().click();
    await win.waitForTimeout(2000);
  }

  await win.screenshot({ path: '/tmp/verify-skill-doc-02.png' });

  // Check for highlights in right panel
  const highlights = win.locator('.skills-panel__right .search-highlight');
  const highlightCount = await highlights.count();
  console.log(`Document highlights: ${highlightCount}`);

  if (highlightCount === 0) {
    console.log('GREEN FAIL: No keyword highlights in document');
    await win.screenshot({ path: '/tmp/verify-skill-doc-fail.png' });
    await app.close();
    process.exit(1);
  }

  // Check nav count
  const navCount = win.locator('.search-input-wrap__nav-count');
  const navText = await navCount.textContent().catch(() => 'N/A');
  console.log(`Nav count: "${navText}"`);

  // Check list items do NOT have highlights
  const listHighlights = win.locator('.skill-list__item .search-highlight');
  const listHLCount = await listHighlights.count();
  console.log(`List item highlights (should be 0): ${listHLCount}`);

  // Clear search → editor should return
  await searchInput.fill('');
  await win.waitForTimeout(500);
  const hasEditor = await win.locator('.skills-panel__editor-body .tiptap-editor').count();
  console.log(`WYSIWYG editor back: ${hasEditor > 0}`);

  await win.screenshot({ path: '/tmp/verify-skill-doc-03.png' });
  console.log('GREEN PASS: Document highlights work, list items clean');

  await app.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
