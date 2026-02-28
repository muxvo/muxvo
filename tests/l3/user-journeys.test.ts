/**
 * L3 用户旅程测试 -- 完整用户旅程 + 模块完整流程 + 跨模块联动 + 数据一致性 + 边界时间 + 异常恢复
 *
 * 基于文档: docs/Muxvo_测试_v2/02_integration/user_journeys.md
 * 测试层级: L3（场景层 -- E2E / Playwright 模式）
 * 用例总数: 37
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, onIpcPush, emitIpcPush, resetIpcMocks } from '../helpers/mock-ipc';
import { MockApp, MockBrowserWindow } from '../helpers/mock-electron';
import {
  terminalFixtures,
  gridFixtures,
  asbSignals,
  textForwardFixtures,
  searchFixtures,
  chatLayoutFixtures,
  timeConstants,
  defaultConfig,
  imageFixtures,
} from '../helpers/test-fixtures';

// ============================================================
// 一、完整用户旅程（5 cases）
// ============================================================
describe('L3 -- 完整用户旅程', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // JOURNEY_L3_01: 新用户首次使用完整旅程
  test('JOURNEY_L3_01: 新用户首次使用完整旅程', async () => {
    // Step 1: Launch Muxvo (first time)
    const app = new MockApp();
    await app.launch();
    expect(app.state).toBe('running');

    // Step 1-2: Verify settings configuration is available
    const { createConfigManager } = await import('@/main/services/app/config');
    const configMgr = createConfigManager({ configDir: '/tmp/test-nonexistent' });
    const appConfig = configMgr.loadConfig();
    expect(appConfig.startupTerminalCount).toBe(1);
    expect(appConfig.theme).toBeDefined();

    // Step 4-5: Create terminal
    const createResult = await invokeIpc('terminal:create', {
      cwd: terminalFixtures.validCwd,
    });
    expect(createResult).toBeDefined();

    // Step 6-7: Grid should be 1x1
    const grid1 = gridFixtures.find((g) => g.count === 1)!;
    expect(grid1.expectedCols).toBe(1);
    expect(grid1.expectedRows).toBe(1);

    // Step 8: Close app -> save layout
    await app.quit();
    expect(app.state).toBe('closing');
  });

  // JOURNEY_L3_02: 日常工作流旅程
  test('JOURNEY_L3_02: 日常工作流旅程', async () => {
    const app = new MockApp();
    await app.launch();

    // Step 1: Restore 3 terminals, Grid=3x1
    const { restoreSession } = await import('@/modules/app/session-restore');
    const session = await restoreSession();
    expect(session.terminals).toHaveLength(3);

    const grid3 = gridFixtures.find((g) => g.count === 3)!;
    expect(grid3.expectedCols).toBe(3);
    expect(grid3.expectedRows).toBe(1);

    // Step 2: Create 4th terminal -> Grid=2x2
    await invokeIpc('terminal:create', { cwd: terminalFixtures.validCwd });
    const grid4 = gridFixtures.find((g) => g.count === 4)!;
    expect(grid4.expectedCols).toBe(2);
    expect(grid4.expectedRows).toBe(2);

    // Step 3: Double-click first terminal -> focus mode
    const { createViewModeManager } = await import(
      '@/modules/terminal/view-mode'
    );
    const viewMode = createViewModeManager();
    viewMode.focusTerminal(0);
    expect(viewMode.mode).toBe('focused');

    // Step 4: Open file panel -> right side 320px, 300ms transition
    const { openFilePanel } = await import('@/modules/file/panel');
    const panel = openFilePanel();
    expect(panel.width).toBeGreaterThanOrEqual(chatLayoutFixtures.rightMin);
    expect(panel.transitionMs).toBe(300);

    // Step 5-6: Preview .md -> three-column temp view, Esc closes it
    const { openPreview } = await import('@/modules/file/preview');
    const preview = openPreview('test.md');
    expect(preview.layout).toBe('three-column');

    // Step 7: Esc exits focus mode -> back to 2x2
    viewMode.handleEsc();
    // After exiting focused mode with file panel possibly closed

    // Step 8-9: Open chat history, search with 300ms debounce
    const { openChatHistory } = await import('@/modules/chat/history');
    const chat = await openChatHistory();
    expect(chat.sessions).toBeDefined();

    expect(searchFixtures.debounceMs).toBe(300);

    // Step 10: View session detail -> dual-source read
    const { readSession } = await import('@/modules/chat/reader');
    const detail = await readSession('session-1');
    expect(detail).toHaveProperty('messages');
    expect(detail.source).toMatch(/cc|mirror/);
  });

  // JOURNEY_L3_03: removed -- marketplace/showcase modules deleted

  // JOURNEY_L3_04: 配置管理完整旅程
  test('JOURNEY_L3_04: 配置管理完整旅程', async () => {
    // Step 1: Open ~/.claude/ visual browser -> 8 resource types
    const { openConfigBrowser } = await import('@/modules/config/browser');
    const configBrowser = await openConfigBrowser();
    expect(configBrowser.resourceTypes).toHaveLength(8);

    // Step 2: Browse Skills category
    const skills = configBrowser.browse('skills');
    expect(skills).toBeDefined();

    // Step 3: Preview a Skill -> Markdown render
    const { previewFile } = await import('@/modules/config/preview');
    const preview = await previewFile('~/.claude/skills/test/SKILL.md');
    expect(preview.rendered).toBe(true);
    expect(preview.format).toBe('markdown');

    // Step 4-5: Modify fontSize -> terminal font updates
    const { updatePreference } = await import('@/modules/app/preferences');
    await updatePreference('fontSize', 16);

    // Verify default was 14
    expect(defaultConfig.font.size).toBe(14);

    // Step 6: Edit CLAUDE.md
    const { editFile } = await import('@/modules/config/editor');
    const editResult = await editFile('~/.claude/CLAUDE.md', 'new content');
    expect(editResult.saved).toBe(true);

    // Step 7-8: External modification -> chokidar detects -> auto refresh
    const { createFileWatcher } = await import('@/modules/data/file-watcher');
    const watcher = createFileWatcher('~/.claude/CLAUDE.md');
    const changes: string[] = [];
    watcher.on('change', (path: string) => changes.push(path));
    watcher.emit('change', '~/.claude/CLAUDE.md');
    expect(changes).toHaveLength(1);
  });

  // JOURNEY_L3_05: 富编辑器模式切换旅程
  test('JOURNEY_L3_05: 富编辑器模式切换旅程', async () => {
    // Verify ASB signals from fixtures
    expect(asbSignals.enterRaw).toBe('\x1b[?1049h');
    expect(asbSignals.exitRaw).toBe('\x1b[?1049l');

    // Step 1: Create terminal -> default RichEditor mode
    const { createEditorMachine } = await import('@/modules/editor/editor-machine');
    const editor = createEditorMachine();
    expect(editor.state).toBe('RichEditor');

    // Step 2: Multi-line input
    expect(textForwardFixtures.claudeCode.separator).toBe('\x1b\r');

    // Step 3: Paste image -> thumbnail display
    const { handleImagePaste } = await import('@/modules/editor/image-handler');
    const pasteResult = await handleImagePaste({
      format: imageFixtures.validPng.format,
      size: imageFixtures.validPng.size,
    });
    expect(pasteResult.thumbnail).toBeDefined();

    // Step 4: CC enters vim (ASB enter raw) -> switch to RawTerminal
    editor.send('ASB_SIGNAL', { signal: asbSignals.enterRaw });
    expect(editor.state).toBe('RawTerminal');

    // Step 5: Edit in vim -> keyboard passthrough
    expect(editor.context.keyboardPassthrough).toBe(true);

    // Step 6: Exit vim (ASB exit raw) -> restore RichEditor
    editor.send('ASB_SIGNAL', { signal: asbSignals.exitRaw });
    expect(editor.state).toBe('RichEditor');

    // Step 7: Ctrl+C -> passthrough to terminal
    editor.send('CTRL_C');
    expect(editor.context.lastPassthrough).toBe('SIGINT');
    expect(editor.context.editorContentPreserved).toBe(true);

    // Step 8-9: Manual toggle
    editor.send('MANUAL_SWITCH', { target: 'RawTerminal' });
    expect(editor.state).toBe('RawTerminal');

    editor.send('MANUAL_SWITCH', { target: 'RichEditor' });
    expect(editor.state).toBe('RichEditor');

    // Step 10: Close terminal -> temp files cleanup
    const { cleanupTempFiles } = await import('@/modules/editor/temp-cleanup');
    const cleanup = await cleanupTempFiles('terminal-1');
    expect(cleanup.filesRemoved).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// 二、模块完整流程（8 cases）
// ============================================================
describe('L3 -- 模块完整流程', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // MODULE_L3_01: 终端完整生命周期
  test('MODULE_L3_01: 终端完整生命周期', async () => {
    const { createTerminalMachine } = await import(
      '@/modules/terminal/terminal-machine'
    );
    const machine = createTerminalMachine();

    // Created -> Starting -> Running
    expect(machine.state).toBe('Created');
    machine.send('START');
    expect(machine.state).toBe('Starting');
    machine.send('PROCESS_READY');
    expect(machine.state).toBe('Running');

    // Running -> Busy -> WaitingInput
    machine.send('CC_PROCESSING');
    expect(machine.state).toBe('Busy');
    machine.send('CC_WAITING');
    expect(machine.state).toBe('WaitingInput');

    // -> Stopping -> Stopped -> Removed
    machine.send('STOP');
    expect(machine.state).toBe('Stopping');
    machine.send('PROCESS_EXIT');
    expect(machine.state).toBe('Stopped');
    machine.send('REMOVE');
    expect(machine.state).toBe('Removed');
  });

  // MODULE_L3_02: 聊天历史完整流程
  test('MODULE_L3_02: 聊天历史完整流程', async () => {
    const { createChatMachine } = await import('@/modules/chat/chat-machine');
    const machine = createChatMachine();

    // Closed -> Loading -> Ready
    expect(machine.state).toBe('Closed');
    machine.send('OPEN');
    expect(machine.state).toBe('Loading');
    machine.send('LOADED');
    expect(machine.state).toBe('Ready');

    // Search -> empty search -> results
    machine.send('SEARCH', { query: '' });
    expect(machine.context.view).toBe('EmptySearch');

    machine.send('SEARCH', { query: 'hello' });
    expect(machine.context.view).toBe('Searching');
    machine.send('SEARCH_COMPLETE', { results: [] });
    expect(machine.context.view).toBe('Results');

    // SessionDetail with dual-source read
    machine.send('VIEW_SESSION', { sessionId: 'session-1' });
    expect(machine.context.view).toBe('SessionDetail');
    expect(machine.context.readStrategy).toMatch(/cc|mirror/);
  });

  // MODULE_L3_03: 文件浏览编辑完整流程
  test('MODULE_L3_03: 文件浏览编辑完整流程', async () => {
    const { createFileMachine } = await import('@/modules/file/file-machine');
    const machine = createFileMachine();

    // File panel slide out (300ms)
    machine.send('OPEN_PANEL');
    expect(machine.context.panelVisible).toBe(true);
    expect(machine.context.transitionMs).toBe(300);

    // Click .md file -> three-column view
    machine.send('OPEN_FILE', { path: 'test.md' });
    expect(machine.context.view).toBe('ThreeColumn');

    // Edit mode
    machine.send('EDIT');
    expect(machine.context.editing).toBe(true);

    // Save
    machine.send('SAVE');
    expect(machine.context.editing).toBe(false);
    expect(machine.context.saved).toBe(true);

    // Esc exits three-column
    machine.send('ESC');
    expect(machine.context.view).toBe('Default');
  });

  // MODULE_L3_04: removed -- marketplace/install-machine module deleted

  // MODULE_L3_05: removed -- marketplace/install-machine module deleted

  // MODULE_L3_06: removed -- score module deleted

  // MODULE_L3_07: removed -- showcase/showcase-machine module deleted

  // MODULE_L3_08: GitHub OAuth 登录完整流程
  test('MODULE_L3_08: GitHub OAuth 登录完整流程', async () => {
    const { createAuthMachine } = await import('@/modules/auth/auth-machine');
    const machine = createAuthMachine();

    // LoggedOut -> Authorizing
    expect(machine.state).toBe('LoggedOut');
    machine.send('LOGIN');
    expect(machine.state).toBe('Authorizing');

    // PKCE flow
    expect(machine.context.codeVerifier).toBeDefined();
    expect(machine.context.codeChallenge).toBeDefined();

    // Callback -> token
    machine.send('AUTH_CALLBACK', { authCode: 'mock-code' });
    machine.send('TOKEN_RECEIVED', {
      accessToken: 'ghp_test',
      username: 'testuser',
    });
    expect(machine.state).toBe('LoggedIn');
    expect(machine.context.tokenStorage).toBe('plaintext');
    expect(machine.context.username).toBe('testuser');
  });

  // MODULE_L3_09: Backend OAuth 完整流程（Authorizing -> TOKEN_RECEIVED -> LoggedIn）
  test('MODULE_L3_09: Backend OAuth 完整流程（Authorizing -> TOKEN_RECEIVED -> LoggedIn）', async () => {
    const { createAuthMachine } = await import('@/modules/auth/auth-machine');
    const machine = createAuthMachine();

    // LoggedOut -> Authorizing (with authMethod)
    expect(machine.state).toBe('LoggedOut');
    machine.send('LOGIN', { authMethod: 'github' });
    expect(machine.state).toBe('Authorizing');
    expect(machine.context.authMethod).toBe('github');

    // Authorizing: AUTH_CALLBACK stores authCode
    machine.send('AUTH_CALLBACK', { authCode: 'oauth-code' });

    // Authorizing -> LoggedIn via TOKEN_RECEIVED
    machine.send('TOKEN_RECEIVED', {
      accessToken: 'jwt_access_token',
      refreshToken: 'jwt_refresh_token',
      username: 'backenduser',
      userId: 'usr_456',
      email: 'user@example.com',
    });
    expect(machine.state).toBe('LoggedIn');
    expect(machine.context.accessToken).toBe('jwt_access_token');
    expect(machine.context.refreshToken).toBe('jwt_refresh_token');
    expect(machine.context.userId).toBe('usr_456');
    expect(machine.context.email).toBe('user@example.com');
    expect(machine.context.tokenStorage).toBe('plaintext');
  });

  // MODULE_L3_10: 启动时自动恢复登录态
  test('MODULE_L3_10: 启动时自动恢复登录态（stored token → validate → LoggedIn）', async () => {
    const { storeTokenPair, getTokenPair, clearToken } = await import(
      '@/modules/auth/token-storage'
    );

    // Simulate stored tokens from previous session
    await storeTokenPair('stored_access', 'stored_refresh');
    const pair = await getTokenPair();
    expect(pair.accessToken).toBe('stored_access');
    expect(pair.refreshToken).toBe('stored_refresh');

    // Machine can fast-track to LoggedIn using stored tokens
    const { createAuthMachine } = await import('@/modules/auth/auth-machine');
    const machine = createAuthMachine();
    machine.send('LOGIN');
    machine.send('TOKEN_RECEIVED', {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      username: 'restored_user',
      userId: 'usr_789',
    });
    expect(machine.state).toBe('LoggedIn');
    expect(machine.context.username).toBe('restored_user');

    // Cleanup
    await clearToken();
  });

  // MODULE_L3_11: Token 过期 → 自动刷新
  test('MODULE_L3_11: Token 过期自动刷新（TOKEN_REFRESH 保持 LoggedIn）', async () => {
    const { createAuthMachine } = await import('@/modules/auth/auth-machine');
    const machine = createAuthMachine();

    // Bring to LoggedIn
    machine.send('LOGIN');
    machine.send('TOKEN_RECEIVED', {
      accessToken: 'old_access',
      refreshToken: 'old_refresh',
      username: 'user',
      userId: 'usr_1',
    });
    expect(machine.state).toBe('LoggedIn');

    // Simulate token refresh (access token expires, auto-refresh kicks in)
    machine.send('TOKEN_REFRESH', {
      accessToken: 'new_access',
      refreshToken: 'new_refresh',
    });
    expect(machine.state).toBe('LoggedIn');
    expect(machine.context.accessToken).toBe('new_access');
    expect(machine.context.refreshToken).toBe('new_refresh');
  });

  // MODULE_L3_12: Auth 失败恢复（刷新失败 → LoggedOut）
  test('MODULE_L3_12: Auth 失败恢复（REFRESH_FAILED → LoggedOut → 重新登录）', async () => {
    const { createAuthMachine } = await import('@/modules/auth/auth-machine');
    const machine = createAuthMachine();

    // Bring to LoggedIn
    machine.send('LOGIN');
    machine.send('TOKEN_RECEIVED', {
      accessToken: 'access',
      refreshToken: 'refresh',
      username: 'user',
      userId: 'usr_1',
    });
    expect(machine.state).toBe('LoggedIn');

    // Refresh fails (e.g., network error, token revoked)
    machine.send('REFRESH_FAILED', { error: '网络错误' });
    expect(machine.state).toBe('LoggedOut');
    expect(machine.context.error).toContain('网络错误');
    expect(machine.context.accessToken).toBeUndefined();
    expect(machine.context.refreshToken).toBeUndefined();

    // User can re-login from LoggedOut
    machine.send('LOGIN', { authMethod: 'email' });
    expect(machine.state).toBe('Authorizing');
    expect(machine.context.authMethod).toBe('email');
  });
});

// ============================================================
// 三、跨模块联动（6 cases）
// ============================================================
describe('L3 -- 跨模块联动', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // CROSS_L3_01: 新建终端触发多模块更新
  test('CROSS_L3_01: 新建终端触发多模块更新', async () => {
    // Create 5th terminal -> grid recalculates to 上3下2 (span居中: 6列2行)
    const grid5 = gridFixtures.find((g) => g.count === 5)!;
    expect(grid5.expectedCols).toBe(6);
    expect(grid5.expectedRows).toBe(2);

    // RED: import orchestrator (will fail -- not implemented)
    const { createTerminalOrchestrator } = await import(
      '@/modules/terminal/orchestrator'
    );
    const orchestrator = createTerminalOrchestrator({ currentCount: 4 });
    const result = await orchestrator.createTerminal({ cwd: terminalFixtures.validCwd });

    expect(result.terminalState).toBe('Created');
    expect(result.gridUpdate.cols).toBe(6);
    expect(result.gridUpdate.rows).toBe(2);
    expect(result.editorMode).toBe('RichEditor');
    expect(result.watcherAdded).toBe(true);
  });

  // CROSS_L3_02: 关闭终端触发多模块更新
  test('CROSS_L3_02: 关闭终端触发多模块更新', async () => {
    // Close 3rd terminal (4->3) -> Grid 2x2 -> 3x1
    const grid3 = gridFixtures.find((g) => g.count === 3)!;
    expect(grid3.expectedCols).toBe(3);
    expect(grid3.expectedRows).toBe(1);

    const { createTerminalOrchestrator } = await import(
      '@/modules/terminal/orchestrator'
    );
    const orchestrator = createTerminalOrchestrator({ currentCount: 4 });
    const result = await orchestrator.closeTerminal('terminal-3');

    expect(result.gridUpdate.cols).toBe(3);
    expect(result.gridUpdate.rows).toBe(1);
    expect(result.tempFilesCleaned).toBe(true);
    expect(result.watcherRemoved).toBe(true);
    expect(result.bufferReleased).toBe(true);
  });

  // CROSS_L3_03: 文件变化触发多模块联动
  test('CROSS_L3_03: 文件变化触发多模块联动', async () => {
    // CC writes new chat record to JSONL
    const { createFileChangeOrchestrator } = await import(
      '@/modules/data/change-orchestrator'
    );
    const orchestrator = createFileChangeOrchestrator();

    const result = await orchestrator.handleFileChange({
      path: '~/.claude/projects/test/chat.jsonl',
      event: 'change',
    });

    // Should delay 200ms before reading
    expect(result.readDelayMs).toBe(timeConstants.jsonlReadDelay);
    expect(result.mirrorSynced).toBe(true);
    expect(result.searchIndexUpdated).toBe(true);
    expect(result.pushSent).toBe(true);
  });

  // CROSS_L3_04: removed -- marketplace/install-orchestrator module deleted

  // CROSS_L3_05: removed -- showcase/score-showcase-bridge module deleted

  // CROSS_L3_06: Esc 键优先级链完整验证
  test('CROSS_L3_06: Esc 键优先级链完整验证', async () => {
    const { createEscPriorityChain } = await import(
      '@/modules/app/esc-priority'
    );
    const chain = createEscPriorityChain();

    // Register all layers
    chain.register(1, 'security-dialog');
    chain.register(2, 'folder-picker');
    chain.register(3, 'skill-browser');
    chain.register(4, 'three-column-view');
    chain.register(5, 'file-panel');
    chain.register(6, 'focus-mode');
    chain.register(7, 'tiling-noop');

    // Esc 1: close security dialog (priority 1)
    let closed = chain.handleEsc();
    expect(closed).toBe('security-dialog');

    // Esc 2: close folder picker (priority 2)
    closed = chain.handleEsc();
    expect(closed).toBe('folder-picker');

    // Esc 3: close skill browser (priority 3)
    closed = chain.handleEsc();
    expect(closed).toBe('skill-browser');

    // Esc 4: close three-column view (priority 4)
    closed = chain.handleEsc();
    expect(closed).toBe('three-column-view');

    // Esc 5: close file panel (priority 5)
    closed = chain.handleEsc();
    expect(closed).toBe('file-panel');

    // Esc 6: exit focus mode (priority 6)
    closed = chain.handleEsc();
    expect(closed).toBe('focus-mode');

    // Esc 7: tiling noop (priority 7)
    closed = chain.handleEsc();
    expect(closed).toBe('tiling-noop');
  });

  // CROSS_L3_07: 拖拽排序+Grid 重排联动
  test('CROSS_L3_07: 拖拽排序+Grid 重排联动', async () => {
    // 5 terminals -> grid 6 cols, 2 rows (span centering)
    const { calculateGridLayout } = await import('@/shared/utils/grid-layout');
    const layout5 = calculateGridLayout(5);
    expect(layout5.cols).toBe(6);
    expect(layout5.rows).toBe(2);

    // Drag reorder: move C before A
    const { createDragManager } = await import('@/renderer/stores/drag-manager');
    const dm = createDragManager({ order: ['A', 'B', 'C', 'D', 'E'] });
    dm.startDrag('C');
    dm.dropBefore('A');
    expect(dm.order).toEqual(['C', 'A', 'B', 'D', 'E']);

    // Close terminal E -> 4 terminals, grid recalculates
    const layout4 = calculateGridLayout(4);
    expect(layout4.cols).toBe(2);
    expect(layout4.rows).toBe(2);
  });

  // CROSS_L3_08: Resize+布局重算联动
  test('CROSS_L3_08: Resize+布局重算联动', async () => {
    const { createGridResizeManager } = await import('@/renderer/stores/grid-resize');
    const { calculateGridLayout } = await import('@/shared/utils/grid-layout');

    // 4 terminals -> 2x2 grid
    const layout4 = calculateGridLayout(4);
    expect(layout4.cols).toBe(2);
    expect(layout4.rows).toBe(2);

    // Resize columns with precise container size
    const rm = createGridResizeManager({ cols: 2, rows: 2 });
    rm.startColResize(0, { clientX: 500 }, 1000);
    rm.moveResize({ clientX: 600 });
    rm.endResize();
    expect(rm.columnRatios[0]).not.toBe(1);
    expect(rm.columnRatios[1]).not.toBe(1);

    // Add 5th terminal -> grid recalculates to 6x2
    const layout5 = calculateGridLayout(5);
    expect(layout5.cols).toBe(6);
    expect(layout5.rows).toBe(2);

    // New resize manager for new shape has fresh equal ratios
    const rm2 = createGridResizeManager({ cols: 6, rows: 2 });
    expect(rm2.columnRatios).toEqual([1, 1, 1, 1, 1, 1]);
    expect(rm2.rowRatios).toEqual([1, 1]);
  });
});

// ============================================================
// 四、数据一致性（4 cases）
// ============================================================
describe('L3 -- 数据一致性', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // CONSIST_L3_01: 聊天历史同步一致性
  test('CONSIST_L3_01: 聊天历史同步一致性', async () => {
    const { createSyncEngine } = await import('@/modules/data/sync-engine');
    const engine = createSyncEngine();

    // CC writes new session -> mirror should match
    const syncResult = await engine.sync({ sourcePath: '~/.claude/projects/test/chat.jsonl' });
    expect(syncResult.mirrorContent).toBe(syncResult.sourceContent);

    // CC deletes session file -> mirror preserved
    const deleteResult = await engine.handleSourceDelete({
      sourcePath: '~/.claude/projects/test/deleted.jsonl',
    });
    expect(deleteResult.mirrorPreserved).toBe(true);

    // Duplicate sessionId -> deduplicated
    const dedup = await engine.deduplicate(['session-1', 'session-1', 'session-2']);
    expect(dedup.uniqueSessions).toHaveLength(2);

    // Same-second modification -> treated as unchanged
    const sameSecond = engine.isModified({
      oldMtimeMs: 1000500,
      newMtimeMs: 1000800,
    });
    expect(sameSecond).toBe(false);
  });

  // CONSIST_L3_02: 配置持久化一致性
  test('CONSIST_L3_02: 配置持久化一致性', async () => {
    const { createConfigPersistence } = await import(
      '@/modules/app/config-persistence'
    );
    const persistence = createConfigPersistence();

    // Save 3 terminals, 2x2 layout
    await persistence.save({
      openTerminals: ['t1', 't2', 't3'],
      gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
    });

    // Restore and verify
    const restored = await persistence.load();
    expect(restored.openTerminals).toHaveLength(3);
    expect(restored.gridLayout.columnRatios).toEqual([1, 1]);
    expect(restored.gridLayout.rowRatios).toEqual([1, 1]);

    // Custom column ratios persist
    await persistence.save({
      openTerminals: ['t1', 't2'],
      gridLayout: { columnRatios: [0.6, 0.4], rowRatios: [1] },
    });
    const restored2 = await persistence.load();
    expect(restored2.gridLayout.columnRatios).toEqual([0.6, 0.4]);

    // Font size preference persists
    await persistence.savePreference('fontSize', 16);
    const fontSize = await persistence.loadPreference('fontSize');
    expect(fontSize).toBe(16);
  });

  // CONSIST_L3_03: removed -- marketplace/registry module deleted

  // CONSIST_L3_04: removed -- score module deleted
});

// ============================================================
// 五、边界时间测试（8 cases）
// ============================================================
describe('L3 -- 边界时间测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // TIME_L3_01: JSONL 读取延迟边界 -- 200ms
  test('TIME_L3_01: JSONL 读取延迟边界 -- 200ms', async () => {
    expect(timeConstants.jsonlReadDelay).toBe(200);

    const { createDelayedReader } = await import('@/modules/data/delayed-reader');
    const reader = createDelayedReader(timeConstants.jsonlReadDelay);

    // Read before 200ms -> old/partial content
    const early = await reader.readAt(100);
    expect(early.complete).toBe(false);

    // Read at/after 200ms -> complete new content
    const onTime = await reader.readAt(200);
    expect(onTime.complete).toBe(true);

    // Multiple changes within 200ms -> only last triggers read
    const result = await reader.handleRapidChanges([50, 100, 150]);
    expect(result.readTriggered).toBe(1);
  });

  // TIME_L3_02: removed -- marketplace/search-debouncer module deleted

  // TIME_L3_03: 文件面板过渡边界 -- 300ms CSS
  test('TIME_L3_03: 文件面板过渡边界 -- 300ms CSS', async () => {
    expect(timeConstants.filePanelTransition).toBe(300);

    const { createPanelAnimator } = await import('@/modules/file/panel-animator');
    const animator = createPanelAnimator(300);

    // During transition (<300ms) -> clicks queued
    animator.startTransition();
    const clickDuring = animator.handleClick(150);
    expect(clickDuring.queued).toBe(true);

    // After transition (>=300ms) -> normal response
    const clickAfter = animator.handleClick(300);
    expect(clickAfter.queued).toBe(false);
    expect(clickAfter.handled).toBe(true);
  });

  // TIME_L3_04: removed -- marketplace/update-scheduler module deleted

  // TIME_L3_05: 内存检查间隔边界 -- 60s
  test('TIME_L3_05: 内存检查间隔边界 -- 60s', async () => {
    expect(timeConstants.memoryCheckInterval).toBe(60000);

    const { createMemoryMonitor } = await import('@/modules/app/memory-monitor');
    const monitor = createMemoryMonitor();

    // At 60s -> trigger memory check
    monitor.tick(60000);
    expect(monitor.checkCount).toBe(1);

    // Memory > 2GB -> warning
    expect(timeConstants.memoryWarningThreshold).toBe(2 * 1024 * 1024 * 1024);
    monitor.setMemory(2.5 * 1024 * 1024 * 1024);
    expect(monitor.warning).toBe(true);

    // Memory drops < 2GB -> warning gone
    monitor.setMemory(1.5 * 1024 * 1024 * 1024);
    expect(monitor.warning).toBe(false);
  });

  // TIME_L3_06: 进程关闭超时边界 -- 5s
  test('TIME_L3_06: 进程关闭超时边界 -- 5s', async () => {
    expect(timeConstants.processStopTimeout).toBe(5000);

    const { createProcessStopper } = await import(
      '@/modules/terminal/process-stopper'
    );
    const stopper = createProcessStopper(5000);

    // Normal exit < 5s -> Stopping -> Stopped
    const normalResult = stopper.stop({ exitAfterMs: 3000 });
    expect(normalResult.finalState).toBe('Stopped');

    // Timeout >= 5s -> Stopping -> Disconnected
    const timeoutResult = stopper.stop({ exitAfterMs: 6000 });
    expect(timeoutResult.finalState).toBe('Disconnected');

    // Exactly 5s -> Disconnected
    const exactResult = stopper.stop({ exitAfterMs: 5000 });
    expect(exactResult.finalState).toBe('Disconnected');
  });

  // TIME_L3_07: 文件监听重试间隔 -- 3s x 最多 3 次
  test('TIME_L3_07: 文件监听重试间隔 -- 3s x 最多 3 次', async () => {
    expect(timeConstants.watchRetryInterval).toBe(3000);
    expect(timeConstants.watchRetryMax).toBe(3);

    const { createFileWatcherWithRetry } = await import(
      '@/modules/data/file-watcher'
    );
    const watcher = createFileWatcherWithRetry({
      retryIntervalMs: 3000,
      maxRetries: 3,
    });

    // First failure -> retry at 3s
    watcher.simulateFailure();
    expect(watcher.retryCount).toBe(1);
    expect(watcher.state).toBe('Retrying');

    // 3 consecutive failures -> stop retrying
    watcher.simulateFailure();
    watcher.simulateFailure();
    expect(watcher.retryCount).toBe(3);
    expect(watcher.state).toBe('WatchError');

    // 2nd retry succeeds -> resume watching
    const watcher2 = createFileWatcherWithRetry({
      retryIntervalMs: 3000,
      maxRetries: 3,
    });
    watcher2.simulateFailure();
    watcher2.simulateSuccess();
    expect(watcher2.state).toBe('Watching');
  });

  // TIME_L3_08: 临时文件清理时间 -- 终端关闭 / 24h
  test('TIME_L3_08: 临时文件清理时间 -- 终端关闭 / 24h', async () => {
    expect(timeConstants.tempFileCleanup).toBe(24 * 60 * 60 * 1000);

    const { createTempFileCleaner } = await import(
      '@/modules/editor/temp-cleanup'
    );
    const cleaner = createTempFileCleaner();

    // Terminal close -> temp files cleaned
    const closeResult = await cleaner.cleanOnTerminalClose('terminal-1');
    expect(closeResult.cleaned).toBe(true);

    // File > 24h -> auto cleaned
    const oldFile = cleaner.checkAge({
      createdAtMs: Date.now() - 25 * 60 * 60 * 1000,
    });
    expect(oldFile.shouldClean).toBe(true);

    // File < 24h -> preserved
    const newFile = cleaner.checkAge({
      createdAtMs: Date.now() - 12 * 60 * 60 * 1000,
    });
    expect(newFile.shouldClean).toBe(false);
  });
});

// ============================================================
// 六、异常恢复（6 cases）
// ============================================================
describe('L3 -- 异常恢复', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // RECOVER_L3_01: 终端异常断开后重连
  test('RECOVER_L3_01: 终端异常断开后重连', async () => {
    const { createTerminalMachine } = await import(
      '@/modules/terminal/terminal-machine'
    );
    const machine = createTerminalMachine();

    // Running -> abnormal exit -> Disconnected
    machine.send('START');
    machine.send('PROCESS_READY');
    expect(machine.state).toBe('Running');

    machine.send('PROCESS_ABNORMAL_EXIT', { exitCode: 1 });
    expect(machine.state).toBe('Disconnected');
    expect(machine.context.inputDisabled).toBe(true);

    // Reconnect -> new process
    machine.send('RECONNECT');
    expect(machine.state).toBe('Starting');
    machine.send('PROCESS_READY');
    expect(machine.state).toBe('Running');
    expect(machine.context.isNewProcess).toBe(true);
  });

  // RECOVER_L3_02: removed -- marketplace/install-machine module deleted

  // RECOVER_L3_03: 文件监听错误恢复
  test('RECOVER_L3_03: 文件监听错误恢复', async () => {
    const { createFileWatcherWithRetry } = await import(
      '@/modules/data/file-watcher'
    );
    const watcher = createFileWatcherWithRetry({
      retryIntervalMs: timeConstants.watchRetryInterval,
      maxRetries: timeConstants.watchRetryMax,
    });

    // Start watching
    watcher.start();
    expect(watcher.state).toBe('Watching');

    // Directory deleted -> WatchError
    watcher.simulateFailure();
    expect(watcher.state).toBe('Retrying');

    // Directory restored -> back to Watching
    watcher.simulateSuccess();
    expect(watcher.state).toBe('Watching');
  });

  // RECOVER_L3_04: removed -- score module deleted

  // RECOVER_L3_05: 同步中断恢复
  test('RECOVER_L3_05: 同步中断恢复', async () => {
    const { createSyncEngine } = await import('@/modules/data/sync-engine');
    const engine = createSyncEngine();

    // Sync with one file locked
    const result = await engine.syncBatch([
      { path: 'file1.jsonl', locked: false },
      { path: 'file2.jsonl', locked: true },
      { path: 'file3.jsonl', locked: false },
    ]);

    expect(result.synced).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].path).toBe('file2.jsonl');
    expect(result.skipped[0].reason).toContain('locked');

    // Next sync cycle -> locked file now unlocked
    const retryResult = await engine.syncBatch([
      { path: 'file2.jsonl', locked: false },
    ]);
    expect(retryResult.synced).toHaveLength(1);
  });

  // RECOVER_L3_06: removed -- marketplace/browser-machine module deleted
});
