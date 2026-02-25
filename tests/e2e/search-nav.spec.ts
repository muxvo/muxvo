/**
 * E2E Test: Chat Search Navigation Scroll Behavior
 *
 * Verifies that clicking ▲▼ buttons in the search navigation bar
 * actually scrolls the Virtuoso list to the matched messages.
 *
 * Run: npx electron-vite build && npx playwright test tests/e2e/search-nav.spec.ts
 */

import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    timeout: 30000,
  });
  page = await app.firstWindow();
  // Wait for the app to be fully loaded
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000); // Extra wait for Electron + React hydration
});

test.afterAll(async () => {
  if (app) await app.close();
});

test.describe('Search Navigation', () => {

  test('Step 1: Navigate to Chat History tab', async () => {
    // Take initial screenshot
    await page.screenshot({ path: '/tmp/e2e-01-initial.png' });

    // Find and click the chat history tab
    // The tab contains text "历史聊天" (zh) or "Chat History" (en)
    const chatTab = page.locator('.menu-bar__tab', { hasText: /历史聊天|Chat History/ });
    await expect(chatTab).toBeVisible({ timeout: 10000 });
    await chatTab.click();
    await page.waitForTimeout(1000);

    // Verify chat history panel appeared
    await expect(page.locator('.chat-history-panel')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: '/tmp/e2e-02-chat-tab.png' });
  });

  test('Step 2: Wait for projects and sessions to load', async () => {
    // Wait for project list to appear (left column)
    await expect(page.locator('.project-list')).toBeVisible({ timeout: 15000 });

    // Wait for session cards to appear (middle column)
    await expect(page.locator('.session-card').first()).toBeVisible({ timeout: 15000 });

    const cardCount = await page.locator('.session-card').count();
    console.log(`Found ${cardCount} session cards`);
    expect(cardCount).toBeGreaterThan(0);
    await page.screenshot({ path: '/tmp/e2e-03-sessions-loaded.png' });
  });

  test('Step 3: Enter search query', async () => {
    // Find the search input in the session list
    const searchInput = page.locator('.search-input input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Type a common keyword
    await searchInput.fill('你好');
    await page.waitForTimeout(2000); // Wait for debounce + search

    // Verify search results appear
    const resultCount = await page.locator('.session-card').count();
    console.log(`Search results: ${resultCount} sessions`);
    expect(resultCount).toBeGreaterThan(0);
    await page.screenshot({ path: '/tmp/e2e-04-search-results.png' });
  });

  test('Step 4: Click a session to load messages', async () => {
    // Click the first session card
    await page.locator('.session-card').first().click();
    await page.waitForTimeout(3000); // Wait for messages to load

    // Verify messages loaded (Virtuoso renders items)
    const messageBubbles = page.locator('.message-bubble');
    await expect(messageBubbles.first()).toBeVisible({ timeout: 10000 });

    const msgCount = await messageBubbles.count();
    console.log(`Loaded ${msgCount} message bubbles`);
    await page.screenshot({ path: '/tmp/e2e-05-messages-loaded.png' });
  });

  test('Step 5: Search navigation bar appears with match count', async () => {
    // The search-nav bar should appear since we have a search query active
    const navBar = page.locator('.session-detail__search-nav');
    await expect(navBar).toBeVisible({ timeout: 5000 });

    // Read match count text (e.g., "1 / 5")
    const countText = await page.locator('.session-detail__search-nav-count').textContent();
    console.log(`Match count: ${countText?.trim()}`);
    expect(countText).toBeTruthy();

    // Parse "1 / N"
    const match = countText!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    expect(match).toBeTruthy();

    const current = parseInt(match![1]);
    const total = parseInt(match![2]);
    console.log(`Current: ${current}, Total: ${total}`);
    expect(current).toBe(1);
    expect(total).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: '/tmp/e2e-06-nav-bar.png' });
  });

  test('Step 6: ▼ button scrolls to next match (CORE TEST)', async () => {
    // Check if total matches >= 2 (need at least 2 to test navigation)
    const countText = await page.locator('.session-detail__search-nav-count').textContent();
    const match = countText!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    const total = parseInt(match![2]);

    if (total < 2) {
      console.log('SKIP: Only 1 match, cannot test ▼ navigation');
      test.skip();
      return;
    }

    // Find the Virtuoso scroller
    const scroller = page.locator('[data-virtuoso-scroller="true"]').first();
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
    console.log(`Scroll position before ▼: ${scrollBefore}`);

    // Click ▼ (next match) button
    const nextBtn = page.locator('.session-detail__search-nav button').last();
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();
    await page.waitForTimeout(800); // Wait for scroll to complete

    // CORE ASSERTION: scroll position must change
    const scrollAfter = await scroller.evaluate((el) => el.scrollTop);
    console.log(`Scroll position after ▼: ${scrollAfter}`);
    expect(scrollAfter).not.toBe(scrollBefore);

    // Verify count updated to "2 / N"
    const countAfter = await page.locator('.session-detail__search-nav-count').textContent();
    const matchAfter = countAfter!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    expect(parseInt(matchAfter![1])).toBe(2);

    await page.screenshot({ path: '/tmp/e2e-07-after-next.png' });
  });

  test('Step 7: ▲ button scrolls to previous match', async () => {
    const countText = await page.locator('.session-detail__search-nav-count').textContent();
    const match = countText!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    const current = parseInt(match![1]);

    if (current <= 1) {
      console.log('SKIP: Already at first match');
      test.skip();
      return;
    }

    const scroller = page.locator('[data-virtuoso-scroller="true"]').first();
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);

    // Click ▲ (prev match) button
    const prevBtn = page.locator('.session-detail__search-nav button').first();
    await expect(prevBtn).toBeEnabled();
    await prevBtn.click();
    await page.waitForTimeout(800);

    const scrollAfter = await scroller.evaluate((el) => el.scrollTop);
    console.log(`Scroll: ${scrollBefore} → ${scrollAfter}`);
    expect(scrollAfter).not.toBe(scrollBefore);

    // Verify count went back
    const countAfter = await page.locator('.session-detail__search-nav-count').textContent();
    const matchAfter = countAfter!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    expect(parseInt(matchAfter![1])).toBe(current - 1);

    await page.screenshot({ path: '/tmp/e2e-08-after-prev.png' });
  });

  test('Step 8: Rapid ▼▼▼ clicks all register correctly', async () => {
    const countText = await page.locator('.session-detail__search-nav-count').textContent();
    const match = countText!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    const startIdx = parseInt(match![1]);
    const total = parseInt(match![2]);

    // Need at least 4 more matches to click 3 times
    const clicksAvailable = total - startIdx;
    const clicks = Math.min(3, clicksAvailable);

    if (clicks < 1) {
      console.log('SKIP: Not enough matches for rapid click test');
      test.skip();
      return;
    }

    const scroller = page.locator('[data-virtuoso-scroller="true"]').first();
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);

    // Click ▼ rapidly
    const nextBtn = page.locator('.session-detail__search-nav button').last();
    for (let i = 0; i < clicks; i++) {
      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForTimeout(150); // Minimal wait between clicks
      }
    }
    await page.waitForTimeout(800); // Wait for final scroll

    // Verify count advanced
    const countAfter = await page.locator('.session-detail__search-nav-count').textContent();
    const matchAfter = countAfter!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    const endIdx = parseInt(matchAfter![1]);
    console.log(`Rapid clicks: ${startIdx} → ${endIdx} (clicked ${clicks} times)`);
    expect(endIdx).toBe(startIdx + clicks);

    // Verify scroll position changed
    const scrollAfter = await scroller.evaluate((el) => el.scrollTop);
    console.log(`Scroll: ${scrollBefore} → ${scrollAfter}`);
    expect(scrollAfter).not.toBe(scrollBefore);

    await page.screenshot({ path: '/tmp/e2e-09-rapid.png' });
  });

});
