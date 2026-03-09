/**
 * screenshot-worktree.ts — Capture Worktree feature screenshots.
 *
 * Uses macOS screencapture for window captures + CDP (Chrome DevTools Protocol)
 * for interacting with the renderer.
 *
 * Prerequisites:
 *   npx electron-vite dev --remoteDebuggingPort 9222
 *
 * Usage: npx tsx scripts/screenshot-worktree.ts
 */

import { execSync, execFileSync } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import WebSocket from 'ws';

const PROJECT = resolve(__dirname, '..');
const OUT_DIR = resolve(PROJECT, 'docs/screenshots/worktree');
mkdirSync(OUT_DIR, { recursive: true });

const CDP_PORT = 9222;

// ─── CDP Helper ───

let ws: WebSocket;
let msgId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

async function cdpConnect(): Promise<void> {
  const listRes = await fetch(`http://localhost:${CDP_PORT}/json/list`);
  const pages = await listRes.json();
  const page = pages.find((p: any) => p.type === 'page');
  if (!page) throw new Error('No page found');

  return new Promise((resolve, reject) => {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => resolve());
    ws.on('error', reject);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(msg.error);
        else p.resolve(msg.result);
      }
    });
  });
}

function cdpSend(method: string, params?: any): Promise<any> {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function cdpEval(expression: string): Promise<any> {
  const result = await cdpSend('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result?.result?.value;
}

async function cdpClick(selector: string): Promise<boolean> {
  return cdpEval(`
    (function() {
      const el = document.querySelector('${selector}');
      if (!el) return false;
      el.click();
      return true;
    })()
  `);
}

async function cdpScreenshot(filename: string): Promise<void> {
  const result = await cdpSend('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(result.data, 'base64');
  writeFileSync(resolve(OUT_DIR, filename), buffer);
  console.log(`  📸 ${filename}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── macOS Window Capture ───

function getWindowId(): number {
  const py = `
import Quartz
windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
for w in windows:
    if w.get('kCGWindowOwnerName','') == 'Electron' and w.get('kCGWindowName','') == 'Muxvo':
        print(w.get('kCGWindowNumber', 0))
        break
`;
  const result = execFileSync('python3', ['-c', py], { encoding: 'utf-8' }).trim();
  return parseInt(result) || 0;
}

function captureWindow(windowId: number, filename: string): void {
  const filepath = resolve(OUT_DIR, filename);
  execSync(`screencapture -l ${windowId} "${filepath}"`);
  console.log(`  📸 ${filename} (window capture)`);
}

// ─── Main ───

async function main() {
  console.log('Connecting to CDP...');
  await cdpConnect();
  console.log('Connected!');

  const windowId = getWindowId();
  console.log('Window ID:', windowId);

  // Wait for initial render
  await sleep(2000);

  // Check if there's a terminal already
  const hasTile = await cdpEval(`!!document.querySelector('.tile-header')`);

  if (!hasTile) {
    console.log('\nStep 1: Creating terminal via IPC...');
    // Use the terminal API directly to create a terminal in the project dir
    const createResult = await cdpEval(`
      (async () => {
        try {
          const cwd = '${PROJECT.replace(/'/g, "\\'")}';
          const result = await window.api.terminal.create(cwd, 80, 24);
          return JSON.stringify(result);
        } catch(e) {
          return 'ERROR: ' + e.message;
        }
      })()
    `);
    console.log('  Terminal create result:', createResult);
    await sleep(5000);

    // Check if FAB approach works now (the state might need React dispatch)
    const hasTile2 = await cdpEval(`!!document.querySelector('.tile-header')`);
    if (!hasTile2) {
      // Try clicking FAB after IPC terminal creation
      console.log('  Trying FAB click...');
      await cdpClick('.terminal-grid__fab');
      await sleep(4000);
    }
  }

  // Verify terminal exists
  const tileExists = await cdpEval(`!!document.querySelector('.tile-header')`);
  if (!tileExists) {
    console.error('ERROR: Terminal tile not created.');
    const html = await cdpEval(`document.body.innerHTML.substring(0, 1000)`);
    console.log('Body:', html);
    await cdpScreenshot('debug-no-terminal.png');
    ws.close();
    return;
  }

  // ── Shot 1: Full window with terminal ──
  console.log('\nStep 2: Full window with terminal...');
  if (windowId) captureWindow(windowId, 'shot-01-full-window.png');
  await cdpScreenshot('shot-01-full-window-cdp.png');

  // Check if worktree button is visible (only in git repos)
  const hasWorktreeBtn = await cdpEval(`!!document.querySelector('.tile-worktree-btn')`);
  if (!hasWorktreeBtn) {
    console.log('No worktree button visible — terminal may not be in a git repo.');
    console.log('Attempting to cd to a git repo...');

    // Get the project path (which is a git repo)
    const gitRepo = PROJECT;
    // Type cd command in terminal — find terminal ID and write to it
    await cdpEval(`
      (async () => {
        const terminals = document.querySelectorAll('.tile-header');
        if (terminals.length > 0) {
          // Click terminal to focus it, then we'll use the IPC
          terminals[0].click();
        }
      })()
    `);
    await sleep(500);

    // Use IPC to write to terminal
    await cdpEval(`
      (async () => {
        const termState = window.__TERMINAL_STATE__;
        // Fallback: directly use the API
        const list = await window.api.terminal.list();
        if (list && list.data && list.data.length > 0) {
          const id = list.data[0].id;
          await window.api.terminal.write(id, 'cd ${gitRepo.replace(/'/g, "\\'")} && clear\\r');
        }
      })()
    `);
    await sleep(3000);

    // Check again
    const hasBtn2 = await cdpEval(`!!document.querySelector('.tile-worktree-btn')`);
    if (!hasBtn2) {
      console.log('Still no worktree button. Taking what we have and continuing...');
    }
  }

  // Re-check
  const worktreeVisible = await cdpEval(`!!document.querySelector('.tile-worktree-btn')`);
  if (!worktreeVisible) {
    console.log('Worktree button not available. Exiting.');
    ws.close();
    return;
  }

  // ── Shot 2: Click branch icon → Open Worktree popover ──
  console.log('\nStep 3: Opening Worktree popover...');
  await cdpClick('.tile-worktree-btn');
  await sleep(1200);

  const popoverVisible = await cdpEval(`!!document.querySelector('.worktree-popover')`);
  console.log('  Popover visible:', popoverVisible);

  if (windowId) captureWindow(windowId, 'shot-02-popover-initial.png');
  await cdpScreenshot('shot-02-popover-initial-cdp.png');

  // ── Shot 3: Create new worktree ──
  console.log('\nStep 4: Creating new worktree...');
  const createClicked = await cdpClick('.worktree-popover__create');
  console.log('  Create clicked:', createClicked);
  await sleep(6000);

  if (windowId) captureWindow(windowId, 'shot-03-after-create.png');
  await cdpScreenshot('shot-03-after-create-cdp.png');

  // ── Shot 5: Worktree badge close-up ──
  const hasBadge = await cdpEval(`!!document.querySelector('.tile-worktree-badge')`);
  if (hasBadge) {
    console.log('\nStep 5: Capturing worktree badge...');
    // Capture just the header area via CDP element screenshot
    const headerBox = await cdpEval(`
      (function() {
        const h = document.querySelector('.tile-header');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);
    if (headerBox) {
      const clip = { ...headerBox, scale: 2 };
      const result = await cdpSend('Page.captureScreenshot', { format: 'png', clip });
      writeFileSync(resolve(OUT_DIR, 'shot-05-worktree-badge.png'), Buffer.from(result.data, 'base64'));
      console.log('  📸 shot-05-worktree-badge.png');
    }
  }

  // ── Shot 4: Open popover again → Show list with current badge ──
  console.log('\nStep 6: Showing worktree list...');
  await cdpClick('.tile-worktree-btn');
  await sleep(1200);

  if (windowId) captureWindow(windowId, 'shot-04-popover-list.png');
  await cdpScreenshot('shot-04-popover-list-cdp.png');

  // Also capture just the popover
  const popoverBox = await cdpEval(`
    (function() {
      const p = document.querySelector('.worktree-popover');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()
  `);
  if (popoverBox) {
    const clip = { ...popoverBox, scale: 2 };
    const result = await cdpSend('Page.captureScreenshot', { format: 'png', clip });
    writeFileSync(resolve(OUT_DIR, 'shot-04-popover-closeup.png'), Buffer.from(result.data, 'base64'));
    console.log('  📸 shot-04-popover-closeup.png');
  }

  // Close popover
  await cdpEval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(300);

  console.log('\nAll screenshots saved to:', OUT_DIR);
  ws.close();
}

main().catch((err) => {
  console.error('Failed:', err);
  ws?.close();
  process.exit(1);
});
