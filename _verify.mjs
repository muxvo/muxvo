import { _electron } from '@playwright/test';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

const PROJECT = '/Users/rl/Nutstore_Files/my_nutstore/520-program/muxvo';
const SCREENSHOTS = '/tmp/muxvo-screenshots';
mkdirSync(SCREENSHOTS, { recursive: true });

const app = await _electron.launch({
  args: [resolve(PROJECT, 'out/main/index.js')],
  cwd: PROJECT,
  env: { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' },
});

const window = await app.firstWindow();
await window.waitForTimeout(6000);
await window.waitForLoadState('networkidle');

// Find + button at bottom-right and click to add second terminal
await window.screenshot({ path: `${SCREENSHOTS}/10-before-add.png` });

// Look for the add button - it's the golden circle with + at bottom right
const svgPlus = await window.locator('svg').all();
console.log(`SVGs found: ${svgPlus.length}`);

// Try common selectors
for (const sel of ['.add-terminal-btn', '.floating-add', '[aria-label*="add"]', '[title*="add"]']) {
  const cnt = await window.locator(sel).count();
  if (cnt > 0) console.log(`Found ${cnt} elements matching "${sel}"`);
}

// Dump all clickable elements near bottom of page
const allBtns = await window.locator('button, [role="button"], [onclick]').all();
console.log(`Total buttons: ${allBtns.length}`);
for (const b of allBtns) {
  const box = await b.boundingBox();
  const txt = await b.textContent();
  if (box && box.y > 500) {
    console.log(`  Button at (${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.width)}x${Math.round(box.height)} text="${txt?.trim()}"`);
  }
}

// The + button in screenshot appears at bottom-right corner
// Window size is ~1366x880 based on screenshot, so try clicking at bottom-right
const viewport = window.viewportSize();
console.log(`Viewport: ${JSON.stringify(viewport)}`);

// Click the + circle button at bottom-right
await window.mouse.click(viewport.width - 40, viewport.height - 40);
await window.waitForTimeout(3000);

let tiles = await window.locator('.tile').all();
console.log(`After click +: ${tiles.length} tiles`);

if (tiles.length < 2) {
  // Try other positions
  await window.mouse.click(viewport.width - 60, viewport.height - 60);
  await window.waitForTimeout(3000);
  tiles = await window.locator('.tile').all();
  console.log(`After second try: ${tiles.length} tiles`);
}

await window.screenshot({ path: `${SCREENSHOTS}/11-after-add.png` });

// Check initial selection state
for (let i = 0; i < tiles.length; i++) {
  const cls = await tiles[i].getAttribute('class');
  console.log(`Initial - Tile ${i}: ${cls}`);
}

if (tiles.length >= 2) {
  // Click header of tile 0
  const tile0Header = tiles[0].locator('.tile-header').first();
  await tile0Header.dispatchEvent('mousedown');
  await window.waitForTimeout(500);
  await window.screenshot({ path: `${SCREENSHOTS}/12-tile0-selected.png` });

  for (let i = 0; i < tiles.length; i++) {
    const cls = await tiles[i].getAttribute('class');
    console.log(`Select tile0 - Tile ${i}: ${cls}`);
  }

  // Click header of tile 1
  const tile1Header = tiles[1].locator('.tile-header').first();
  await tile1Header.dispatchEvent('mousedown');
  await window.waitForTimeout(500);
  await window.screenshot({ path: `${SCREENSHOTS}/13-tile1-selected.png` });

  for (let i = 0; i < tiles.length; i++) {
    const cls = await tiles[i].getAttribute('class');
    console.log(`Select tile1 - Tile ${i}: ${cls}`);
  }

  // Compute border styles
  for (let i = 0; i < tiles.length; i++) {
    const styles = await tiles[i].evaluate(el => {
      const cs = getComputedStyle(el);
      return {
        borderColor: cs.borderColor,
        borderWidth: cs.borderWidth,
        boxShadow: cs.boxShadow,
        outline: cs.outline,
      };
    });
    console.log(`Tile ${i} computed styles:`, JSON.stringify(styles));
  }
}

await app.close();
console.log('Done!');
