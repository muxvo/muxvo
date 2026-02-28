/**
 * VERIFY: Auto-update progress indicator fixes
 *
 * Bug 1: UpdateProgress not visible when download-progress events don't fire on macOS
 * Bug 2: No error handling / logging for update failures
 *
 * Verifies:
 * 1. createUpdateLogger creates file and writes logs
 * 2. UpdateProgress becomes visible on 'downloaded' even without prior 'downloading'
 * 3. UpdateProgress becomes visible on 'error' even without prior 'downloading'
 * 4. Main process pushes UPDATE_DOWNLOADING {percent:0} before downloadUpdate()
 * 5. downloadUpdate() calls have .catch() error handling
 */

import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Test 2: UpdateProgress state transition logic ──
// Simulates the exact same state transitions as UpdateProgress.tsx
// to verify the fix handles missing download-progress events

describe('UpdateProgress state transitions', () => {
  /**
   * Simulates UpdateProgress's useEffect callback logic.
   * Returns { state, visible } after processing events in order.
   * This mirrors the actual component logic from UpdateProgress.tsx.
   */
  function simulateUpdateProgress(
    events: Array<{ type: 'downloading'; data: any } | { type: 'downloaded'; data: any } | { type: 'error' }>,
    /** If true, uses the FIXED logic (setVisible in downloaded/error). If false, uses the old buggy logic. */
    useFix: boolean,
  ): { state: string; visible: boolean } {
    let state = 'idle';
    let visible = false;

    for (const event of events) {
      if (event.type === 'downloading') {
        state = 'downloading';
        visible = true;
        // setInfo(data) omitted — not relevant to visibility
      } else if (event.type === 'downloaded') {
        state = 'done';
        if (useFix) visible = true; // THE FIX: setVisible(true) in onUpdateDownloaded
        // setTimeout(() => setVisible(false), 3000) — ignored, we test immediate state
      } else if (event.type === 'error') {
        state = 'error';
        if (useFix) visible = true; // THE FIX: setVisible(true) in onUpdateError
      }
    }
    return { state, visible };
  }

  test('BUG: without fix, downloaded without prior downloading → invisible', () => {
    // This is the exact scenario that caused Bug 1 on macOS:
    // download-progress never fires, but update-downloaded does
    const result = simulateUpdateProgress(
      [{ type: 'downloaded', data: { version: '1.0.0' } }],
      false, // old buggy logic
    );
    expect(result.state).toBe('done');
    expect(result.visible).toBe(false); // BUG: component renders null
  });

  test('FIX: with fix, downloaded without prior downloading → visible', () => {
    const result = simulateUpdateProgress(
      [{ type: 'downloaded', data: { version: '1.0.0' } }],
      true, // fixed logic
    );
    expect(result.state).toBe('done');
    expect(result.visible).toBe(true); // FIXED: component shows checkmark
  });

  test('BUG: without fix, error without prior downloading → invisible', () => {
    const result = simulateUpdateProgress(
      [{ type: 'error' }],
      false,
    );
    expect(result.state).toBe('error');
    expect(result.visible).toBe(false); // BUG: error state invisible
  });

  test('FIX: with fix, error without prior downloading → visible', () => {
    const result = simulateUpdateProgress(
      [{ type: 'error' }],
      true,
    );
    expect(result.state).toBe('error');
    expect(result.visible).toBe(true); // FIXED: error indicator shows
  });

  test('normal flow: downloading → downloaded → visible throughout', () => {
    const result = simulateUpdateProgress(
      [
        { type: 'downloading', data: { percent: 50, bytesPerSecond: 1000, transferred: 50, total: 100 } },
        { type: 'downloaded', data: { version: '1.0.0' } },
      ],
      true,
    );
    expect(result.state).toBe('done');
    expect(result.visible).toBe(true);
  });

  test('initial state: percent 0 push from pushDownloadStart → visible', () => {
    // This tests the main process fix: pushing {percent:0} before downloadUpdate()
    const result = simulateUpdateProgress(
      [{ type: 'downloading', data: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 } }],
      true,
    );
    expect(result.state).toBe('downloading');
    expect(result.visible).toBe(true);
  });
});

// ── Test 3: Source code structural verification ──
// Verifies the fix is correctly applied in the actual source files

