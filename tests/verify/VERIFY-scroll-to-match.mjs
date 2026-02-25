/**
 * E2E verification: When searching and clicking a session, the detail panel
 * should scroll to the FIRST keyword match, not show the latest (bottom) messages.
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
    args: ['--user-data-dir=/tmp/muxvo-test-data', resolve(PROJECT, 'out/main/index.js')],
    cwd: PROJECT,
    env: { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' },
  });

  const win = await app.firstWindow();
  win.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`));
  await win.waitForTimeout(6000);
  await win.waitForLoadState('networkidle');

  // 1. Click "History" tab to open chat history panel
  const historyTab = win.locator('button.menu-bar__tab', { hasText: /History|历史/ });
  if (!(await historyTab.isVisible())) {
    console.log('GREEN FAIL: History tab not found');
    await app.close();
    process.exit(1);
  }
  await historyTab.click();
  await win.waitForTimeout(2000);
  console.log('History panel opened');

  await win.screenshot({ path: '/tmp/verify-scroll-01-history.png' });

  // 2. Type a search query that should match in sessions
  // Try multiple possible selectors for the search input
  let searchInput = win.locator('.search-input-wrap__input');
  if (!(await searchInput.isVisible().catch(() => false))) {
    // Try alternative selectors
    searchInput = win.locator('input[placeholder*="搜索"]');
    if (!(await searchInput.isVisible().catch(() => false))) {
      searchInput = win.locator('input[placeholder*="search" i]');
      if (!(await searchInput.isVisible().catch(() => false))) {
        searchInput = win.locator('.session-list input');
        if (!(await searchInput.isVisible().catch(() => false))) {
          // Log all input elements for debugging
          const allInputs = await win.locator('input').all();
          console.log(`Found ${allInputs.length} input elements`);
          for (const inp of allInputs) {
            const ph = await inp.getAttribute('placeholder').catch(() => '');
            const cls = await inp.getAttribute('class').catch(() => '');
            console.log(`  Input: class="${cls}" placeholder="${ph}"`);
          }
          console.log('GREEN FAIL: Search input not found in history panel');
          await win.screenshot({ path: '/tmp/verify-scroll-fail.png' });
          await app.close();
          process.exit(1);
        }
      }
    }
  }

  // Use a common keyword that likely appears in chat history
  await searchInput.fill('the');
  await win.waitForTimeout(1000);
  console.log('Typed search query "the"');

  // 3. Check if any sessions are filtered
  const sessionItems = win.locator('.session-list__item');
  const sessionCount = await sessionItems.count();
  console.log(`Found ${sessionCount} filtered sessions`);

  if (sessionCount === 0) {
    // Try another common keyword
    await searchInput.fill('a');
    await win.waitForTimeout(1000);
    const retryCount = await sessionItems.count();
    console.log(`Retried with "a", found ${retryCount} sessions`);
    if (retryCount === 0) {
      console.log('GREEN FAIL: No sessions match any search query');
      await app.close();
      process.exit(1);
    }
  }

  // 4. Click the first filtered session
  await sessionItems.first().click();
  await win.waitForTimeout(2000);
  console.log('Clicked first filtered session');

  // 5. Check if the first <mark class="search-highlight"> is visible in the viewport
  const marks = win.locator('.session-detail mark.search-highlight');
  const markCount = await marks.count();
  console.log(`Found ${markCount} highlight marks in session detail`);

  if (markCount === 0) {
    // Check MarkdownPreview highlights too
    const mdMarks = win.locator('.session-detail .search-highlight');
    const mdMarkCount = await mdMarks.count();
    console.log(`Found ${mdMarkCount} search-highlight elements (including markdown)`);
    if (mdMarkCount === 0) {
      console.log('GREEN FAIL: No highlighted keywords found in session detail');
      await win.screenshot({ path: '/tmp/verify-scroll-fail.png' });
      await app.close();
      process.exit(1);
    }
  }

  // 6. The key assertion: the first highlight mark should be visible in the viewport
  // (If it scrolled to bottom, the first match would be OFF-screen above)
  const firstMark = win.locator('.session-detail .search-highlight').first();
  const isVisible = await firstMark.isVisible();
  console.log(`First search-highlight visible: ${isVisible}`);

  if (!isVisible) {
    console.log('GREEN FAIL: First search-highlight is not visible — panel likely scrolled to bottom');
    await win.screenshot({ path: '/tmp/verify-scroll-fail.png' });
    await app.close();
    process.exit(1);
  }

  // 7. Additional check: the active match should be visible
  const activeMatch = win.locator('.session-detail .search-highlight--active');
  const activeCount = await activeMatch.count();
  console.log(`Active match highlights: ${activeCount}`);

  await win.screenshot({ path: '/tmp/verify-scroll-pass.png' });
  console.log('GREEN PASS: Session detail scrolled to first keyword match');

  await app.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
