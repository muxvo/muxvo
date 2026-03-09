/**
 * screenshot-worktree.ts — Capture Worktree feature screenshots.
 *
 * Uses macOS screencapture + Python/Quartz for UI interaction.
 * Prerequisites: Muxvo must be running via `npx electron-vite dev`.
 *
 * Usage: npx tsx scripts/screenshot-worktree.ts
 */

import { execSync, execFileSync } from 'child_process';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

const PROJECT = resolve(__dirname, '..');
const OUT_DIR = resolve(PROJECT, 'docs/screenshots/worktree');
mkdirSync(OUT_DIR, { recursive: true });

function sleep(ms: number) {
  execSync(`sleep ${ms / 1000}`);
}

function osascript(...lines: string[]): string {
  const args = lines.flatMap((l) => ['-e', l]);
  return execFileSync('osascript', args, { encoding: 'utf-8' }).trim();
}

/** Get the Muxvo window ID from CoreGraphics */
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
  const wid = parseInt(result);
  if (!wid) throw new Error('Could not find Muxvo window. Is electron-vite dev running?');
  return wid;
}

/** Capture window screenshot */
function capture(windowId: number, filename: string): void {
  const filepath = resolve(OUT_DIR, filename);
  execSync(`screencapture -l ${windowId} "${filepath}"`);
  console.log(`  📸 ${filename}`);
}

/** Get window position and size */
function getWindowRect(): { x: number; y: number; w: number; h: number } {
  const pos = osascript(
    'tell application "System Events"',
    '  tell process "Electron"',
    '    set p to position of window 1',
    '    set s to size of window 1',
    '    return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)',
    '  end tell',
    'end tell',
  );
  const [x, y, w, h] = pos.split(',').map(Number);
  return { x, y, w, h };
}

/** Click at (x, y) relative to window origin using Quartz events */
function clickAt(relX: number, relY: number): void {
  const { x, y } = getWindowRect();
  const absX = x + relX;
  const absY = y + relY;
  const py = `
import Quartz, time
p = Quartz.CGPointMake(${absX}, ${absY})
d = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, p, Quartz.kCGMouseButtonLeft)
u = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, p, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, d)
time.sleep(0.05)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, u)
`;
  execFileSync('python3', ['-c', py]);
}

/** Press Escape key */
function pressEscape(): void {
  osascript(
    'tell application "System Events"',
    '  key code 53',
    'end tell',
  );
}

/** Bring window to front */
function focusWindow(): void {
  osascript(
    'tell application "System Events"',
    '  tell process "Electron"',
    '    set frontmost to true',
    '  end tell',
    'end tell',
  );
  sleep(500);
}

function main() {
  console.log('Finding Muxvo window...');
  const windowId = getWindowId();
  const rect = getWindowRect();
  console.log(`Window ID: ${windowId}, Pos: (${rect.x},${rect.y}), Size: ${rect.w}x${rect.h}`);

  focusWindow();

  // Step 1: Click "+" FAB to create a terminal (bottom-right corner)
  console.log('\nStep 1: Creating terminal...');
  clickAt(rect.w - 40, rect.h - 40);
  sleep(4000);

  // Step 2: Full window with terminal
  console.log('Step 2: Full window screenshot...');
  capture(windowId, 'shot-01-full-window.png');

  // Step 3: Click worktree branch icon in tile header
  // The header is about 60px from top, action buttons are on the right side
  // Button order from right: [close ~20px] [max ~50px] [file ~80px] [worktree ~115px]
  console.log('Step 3: Opening Worktree popover...');
  clickAt(rect.w - 115, 60);
  sleep(1200);
  capture(windowId, 'shot-02-popover-initial.png');

  // Step 4: Click "+ New Worktree" in the popover
  // The popover header "Worktrees" is about 25px, then the create button
  console.log('Step 4: Creating new worktree...');
  clickAt(rect.w - 115, 60 + 55); // Create button position in popover
  sleep(6000);
  capture(windowId, 'shot-03-after-create.png');

  // Step 5: Open popover again to show worktree list
  console.log('Step 5: Showing worktree list...');
  clickAt(rect.w - 115, 60);
  sleep(1200);
  capture(windowId, 'shot-04-popover-list.png');

  // Close popover
  pressEscape();
  sleep(500);

  // Step 6: Header close-up (full window, can crop later)
  console.log('Step 6: Badge close-up...');
  capture(windowId, 'shot-05-worktree-badge.png');

  console.log('\nAll screenshots saved to:', OUT_DIR);
}

main();