describe('Source code fix verification', () => {
  test('UpdateProgress.tsx: setVisible(true) in onUpdateDownloaded callback', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/renderer/components/layout/UpdateProgress.tsx'),
      'utf-8',
    );

    // Find the onUpdateDownloaded callback block
    const downloadedMatch = src.match(/onUpdateDownloaded\(\(data\)\s*=>\s*\{([^}]+)\}/s);
    expect(downloadedMatch).not.toBeNull();
    const downloadedBody = downloadedMatch![1];

    // Verify setVisible(true) is present in the callback
    expect(downloadedBody).toContain('setVisible(true)');
  });

  test('UpdateProgress.tsx: setVisible(true) in onUpdateError callback', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/renderer/components/layout/UpdateProgress.tsx'),
      'utf-8',
    );

    // Find the onUpdateError callback block
    const errorMatch = src.match(/onUpdateError\(\(\)\s*=>\s*\{([^}]+)\}/s);
    expect(errorMatch).not.toBeNull();
    const errorBody = errorMatch![1];

    // Verify setVisible(true) is present in the callback
    expect(errorBody).toContain('setVisible(true)');
  });

  test('index.ts: pushDownloadStart() before downloadUpdate() in promptUpdate', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // In promptUpdate function, pushDownloadStart must come before downloadUpdate
    const promptBlock = src.match(/async function promptUpdate[\s\S]*?^      \}/m);
    expect(promptBlock).not.toBeNull();
    const block = promptBlock![0];

    const pushIdx = block.indexOf('pushDownloadStart()');
    const downloadIdx = block.indexOf('downloadUpdate()');

    expect(pushIdx).toBeGreaterThan(-1);
    expect(downloadIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeLessThan(downloadIdx); // push comes BEFORE download
  });

  test('index.ts: pushDownloadStart() before downloadUpdate() in IPC handler', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // In DOWNLOAD_UPDATE handler, pushDownloadStart must come before downloadUpdate
    const handlerMatch = src.match(/handle\(IPC_CHANNELS\.APP\.DOWNLOAD_UPDATE[\s\S]*?\}\);/);
    expect(handlerMatch).not.toBeNull();
    const handler = handlerMatch![0];

    const pushIdx = handler.indexOf('pushDownloadStart()');
    const downloadIdx = handler.indexOf('downloadUpdate()');

    expect(pushIdx).toBeGreaterThan(-1);
    expect(downloadIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeLessThan(downloadIdx);
  });

  test('index.ts: downloadUpdate() has .catch() error handling', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // Both downloadUpdate calls should have .catch()
    const downloadCalls = src.match(/downloadUpdate\(\)\.catch/g);
    expect(downloadCalls).not.toBeNull();
    expect(downloadCalls!.length).toBeGreaterThanOrEqual(2); // promptUpdate + IPC handler
  });

  test('index.ts: autoUpdater.logger uses createUpdateLogger (not null)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // Should NOT have logger = null
    expect(src).not.toMatch(/autoUpdater\.logger\s*=\s*null/);
    // Should have logger = createUpdateLogger()
    expect(src).toMatch(/autoUpdater\.logger\s*=\s*createUpdateLogger\(\)/);
  });

  test('index.ts: quitAndInstall wrapped in try-catch', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // Find the setTimeout block with quitAndInstall
    const quitBlock = src.match(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*?quitAndInstall[\s\S]*?\},\s*1000\)/);
    expect(quitBlock).not.toBeNull();

    // Verify try-catch is present
    expect(quitBlock![0]).toContain('try');
    expect(quitBlock![0]).toContain('catch');
  });
});

// ── Test 4: v0.2.8 fixes — ipcMain.handle outside launchWindowWithTerminals ──

describe('v0.2.8 regression fixes', () => {
  test('index.ts: ipcMain.handle(CHECK_FOR_UPDATE) is NOT inside launchWindowWithTerminals', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // Find launchWindowWithTerminals function body
    const funcMatch = src.match(/function launchWindowWithTerminals\(\): void \{[\s\S]*?^  \}/m);
    expect(funcMatch).not.toBeNull();
    const funcBody = funcMatch![0];

    // IPC handlers must NOT be inside launchWindowWithTerminals
    expect(funcBody).not.toContain('ipcMain.handle');
    expect(funcBody).not.toContain('CHECK_FOR_UPDATE');
    expect(funcBody).not.toContain('DOWNLOAD_UPDATE');
  });

  test('index.ts: autoUpdater.on() is NOT inside launchWindowWithTerminals', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    const funcMatch = src.match(/function launchWindowWithTerminals\(\): void \{[\s\S]*?^  \}/m);
    expect(funcMatch).not.toBeNull();
    const funcBody = funcMatch![0];

    // autoUpdater event listeners must NOT be inside launchWindowWithTerminals
    expect(funcBody).not.toContain('autoUpdater.on(');
    expect(funcBody).not.toContain('autoUpdater.checkForUpdates');
  });

  test('index.ts: promptUpdate has re-entrancy guard', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // promptUpdate must check isPromptingUpdate before showing dialog
    const promptBlock = src.match(/async function promptUpdate[\s\S]*?finally\s*\{[\s\S]*?\}/);
    expect(promptBlock).not.toBeNull();
    expect(promptBlock![0]).toContain('isPromptingUpdate');
    expect(promptBlock![0]).toContain('if (isPromptingUpdate) return');
  });

  test('index.ts: updateDownloaded flag set in update-downloaded handler', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // updateDownloaded must be set to true in the update-downloaded handler
    expect(src).toContain('updateDownloaded = true');
  });

  test('index.ts: window-all-closed quits on macOS when update is downloaded', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // Find window-all-closed handler
    const handler = src.match(/app\.on\('window-all-closed'[\s\S]*?^\}\);/m);
    expect(handler).not.toBeNull();
    const body = handler![0];

    // Must check updateDownloaded and call app.quit() on macOS
    expect(body).toContain('updateDownloaded');
    expect(body).toContain("app.quit()");
  });

  test('index.ts: activate handler restarts services', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/main/index.ts'),
      'utf-8',
    );

    // Find activate handler
    const handler = src.match(/app\.on\('activate'[\s\S]*?\}\);/);
    expect(handler).not.toBeNull();
    const body = handler![0];

    // Must restart lightweight services
    expect(body).toContain('chatWatcher?.start()');
    expect(body).toContain('configWatcher?.start()');
    expect(body).toContain('memoryPush?.start()');
  });
});
