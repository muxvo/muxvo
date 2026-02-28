/**
 * VERIFY: Tile selection should NOT change border-width (prevents flicker).
 *
 * Bug: .tile has border: 1px, .tile-selected adds border-width: 2px.
 * This causes xterm ResizeObserver → fitAddon.fit() → content reflow → visible flicker.
 *
 * Fix: .tile always uses 2px border; .tile-selected only changes border-color.
 *
 * Key assertion: computed border-width is identical for .tile and .tile-selected.
 */
import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT = resolve(__dirname, '../..');

test.describe('VERIFY: Tile border-width stays constant on selection', () => {
  test('selected tile has same border-width as unselected tile (no layout shift)', async () => {
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
        <div id="normal" class="tile" style="width:200px;height:100px;"></div>
        <div id="selected" class="tile tile-selected" style="width:200px;height:100px;"></div>
      </body>
      </html>
    `);

    const normalBorder = await page.evaluate(() => {
      return getComputedStyle(document.querySelector('#normal')!).borderWidth;
    });

    const selectedBorder = await page.evaluate(() => {
      return getComputedStyle(document.querySelector('#selected')!).borderWidth;
    });

    // Both must have identical border-width — any difference causes layout shift → flicker
    expect(normalBorder).toBe(selectedBorder);

    // Verify border-width is 2px (our chosen constant value)
    expect(normalBorder).toBe('2px');

    await browser.close();
  });
});
