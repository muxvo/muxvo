/**
 * VERIFY: Dual-state visibility — selected(amber border) + waiting(red outline).
 *
 * When a terminal is both selected AND waiting for input, BOTH states must
 * be visible simultaneously:
 *   - border: amber (selected) — user knows which terminal is active
 *   - outline: red (waiting) — user knows it needs yes/no input
 *
 * This test loads the real CSS in a browser and checks computed styles.
 */
import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT = resolve(__dirname, '../..');

test.describe('VERIFY: Dual-state selected + waiting visibility', () => {
  test('selected+waiting → amber border + red outline (both visible)', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const themeCss = readFileSync(resolve(PROJECT, 'src/renderer/styles/theme.css'), 'utf-8');
    const tileEffectsCss = readFileSync(
      resolve(PROJECT, 'src/renderer/components/terminal/TileEffects.css'),
      'utf-8'
    );

    // Disable animations to test static CSS specificity
    await page.setContent(`
      <html>
      <head>
        <style>${themeCss}</style>
        <style>${tileEffectsCss}</style>
        <style>*, *::before, *::after { animation: none !important; }</style>
      </head>
      <body>
        <div id="waiting-only" class="tile tile--waiting" style="width:100px;height:100px;"></div>
        <div id="selected-only" class="tile tile-selected" style="width:100px;height:100px;"></div>
        <div id="both" class="tile tile--waiting tile-selected" style="width:100px;height:100px;"></div>
        <div id="both-focused" class="tile tile--waiting tile-focused" style="width:100px;height:100px;"></div>
      </body>
      </html>
    `);

    async function getStyles(selector: string) {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel)!;
        const cs = getComputedStyle(el);
        return {
          borderColor: cs.borderColor,
          outlineColor: cs.outlineColor,
          outlineWidth: cs.outlineWidth,
          outlineStyle: cs.outlineStyle,
        };
      }, selector);
    }

    // Case 1: waiting-only → red border + red outline
    const waitingOnly = await getStyles('#waiting-only');
    expect(waitingOnly.borderColor).toMatch(/rgba?\(239/);
    expect(waitingOnly.outlineStyle).not.toBe('none');

    // Case 2: selected-only → amber border, no outline
    const selectedOnly = await getStyles('#selected-only');
    expect(selectedOnly.borderColor).toMatch(/rgba?\(232/);

    // Case 3: CRITICAL — both selected + waiting
    const both = await getStyles('#both');
    // Border should be AMBER (selected state visible)
    expect(both.borderColor).toMatch(/rgba?\(232/);
    // Outline should be RED (waiting state visible)
    expect(both.outlineColor).toMatch(/rgba?\(239/);
    expect(both.outlineStyle).not.toBe('none');

    // Case 4: both focused + waiting → same pattern
    const bothFocused = await getStyles('#both-focused');
    // Outline should be RED
    expect(bothFocused.outlineColor).toMatch(/rgba?\(239/);
    expect(bothFocused.outlineStyle).not.toBe('none');

    await browser.close();
  });
});
