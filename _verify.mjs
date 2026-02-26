import { _electron } from '@playwright/test';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

const PROJECT = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
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

await window.screenshot({ path: `${SCREENSHOTS}/20-initial.png` });

// Add second terminal via FAB button
const fab = window.locator('.terminal-grid__fab');
if (await fab.isVisible({ timeout: 2000 }).catch(() => false)) {
  await fab.click();
  console.log('Clicked FAB');
} else {
  console.log('No FAB, trying Cmd+T');
  await window.keyboard.press('Meta+t');
}
await window.waitForTimeout(3000);

const tiles = await window.locator('.tile').all();
console.log('Tiles:', tiles.length);
await window.screenshot({ path: `${SCREENSHOTS}/21-two-tiles.png` });

for (let i = 0; i < tiles.length; i++) {
  const cls = await tiles[i].getAttribute('class');
  const styles = await tiles[i].evaluate(el => {
    const cs = getComputedStyle(el);
    return { borderColor: cs.borderColor, borderWidth: cs.borderWidth };
  });
  console.log(`Tile ${i}: class="${cls}" border="${styles.borderWidth} ${styles.borderColor}"`);
}

if (tiles.length >= 2) {
  await tiles[0].locator('.tile-header').dispatchEvent('mousedown');
  await window.waitForTimeout(500);
  await window.screenshot({ path: `${SCREENSHOTS}/22-tile0-selected.png` });
  for (let i = 0; i < tiles.length; i++) {
    const cls = await tiles[i].getAttribute('class');
    console.log(`Select0 — Tile ${i}: ${cls}`);
  }

  await tiles[1].locator('.tile-header').dispatchEvent('mousedown');
  await window.waitForTimeout(500);
  await window.screenshot({ path: `${SCREENSHOTS}/23-tile1-selected.png` });
  for (let i = 0; i < tiles.length; i++) {
    const cls = await tiles[i].getAttribute('class');
    console.log(`Select1 — Tile ${i}: ${cls}`);
  }
}

await app.close();
console.log('Done!');
