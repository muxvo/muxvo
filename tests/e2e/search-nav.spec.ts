/**
 * E2E Test: Chat Search Navigation Scroll Behavior
 *
 * Verifies that clicking ▲▼ buttons in the search navigation bar
 * actually scrolls the Virtuoso list to the matched messages.
 *
 * Run: npx electron-vite build && npx playwright test tests/e2e/search-nav.spec.ts
 */

import { test, expect, _electron as electron } from '@playwright/test';

test('Search navigation: ▼▲ buttons scroll to matched messages', async () => {
  // ── Launch Electron app ────────────────────────────────────────
  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  try {
    // ── Step 1: Navigate to Chat History tab ───────────────────
    console.log('Step 1: Navigate to Chat History tab');
    const chatTab = page.locator('.menu-bar__tab', { hasText: /历史聊天|Chat History/ });
    await expect(chatTab).toBeVisible({ timeout: 10000 });
    await chatTab.click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.chat-history-panel')).toBeVisible({ timeout: 10000 });
    console.log('  ✅ Chat history panel visible');

    // ── Step 2: Wait for sessions to load ──────────────────────
    console.log('Step 2: Wait for sessions to load');
    await expect(page.locator('.session-card').first()).toBeVisible({ timeout: 20000 });
    const cardCount = await page.locator('.session-card').count();
    console.log(`  ✅ ${cardCount} session cards loaded`);

    // ── Step 3: Enter search query ─────────────────────────────
    console.log('Step 3: Enter search query');
    const searchInput = page.locator('.search-input-wrap__input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('你好');
    await page.waitForTimeout(2500); // Debounce (300ms) + search time

    const resultCount = await page.locator('.session-card').count();
    console.log(`  ✅ Search returned ${resultCount} sessions`);
    expect(resultCount).toBeGreaterThan(0);
    await page.screenshot({ path: '/tmp/e2e-03-search-results.png' });

    // ── Step 4: Click first session to load messages ───────────
    console.log('Step 4: Click first session');
    await page.locator('.session-card').first().click();
    await page.waitForTimeout(3000);

    // Verify messages loaded
    const messageBubbles = page.locator('.message-bubble');
    await expect(messageBubbles.first()).toBeVisible({ timeout: 10000 });
    const msgCount = await messageBubbles.count();
    console.log(`  ✅ ${msgCount} message bubbles loaded`);
    await page.screenshot({ path: '/tmp/e2e-04-messages.png' });

    // ── Step 5: Check search navigation bar ────────────────────
    console.log('Step 5: Check search navigation bar');
    const navBar = page.locator('.session-detail__search-nav');
    await expect(navBar).toBeVisible({ timeout: 5000 });

    const countText = await page.locator('.session-detail__search-nav-count').textContent();
    console.log(`  Match count: ${countText?.trim()}`);
    const match = countText!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    expect(match).toBeTruthy();
    const total = parseInt(match![2]);
    console.log(`  ✅ Nav bar visible, ${total} matches`);
    await page.screenshot({ path: '/tmp/e2e-05-nav-bar.png' });

    if (total < 2) {
      console.log('  ⚠️  Only 1 match — cannot test ▼ navigation. Trying different session...');
      // Try clicking a different session
      const cards = page.locator('.session-card');
      const totalCards = await cards.count();
      let foundMultiMatch = false;
      for (let i = 1; i < Math.min(totalCards, 5); i++) {
        await cards.nth(i).click();
        await page.waitForTimeout(2000);
        const ct = await page.locator('.session-detail__search-nav-count').textContent();
        const m = ct?.trim().match(/(\d+)\s*\/\s*(\d+)/);
        if (m && parseInt(m[2]) >= 2) {
          console.log(`  ✅ Found session with ${m[2]} matches at index ${i}`);
          foundMultiMatch = true;
          break;
        }
      }
      if (!foundMultiMatch) {
        console.log('  ⚠️  No session found with >= 2 matches. Skipping scroll test.');
        return;
      }
    }

    // ── Step 6: CORE TEST — ▼ button scrolls ──────────────────
    console.log('Step 6: ▼ button scrolls (CORE TEST)');

    // Find the Virtuoso scroller
    // Virtuoso creates a div with data-testid="virtuoso-scroller" or we find it by structure
    let scroller = page.locator('[data-testid="virtuoso-scroller"]').first();
    let hasScroller = await scroller.count() > 0;
    if (!hasScroller) {
      // Fallback: find the scrollable container in session-detail
      // Virtuoso typically renders: div[data-virtuoso-scroller] > div > div[data-viewport-type]
      scroller = page.locator('[data-virtuoso-scroller="true"]').first();
      hasScroller = await scroller.count() > 0;
    }
    if (!hasScroller) {
      // Last resort: find by evaluating scrollHeight > clientHeight
      const detailDivs = page.locator('.session-detail div');
      const count = await detailDivs.count();
      for (let i = 0; i < Math.min(count, 20); i++) {
        const d = detailDivs.nth(i);
        const info = await d.evaluate((el) => ({
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          className: el.className
        }));
        if (info.scrollH > info.clientH + 50) {
          scroller = detailDivs.nth(i);
          hasScroller = true;
          console.log(`  Found scrollable div: ${info.className} (scrollH=${info.scrollH}, clientH=${info.clientH})`);
          break;
        }
      }
    }

    expect(hasScroller).toBeTruthy();
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
    console.log(`  Scroll before ▼: ${scrollBefore}`);

    // Click ▼ (next match) — it's the last button in nav bar
    const buttons = page.locator('.session-detail__search-nav button');
    const btnCount = await buttons.count();
    const nextBtn = buttons.nth(btnCount - 1); // Last button = ▼
    const prevBtn = buttons.nth(btnCount - 2); // Second to last = ▲

    const isNextDisabled = await nextBtn.isDisabled();
    console.log(`  ▼ button disabled: ${isNextDisabled}`);
    expect(isNextDisabled).toBe(false);

    await nextBtn.click();
    await page.waitForTimeout(1000);

    const scrollAfter = await scroller.evaluate((el) => el.scrollTop);
    console.log(`  Scroll after ▼: ${scrollAfter}`);

    // CORE ASSERTION
    if (scrollAfter !== scrollBefore) {
      console.log(`  ✅ PASS: Scroll changed ${scrollBefore} → ${scrollAfter}`);
    } else {
      console.log(`  ❌ FAIL: Scroll DID NOT CHANGE (still ${scrollAfter})`);
    }
    expect(scrollAfter).not.toBe(scrollBefore);

    // Verify counter updated
    const countAfterNext = await page.locator('.session-detail__search-nav-count').textContent();
    console.log(`  Counter after ▼: ${countAfterNext?.trim()}`);
    const matchAfter = countAfterNext!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    expect(parseInt(matchAfter![1])).toBe(2);
    await page.screenshot({ path: '/tmp/e2e-06-after-next.png' });

    // ── Step 7: ▲ button scrolls back ─────────────────────────
    console.log('Step 7: ▲ button scrolls back');
    const scrollBeforePrev = await scroller.evaluate((el) => el.scrollTop);
    await prevBtn.click();
    await page.waitForTimeout(1000);

    const scrollAfterPrev = await scroller.evaluate((el) => el.scrollTop);
    console.log(`  Scroll: ${scrollBeforePrev} → ${scrollAfterPrev}`);
    if (scrollAfterPrev !== scrollBeforePrev) {
      console.log(`  ✅ PASS: Scroll changed`);
    } else {
      console.log(`  ❌ FAIL: Scroll DID NOT CHANGE`);
    }
    expect(scrollAfterPrev).not.toBe(scrollBeforePrev);

    const countAfterPrev = await page.locator('.session-detail__search-nav-count').textContent();
    const matchPrev = countAfterPrev!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    expect(parseInt(matchPrev![1])).toBe(1);
    await page.screenshot({ path: '/tmp/e2e-07-after-prev.png' });

    // ── Step 8: Rapid ▼▼▼ clicks ──────────────────────────────
    console.log('Step 8: Rapid ▼▼▼ clicks');
    const countBefore = await page.locator('.session-detail__search-nav-count').textContent();
    const startMatch = countBefore!.trim().match(/(\d+)\s*\/\s*(\d+)/);
    const startIdx = parseInt(startMatch![1]);
    const totalMatches = parseInt(startMatch![2]);
    const rapidClicks = Math.min(3, totalMatches - startIdx);

    if (rapidClicks < 1) {
      console.log('  ⚠️  Not enough matches for rapid test');
    } else {
      const scrollBeforeRapid = await scroller.evaluate((el) => el.scrollTop);
      for (let i = 0; i < rapidClicks; i++) {
        if (await nextBtn.isEnabled()) {
          await nextBtn.click();
          await page.waitForTimeout(200);
        }
      }
      await page.waitForTimeout(1000);

      const countAfterRapid = await page.locator('.session-detail__search-nav-count').textContent();
      const rapidMatch = countAfterRapid!.trim().match(/(\d+)\s*\/\s*(\d+)/);
      const endIdx = parseInt(rapidMatch![1]);
      console.log(`  Rapid: ${startIdx} → ${endIdx} (clicked ${rapidClicks})`);
      expect(endIdx).toBe(startIdx + rapidClicks);

      const scrollAfterRapid = await scroller.evaluate((el) => el.scrollTop);
      console.log(`  Scroll: ${scrollBeforeRapid} → ${scrollAfterRapid}`);
      if (scrollAfterRapid !== scrollBeforeRapid) {
        console.log(`  ✅ PASS: Scroll changed after rapid clicks`);
      } else {
        console.log(`  ❌ FAIL: Scroll DID NOT CHANGE after rapid clicks`);
      }
      expect(scrollAfterRapid).not.toBe(scrollBeforeRapid);
    }

    await page.screenshot({ path: '/tmp/e2e-08-rapid.png' });
    console.log('\n✅ All search navigation tests passed!');

  } finally {
    await app.close();
  }
});
