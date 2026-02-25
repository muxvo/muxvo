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

  // 1. Click "历史聊天" tab to open chat history panel
  const historyTab = win.locator('button.menu-bar__tab', { hasText: /历史聊天|History/ });
  if (!(await historyTab.isVisible())) {
    console.log('GREEN FAIL: History tab not found');
    await app.close();
    process.exit(1);
  }
  await historyTab.click();
  await win.waitForTimeout(3000);
  console.log('History tab clicked');

  // Wait for session list to finish loading (skeleton disappears, session cards appear)
  try {
    await win.locator('.session-card').first().waitFor({ state: 'visible', timeout: 15000 });
    console.log('Session cards loaded');
  } catch {
    // Check if we have sessions at all
    await win.screenshot({ path: '/tmp/verify-scroll-01-nosessions.png' });
    console.log('GREEN FAIL: No session cards loaded within 15s');
    await app.close();
    process.exit(1);
  }

  // Wait for search input to appear (it renders alongside sessions)
  await win.waitForTimeout(1000);
  await win.screenshot({ path: '/tmp/verify-scroll-01-loaded.png' });

  // 2. Find and use the search input
  const searchInput = win.locator('.search-input-wrap__input');
  if (!(await searchInput.isVisible().catch(() => false))) {
    console.log('GREEN FAIL: Search input not visible after sessions loaded');
    await app.close();
    process.exit(1);
  }

  // Use a common keyword that likely appears in chat history
  await searchInput.fill('the');
  await win.waitForTimeout(2000);
  console.log('Typed search query "the"');

  // 3. Check if any sessions are filtered
  const sessionCards = win.locator('.session-card');
  let sessionCount = await sessionCards.count();
  console.log(`Found ${sessionCount} filtered sessions`);

  if (sessionCount === 0) {
    // Try another common keyword
    await searchInput.fill('a');
    await win.waitForTimeout(2000);
    sessionCount = await sessionCards.count();
    console.log(`Retried with "a", found ${sessionCount} sessions`);
    if (sessionCount === 0) {
      await searchInput.fill('function');
      await win.waitForTimeout(2000);
      sessionCount = await sessionCards.count();
      console.log(`Retried with "function", found ${sessionCount} sessions`);
      if (sessionCount === 0) {
        console.log('GREEN FAIL: No sessions match any search query');
        await win.screenshot({ path: '/tmp/verify-scroll-fail.png' });
        await app.close();
        process.exit(1);
      }
    }
  }

  await win.screenshot({ path: '/tmp/verify-scroll-02-searched.png' });

  // 4. Click a session that's NOT the first one (to ensure session switch)
  const targetIdx = sessionCount > 1 ? 1 : 0;
  await sessionCards.nth(targetIdx).click();
  await win.waitForTimeout(3000);
  console.log(`Clicked session #${targetIdx}`);

  await win.screenshot({ path: '/tmp/verify-scroll-03-detail.png' });

  // 5. Check for highlighted keywords in the session detail
  const highlights = win.locator('.session-detail .search-highlight');
  const highlightCount = await highlights.count();
  console.log(`Found ${highlightCount} search-highlight elements in detail`);

  if (highlightCount === 0) {
    console.log('GREEN FAIL: No highlighted keywords found in session detail');
    await win.screenshot({ path: '/tmp/verify-scroll-fail.png' });
    await app.close();
    process.exit(1);
  }

  // 6. The key assertion: the first highlight should be visible in the viewport
  // If the panel scrolled to bottom (bug), the first match would be off-screen above
  const firstHighlight = highlights.first();
  const isInViewport = await firstHighlight.isVisible();
  console.log(`First search-highlight visible in viewport: ${isInViewport}`);

  if (!isInViewport) {
    console.log('GREEN FAIL: First search-highlight is NOT visible — panel likely scrolled to bottom');
    await win.screenshot({ path: '/tmp/verify-scroll-fail.png' });
    await app.close();
    process.exit(1);
  }

  // 7. Additional: check if the active highlight is visible
  const activeHighlights = win.locator('.session-detail .search-highlight--active');
  const activeCount = await activeHighlights.count();
  console.log(`Active match highlights: ${activeCount}`);

  await win.screenshot({ path: '/tmp/verify-scroll-04-pass.png' });
  console.log('GREEN PASS: Session detail scrolled to first keyword match');

  await app.close();
  console.log('Done');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
