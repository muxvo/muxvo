/**
 * VERIFY: WaitingInput red border takes priority over selected amber border.
 *
 * Bug: .tile-selected (border-color: var(--accent)) overrides .tile--waiting
 * red border because both have same specificity (0,1,0) and selected appears
 * later in the CSS file.
 *
 * Fix: Added .tile--waiting.tile-selected compound selector (specificity 0,2,0).
 *
 * This test loads the real CSS in a browser and checks computed border-color.
 */
import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT = resolve(__dirname, '../..');

test.describe('VERIFY: WaitingInput border priority', () => {
  test('tile--waiting + tile-selected → computed border-color is red, not amber', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Load the real CSS files
    const themeCss = readFileSync(resolve(PROJECT, 'src/renderer/styles/theme.css'), 'utf-8');
    const tileEffectsCss = readFileSync(
      resolve(PROJECT, 'src/renderer/components/terminal/TileEffects.css'),
      'utf-8'
    );

    // Build a minimal HTML with the real CSS and test elements.
    // Disable animations so we test pure CSS specificity (cascade order),
    // not animation override behavior. The real bug is that when animations
    // are between keyframes or initializing, the static border-color wins.
    await page.setContent(`
      <html>
      <head>
        <style>${themeCss}</style>
        <style>${tileEffectsCss}</style>
        <style>*, *::before, *::after { animation: none !important; }</style>
      </head>
      <body>
        <!-- Case 1: only waiting (should be red) -->
        <div id="waiting-only" class="tile tile--waiting" style="width:100px;height:100px;"></div>
        <!-- Case 2: only selected (should be amber) -->
        <div id="selected-only" class="tile tile-selected" style="width:100px;height:100px;"></div>
        <!-- Case 3: both waiting + selected (should be red, NOT amber) -->
        <div id="both" class="tile tile--waiting tile-selected" style="width:100px;height:100px;"></div>
        <!-- Case 4: both waiting + focused (should be red) -->
        <div id="both-focused" class="tile tile--waiting tile-focused" style="width:100px;height:100px;"></div>
      </body>
      </html>
    `);

    // Helper: extract RGB components from computed border-color
    async function getBorderColor(selector: string) {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel)!;
        return getComputedStyle(el).borderColor;
      }, selector);
    }

    // Case 1: waiting-only → red border
    const waitingColor = await getBorderColor('#waiting-only');
    // Should contain red channel ~239, not amber ~232
    expect(waitingColor).toMatch(/rgba?\(239/);

    // Case 2: selected-only → amber border (--accent: #e8a748 = rgb(232, 167, 72))
    const selectedColor = await getBorderColor('#selected-only');
    expect(selectedColor).toMatch(/rgba?\(232/);

    // Case 3: CRITICAL — both waiting + selected → must be RED
    const bothColor = await getBorderColor('#both');
    expect(bothColor).toMatch(/rgba?\(239/);
    // Must NOT be amber
    expect(bothColor).not.toMatch(/rgba?\(232/);

    // Case 4: both waiting + focused → must be RED
    const bothFocusedColor = await getBorderColor('#both-focused');
    expect(bothFocusedColor).toMatch(/rgba?\(239/);

    await browser.close();
  });
});
