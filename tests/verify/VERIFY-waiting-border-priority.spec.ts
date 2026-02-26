/**
 * VERIFY: Dual-state visibility — selected(amber border) + waiting(red outline).
 *
 * Bug: When both selected + waiting, the `borderGlow` animation animates
 * border-color to red, overriding the static amber from .tile-selected.
 * User can't tell which terminal is selected.
 *
 * Fix: Compound selector applies `outlineGlow` (only animates outline-color)
 * instead of `borderGlow`, so amber border stays visible.
 *
 * Key assertion: animation-name on dual-state element must be `outlineGlow`,
 * not `borderGlow`.
 */
import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT = resolve(__dirname, '../..');

test.describe('VERIFY: Dual-state selected + waiting visibility', () => {
  test('selected+waiting uses outlineGlow (not borderGlow) to preserve amber border', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const themeCss = readFileSync(resolve(PROJECT, 'src/renderer/styles/theme.css'), 'utf-8');
    const tileEffectsCss = readFileSync(
      resolve(PROJECT, 'src/renderer/components/terminal/TileEffects.css'),
      'utf-8'
    );

    await page.setContent(`
      <html>
      <head>
        <style>${themeCss}</style>
        <style>${tileEffectsCss}</style>
      </head>
      <body>
        <div id="waiting-only" class="tile tile--waiting" style="width:100px;height:100px;"></div>
        <div id="selected-only" class="tile tile-selected" style="width:100px;height:100px;"></div>
        <div id="both" class="tile tile--waiting tile-selected" style="width:100px;height:100px;"></div>
        <div id="both-focused" class="tile tile--waiting tile-focused" style="width:100px;height:100px;"></div>
      </body>
      </html>
    `);

    async function getAnimationName(selector: string) {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel)!;
        return getComputedStyle(el).animationName;
      }, selector);
    }

    // waiting-only → borderGlow (full red border + outline animation)
    const waitingAnim = await getAnimationName('#waiting-only');
    expect(waitingAnim).toBe('borderGlow');

    // selected-only → no meaningful animation (just tileEnter or none)
    const selectedAnim = await getAnimationName('#selected-only');
    expect(selectedAnim).not.toContain('borderGlow');
    expect(selectedAnim).not.toContain('outlineGlow');

    // CRITICAL: both selected + waiting → outlineGlow (NOT borderGlow)
    // borderGlow would animate border-color to red, hiding the amber selected state
    // outlineGlow only animates outline-color, keeping amber border visible
    const bothAnim = await getAnimationName('#both');
    expect(bothAnim).toBe('outlineGlow');

    // both focused + waiting → same: outlineGlow
    const bothFocusedAnim = await getAnimationName('#both-focused');
    expect(bothFocusedAnim).toBe('outlineGlow');

    await browser.close();
  });
});
