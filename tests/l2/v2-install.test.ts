/**
 * V2 安装模块组 L2 规则层测试（BROWSER + INSTALL + SECURITY）
 *
 * Source: docs/Muxvo_测试_v2/02_modules/test_V2_INSTALL.md
 * Total: 39 L2 test cases converted
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetIpcMocks } from '../helpers/mock-ipc';
import { searchFixtures, timeConstants, securityPatterns } from '../helpers/test-fixtures';
import securitySpec from '../specs/l2/security-rules.spec.json';

// ============================================================
// BROWSER L2 -- Skill 聚合浏览器（12 cases）
// ============================================================

describe('BROWSER L2 -- 规则层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  describe('状态机: Skill 浏览器 (PRD 6.14)', () => {
    // BROWSER_L2_01: 搜索 300ms 去抖
    test('BROWSER_L2_01: 搜索 300ms 去抖', async () => {
      // Verify debounce constant from fixtures
      expect(searchFixtures.debounceMs).toBe(300);

      // RED: import search debouncer (will fail -- not implemented)
      const { createSearchDebouncer } = await import(
        '@/modules/marketplace/search-debouncer'
      );
      const debouncer = createSearchDebouncer(300);
      const searchCalls: string[] = [];

      debouncer.onSearch((query: string) => {
        searchCalls.push(query);
      });

      // Simulate rapid typing: "c","co","com","comm","commi","commit" (50ms apart)
      const inputs = ['c', 'co', 'com', 'comm', 'commi', 'commit'];
      for (const input of inputs) {
        debouncer.input(input);
        // In real test, wait 50ms between inputs
      }

      // After debounce period, only the last input should trigger search
      await debouncer.flush();
      expect(searchCalls).toHaveLength(1);
      expect(searchCalls[0]).toBe('commit');
    });

    // BROWSER_L2_02: 默认排序规则
    test('BROWSER_L2_02: 默认排序规则', async () => {
      // RED: import sort strategy (will fail -- not implemented)
      const { getDefaultSortOrder } = await import(
        '@/modules/marketplace/sort-strategy'
      );
      const order = getDefaultSortOrder();
      expect(order).toBeDefined();

      // Anthropic official > community > GitHub
      expect(order.indexOf('anthropic')).toBeLessThan(order.indexOf('community'));
      expect(order.indexOf('community')).toBeLessThan(order.indexOf('github'));
    });

    // BROWSER_L2_03: 部分源失败降级 (Loading -> PartialReady)
    test('BROWSER_L2_03: 部分源失败降级 (Loading -> PartialReady)', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      expect(machine.state).toBe('Loading');

      // 4 sources succeed, 2 fail
      machine.send('SOURCE_LOADED', { source: 'anthropic', packages: [] });
      machine.send('SOURCE_LOADED', { source: 'community', packages: [] });
      machine.send('SOURCE_LOADED', { source: 'github', packages: [] });
      machine.send('SOURCE_LOADED', { source: 'npm', packages: [] });
      machine.send('SOURCE_FAILED', { source: 'skillsmp', error: 'timeout' });
      machine.send('SOURCE_FAILED', { source: 'local', error: 'permission' });

      expect(machine.state).toBe('PartialReady');
      expect(machine.context.loadedSources).toHaveLength(4);
      expect(machine.context.failedSources).toHaveLength(2);
    });

    // BROWSER_L2_04: 所有源加载失败 (Loading -> LoadError)
    test('BROWSER_L2_04: 所有源加载失败 (Loading -> LoadError)', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      expect(machine.state).toBe('Loading');

      // All 6 sources fail
      for (let i = 0; i < 6; i++) {
        machine.send('SOURCE_FAILED', { source: `source-${i}`, error: 'network' });
      }

      expect(machine.state).toBe('LoadError');
      expect(machine.context.error).toContain('无法连接聚合源');
      expect(machine.context.showRetryButton).toBe(true);
    });

    // BROWSER_L2_05: 失败源自动重试成功 (PartialReady -> Ready)
    test('BROWSER_L2_05: 失败源自动重试成功 (PartialReady -> Ready)', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      // Bring to PartialReady
      for (let i = 0; i < 4; i++) {
        machine.send('SOURCE_LOADED', { source: `s${i}`, packages: [] });
      }
      machine.send('SOURCE_FAILED', { source: 's4', error: 'timeout' });
      machine.send('SOURCE_FAILED', { source: 's5', error: 'timeout' });
      expect(machine.state).toBe('PartialReady');

      // Failed sources retry successfully
      machine.send('SOURCE_LOADED', { source: 's4', packages: [] });
      machine.send('SOURCE_LOADED', { source: 's5', packages: [] });
      expect(machine.state).toBe('Ready');
    });

    // BROWSER_L2_06: 清空搜索恢复 Discovery (SearchResults -> Discovery)
    test('BROWSER_L2_06: 清空搜索恢复 Discovery (SearchResults -> Discovery)', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      // Bring to Ready/Discovery
      machine.send('OPEN');
      machine.send('ALL_SOURCES_LOADED');
      expect(machine.state).toBe('Ready');
      expect(machine.context.view).toBe('Discovery');

      // Search
      machine.send('SEARCH', { query: 'commit' });
      expect(machine.context.view).toBe('SearchResults');

      // Clear search
      machine.send('CLEAR_SEARCH');
      expect(machine.context.view).toBe('Discovery');
    });

    // BROWSER_L2_07: 搜索结果点击详情 (SearchResults -> PackageDetail)
    test('BROWSER_L2_07: 搜索结果点击详情 (SearchResults -> PackageDetail)', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      machine.send('ALL_SOURCES_LOADED');
      machine.send('SEARCH', { query: 'commit' });
      expect(machine.context.view).toBe('SearchResults');

      machine.send('SELECT_PACKAGE', { packageId: 'commit-helper' });
      expect(machine.context.view).toBe('PackageDetail');
      expect(machine.context.selectedPackageId).toBe('commit-helper');
    });

    // BROWSER_L2_08: 详情页返回 (PackageDetail -> Discovery)
    test('BROWSER_L2_08: 详情页返回 (PackageDetail -> Discovery)', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      machine.send('ALL_SOURCES_LOADED');
      machine.send('SEARCH', { query: 'commit' });
      machine.send('SELECT_PACKAGE', { packageId: 'commit-helper' });
      expect(machine.context.view).toBe('PackageDetail');

      machine.send('BACK');
      // Should go to Discovery, not SearchResults
      expect(machine.context.view).toBe('Discovery');
    });

    // BROWSER_L2_09: Esc 关闭浏览器 (Ready -> Closed)
    test('BROWSER_L2_09: Esc 关闭浏览器 (Ready -> Closed)', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      machine.send('ALL_SOURCES_LOADED');
      expect(machine.state).toBe('Ready');

      machine.send('ESC');
      expect(machine.state).toBe('Closed');
    });

    // BROWSER_L2_10: 加载失败重试 (LoadError -> Loading -> Ready)
    test('BROWSER_L2_10: 加载失败重试 (LoadError -> Loading -> Ready)', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      // All fail
      for (let i = 0; i < 6; i++) {
        machine.send('SOURCE_FAILED', { source: `s${i}`, error: 'network' });
      }
      expect(machine.state).toBe('LoadError');

      // Retry
      machine.send('RETRY');
      expect(machine.state).toBe('Loading');

      machine.send('ALL_SOURCES_LOADED');
      expect(machine.state).toBe('Ready');
    });

    // BROWSER_L2_11: 左侧边栏筛选
    test('BROWSER_L2_11: 左侧边栏筛选', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      machine.send('ALL_SOURCES_LOADED');
      expect(machine.state).toBe('Ready');

      machine.send('FILTER_BY_SOURCE', { source: 'anthropic' });
      expect(machine.context.activeFilter).toBe('anthropic');
      expect(machine.context.filteredPackages).toBeDefined();
    });

    // BROWSER_L2_12: 异步加载并发处理
    test('BROWSER_L2_12: 异步加载并发处理', async () => {
      const { createBrowserMachine } = await import(
        '@/modules/marketplace/browser-machine'
      );
      const machine = createBrowserMachine();

      machine.send('OPEN');
      expect(machine.state).toBe('Loading');

      // Sources return incrementally (progressive display)
      machine.send('SOURCE_LOADED', { source: 'anthropic', packages: [{ id: '1' }] });
      expect(machine.context.displayedPackages.length).toBeGreaterThan(0);

      machine.send('SOURCE_LOADED', { source: 'github', packages: [{ id: '2' }] });
      expect(machine.context.displayedPackages.length).toBeGreaterThan(1);
    });
  });
});

// ============================================================
// INSTALL L2 -- 安装/卸载/更新（19 cases）
// ============================================================

describe('INSTALL L2 -- 规则层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  describe('状态机: 包安装 (PRD 6.15)', () => {
    // INSTALL_L2_01: 更新检测 6h 轮询间隔
    test('INSTALL_L2_01: 更新检测 6h 轮询间隔', async () => {
      // Verify time constant from fixture
      expect(timeConstants.updateCheckInterval).toBe(6 * 60 * 60 * 1000);

      // RED: import update scheduler (will fail -- not implemented)
      const { createUpdateScheduler } = await import(
        '@/modules/marketplace/update-scheduler'
      );
      const scheduler = createUpdateScheduler();
      expect(scheduler.intervalMs).toBe(6 * 60 * 60 * 1000);
      expect(scheduler.checkOnStartup).toBe(true);
    });

    // INSTALL_L2_02: 已安装包本地已修改时版本冲突
    test('INSTALL_L2_02: 已安装包本地已修改时版本冲突', async () => {
      const { detectLocalModification } = await import(
        '@/modules/marketplace/conflict-detector'
      );
      const result = detectLocalModification({
        installedHash: 'abc123',
        currentHash: 'def456',
      });
      expect(result.conflict).toBe(true);
      expect(result.message).toContain('覆盖');
    });

    // INSTALL_L2_03: Hook 类型安装触发安全审查 (Downloading -> SecurityReview)
    test('INSTALL_L2_03: Hook 类型安装触发安全审查 (Downloading -> SecurityReview)', async () => {
      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({ packageType: 'hook' });

      machine.send('START_INSTALL');
      expect(machine.state).toBe('Downloading');

      machine.send('DOWNLOAD_COMPLETE');
      // Hook type goes to SecurityReview, not Installing
      expect(machine.state).toBe('SecurityReview');
    });

    // INSTALL_L2_04: Skill 类型直接安装 (Downloading -> Installing)
    test('INSTALL_L2_04: Skill 类型直接安装 (Downloading -> Installing)', async () => {
      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({ packageType: 'skill' });

      machine.send('START_INSTALL');
      expect(machine.state).toBe('Downloading');

      machine.send('DOWNLOAD_COMPLETE');
      // Skill type goes directly to Installing
      expect(machine.state).toBe('Installing');
    });

    // INSTALL_L2_05: 安全审查取消安装 (SecurityReview -> NotInstalled)
    test('INSTALL_L2_05: 安全审查取消安装 (SecurityReview -> NotInstalled)', async () => {
      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({ packageType: 'hook' });

      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      expect(machine.state).toBe('SecurityReview');

      machine.send('CANCEL');
      expect(machine.state).toBe('NotInstalled');
      expect(machine.context.filesWritten).toBe(false);
      expect(machine.context.registryUpdated).toBe(false);
    });

    // INSTALL_L2_06: 安装失败状态 (Installing -> InstallFailed)
    test('INSTALL_L2_06: 安装失败状态 (Installing -> InstallFailed)', async () => {
      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({ packageType: 'skill' });

      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      expect(machine.state).toBe('Installing');

      machine.send('INSTALL_FAILED', { error: 'Permission denied' });
      expect(machine.state).toBe('InstallFailed');
      expect(machine.context.error).toBeDefined();
    });

    // INSTALL_L2_07: 安装失败后重试 (InstallFailed -> NotInstalled -> Downloading)
    test('INSTALL_L2_07: 安装失败后重试 (InstallFailed -> NotInstalled -> Downloading)', async () => {
      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({ packageType: 'skill' });

      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      machine.send('INSTALL_FAILED', { error: 'Permission denied' });
      expect(machine.state).toBe('InstallFailed');

      machine.send('RETRY');
      expect(machine.state).toBe('Downloading');
    });

    // INSTALL_L2_08: 更新检测与徽章显示 (Installed -> UpdateAvailable)
    test('INSTALL_L2_08: 更新检测与徽章显示 (Installed -> UpdateAvailable)', async () => {
      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({
        packageType: 'skill',
        currentVersion: '1.0.0',
      });

      // Bring to Installed
      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      machine.send('INSTALL_COMPLETE');
      expect(machine.state).toBe('Installed');

      // Update available
      machine.send('UPDATE_AVAILABLE', { latestVersion: '1.2.0' });
      expect(machine.state).toBe('UpdateAvailable');
      expect(machine.context.latestVersion).toBe('1.2.0');
      expect(machine.context.showBadge).toBe(true);
    });

    // INSTALL_L2_09: 单个包更新流程 (UpdateAvailable -> Downloading -> Installed)
    test('INSTALL_L2_09: 单个包更新流程 (UpdateAvailable -> Downloading -> Installed)', async () => {
      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({
        packageType: 'skill',
        currentVersion: '1.0.0',
      });

      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      machine.send('INSTALL_COMPLETE');
      machine.send('UPDATE_AVAILABLE', { latestVersion: '1.2.0' });
      expect(machine.state).toBe('UpdateAvailable');

      machine.send('START_UPDATE');
      expect(machine.state).toBe('Downloading');

      machine.send('DOWNLOAD_COMPLETE');
      machine.send('INSTALL_COMPLETE');
      expect(machine.state).toBe('Installed');
      expect(machine.context.version).toBe('1.2.0');
    });

    // INSTALL_L2_10: 有更新时卸载 (UpdateAvailable -> Uninstalling -> NotInstalled)
    test('INSTALL_L2_10: 有更新时卸载 (UpdateAvailable -> Uninstalling -> NotInstalled)', async () => {
      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({
        packageType: 'skill',
        currentVersion: '1.0.0',
      });

      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      machine.send('INSTALL_COMPLETE');
      machine.send('UPDATE_AVAILABLE', { latestVersion: '1.2.0' });
      expect(machine.state).toBe('UpdateAvailable');

      machine.send('UNINSTALL');
      expect(machine.state).toBe('Uninstalling');

      machine.send('UNINSTALL_COMPLETE');
      expect(machine.state).toBe('NotInstalled');
    });

    // INSTALL_L2_11: 全状态 UI 映射验证
    test('INSTALL_L2_11: 全状态 UI 映射验证', async () => {
      const { getInstallStateUI } = await import(
        '@/modules/marketplace/install-ui-map'
      );

      const states = [
        'NotInstalled', 'Downloading', 'SecurityReview', 'Installing',
        'Installed', 'UpdateAvailable', 'InstallFailed', 'Uninstalling',
      ];

      for (const state of states) {
        const ui = getInstallStateUI(state);
        expect(ui).toBeDefined();
        expect(ui).toHaveProperty('buttonText');
        expect(ui).toHaveProperty('buttonStyle');
      }
    });

    // INSTALL_L2_12: 批量更新
    test('INSTALL_L2_12: 批量更新', async () => {
      const { createBatchUpdater } = await import(
        '@/modules/marketplace/batch-updater'
      );
      const updater = createBatchUpdater([
        { name: 'pkg1', currentVersion: '1.0.0', latestVersion: '1.1.0' },
        { name: 'pkg2', currentVersion: '2.0.0', latestVersion: '2.1.0' },
        { name: 'pkg3', currentVersion: '0.9.0', latestVersion: '1.0.0' },
      ]);

      expect(updater.pendingCount).toBe(3);
      expect(updater.message).toContain('3 个更新可用');

      await updater.updateAll();
      expect(updater.completedCount).toBe(3);
    });

    // INSTALL_L2_13: 安装后注册表写入
    test('INSTALL_L2_13: 安装后注册表写入', async () => {
      const { writeRegistryEntry } = await import(
        '@/modules/marketplace/registry'
      );
      const entry = await writeRegistryEntry({
        name: 'test-skill',
        type: 'skill',
        version: '1.0.0',
        packageId: 'test-skill-123',
        source: 'skillsmp',
        sourceUrl: 'https://skillsmp.com/test-skill',
      });

      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('version');
      expect(entry).toHaveProperty('packageId');
      expect(entry).toHaveProperty('source');
      expect(entry).toHaveProperty('sourceUrl');
      expect(entry).toHaveProperty('installedAt');
    });

    // INSTALL_L2_14: 安装后列表自动刷新
    test('INSTALL_L2_14: 安装后列表自动刷新', async () => {
      const { createDirectoryWatcher } = await import(
        '@/modules/marketplace/directory-watcher'
      );
      const watcher = createDirectoryWatcher('~/.claude/skills/');
      const events: string[] = [];

      watcher.on('change', (event: string) => {
        events.push(event);
      });

      // Simulate file added
      watcher.emit('add', 'new-skill/SKILL.md');
      expect(events.length).toBeGreaterThan(0);
    });

    // INSTALL_L2_15: 下载失败自动重试
    test('INSTALL_L2_15: 下载失败自动重试', async () => {
      const { createDownloader } = await import(
        '@/modules/marketplace/downloader'
      );
      const downloader = createDownloader({ maxRetries: 1 });

      // First attempt fails, auto-retry succeeds
      const result = await downloader.download({
        url: 'https://example.com/test.tar.gz',
        simulateFailures: 1,
      });
      expect(result.attempts).toBe(2);
      expect(result.success).toBe(true);
    });

    // INSTALL_L2_16: 包完整性校验失败
    test('INSTALL_L2_16: 包完整性校验失败', async () => {
      const { verifyPackageIntegrity } = await import(
        '@/modules/marketplace/integrity-checker'
      );
      const result = verifyPackageIntegrity({
        filePath: '/tmp/test.tar.gz',
        expectedHash: 'sha256:abc123',
        actualHash: 'sha256:def456',
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain('校验失败');
    });

    // INSTALL_L2_17: Hook 安装后写入 settings.json
    test('INSTALL_L2_17: Hook 安装后写入 settings.json', async () => {
      const { registerHookInSettings } = await import(
        '@/modules/marketplace/hook-registrar'
      );
      const result = await registerHookInSettings({
        hookName: 'pre-commit-lint',
        triggerEvent: 'PreToolUse',
        command: 'node hooks/lint.js',
        timeout: 30000,
      });

      expect(result.success).toBe(true);
      expect(result.settingsPath).toContain('settings.json');
    });

    // INSTALL_L2_18: 卸载清理完整性
    test('INSTALL_L2_18: 卸载清理完整性', async () => {
      const { uninstallPackage } = await import(
        '@/modules/marketplace/uninstaller'
      );

      // Uninstall a hook -- should also clean settings.json
      const result = await uninstallPackage({
        name: 'pre-commit-lint',
        type: 'hook',
      });

      expect(result.filesDeleted).toBe(true);
      expect(result.registryRemoved).toBe(true);
      expect(result.settingsJsonCleaned).toBe(true);
    });

    // INSTALL_L2_19: 安装后使用引导
    test('INSTALL_L2_19: 安装后使用引导', async () => {
      const { getPostInstallGuide } = await import(
        '@/modules/marketplace/post-install'
      );
      const guide = getPostInstallGuide({
        packageName: 'commit-helper',
        type: 'skill',
      });

      expect(guide.message).toContain('在 CC 中说');
      expect(guide.examplePrompt).toBeDefined();
      expect(guide.examplePrompt.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// SECURITY L2 -- Hook 安全审查（8 cases）
// ============================================================

describe('SECURITY L2 -- 规则层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  describe('安全审查决策树', () => {
    // --- JSON-driven security rules ---
    const securityCases = securitySpec.cases;

    // SECURITY_L2_01: 对话框完整信息展示 (JSON-driven)
    test('SECURITY_L2_01: 对话框完整信息展示 -- 5 项信息', async () => {
      const spec = securityCases.find((c) => c.id === 'SECURITY_L2_01')!;
      expect(spec.expected.dialogFields).toHaveLength(5);
      expect(spec.expected.sourceCodeDefault).toBe('collapsed');

      // RED: import security dialog (will fail -- not implemented)
      const { createSecurityReviewDialog } = await import(
        '@/modules/security/review-dialog'
      );
      const dialog = createSecurityReviewDialog({
        hookPackage: { type: 'hook', downloadComplete: true },
      });

      for (const field of spec.expected.dialogFields!) {
        expect(dialog.fields).toContain(field);
      }
      expect(dialog.sourceCodeState).toBe('collapsed');
    });

    // SECURITY_L2_02: 源码展开/折叠 (JSON-driven)
    test('SECURITY_L2_02: 源码展开/折叠', async () => {
      const spec = securityCases.find((c) => c.id === 'SECURITY_L2_02')!;
      expect(spec.expected.defaultState).toBe('collapsed');
      expect(spec.expected.toggleSequence).toEqual(['collapsed', 'expanded', 'collapsed']);

      const { createSecurityReviewDialog } = await import(
        '@/modules/security/review-dialog'
      );
      const dialog = createSecurityReviewDialog({ dialogOpen: true });

      // Default collapsed
      expect(dialog.sourceCodeState).toBe('collapsed');

      // Toggle sequence
      dialog.toggleSourceCode();
      expect(dialog.sourceCodeState).toBe('expanded');

      dialog.toggleSourceCode();
      expect(dialog.sourceCodeState).toBe('collapsed');
    });

    // SECURITY_L2_03: 风险关键词高亮 (JSON-driven)
    test('SECURITY_L2_03: 风险关键词高亮', async () => {
      const spec = securityCases.find((c) => c.id === 'SECURITY_L2_03')!;
      expect(spec.expected.highlightedKeywords).toEqual(['curl', 'rm -rf']);
      expect(spec.expected.highlightCount).toBe(2);

      // RED: import keyword scanner (will fail -- not implemented)
      const { detectRiskKeywords } = await import(
        '@/modules/security/scanner'
      );
      const result = detectRiskKeywords(
        spec.input.sourceCode!,
        spec.riskKeywords!,
      );
      expect(result.highlightCount).toBe(spec.expected.highlightCount);
      expect(result.highlightedKeywords).toEqual(
        expect.arrayContaining(spec.expected.highlightedKeywords!),
      );
      expect(result.highlightColor).toBe('red');
    });

    // SECURITY_L2_04: 确认安装流程 (JSON-driven)
    test('SECURITY_L2_04: 确认安装流程', async () => {
      const spec = securityCases.find((c) => c.id === 'SECURITY_L2_04')!;
      expect(spec.expected.buttonText).toBe('确认安装，我信任此代码');
      expect(spec.expected.nextState).toBe('Installing');

      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({ packageType: 'hook' });

      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      expect(machine.state).toBe('SecurityReview');

      machine.send('CONFIRM_INSTALL');
      expect(machine.state).toBe('Installing');
      expect(machine.context.settingsJsonUpdated).toBe(true);
    });

    // SECURITY_L2_05: 取消不安装 (JSON-driven)
    test('SECURITY_L2_05: 取消不安装', async () => {
      const spec = securityCases.find((c) => c.id === 'SECURITY_L2_05')!;
      expect(spec.expected.nextState).toBe('NotInstalled');
      expect(spec.expected.filesWritten).toBe(false);

      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({ packageType: 'hook' });

      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      expect(machine.state).toBe('SecurityReview');

      machine.send('CANCEL');
      expect(machine.state).toBe('NotInstalled');
      expect(machine.context.filesWritten).toBe(false);
      expect(machine.context.registryUpdated).toBe(false);
    });

    // SECURITY_L2_06: Esc 关闭安全审查对话框 (JSON-driven)
    test('SECURITY_L2_06: Esc 关闭安全审查对话框（等同取消）', async () => {
      const spec = securityCases.find((c) => c.id === 'SECURITY_L2_06')!;
      expect(spec.expected.equivalentTo).toBe('cancel');
      expect(spec.expected.escPriority).toBe(1);

      const { createInstallMachine } = await import(
        '@/modules/marketplace/install-machine'
      );
      const machine = createInstallMachine({ packageType: 'hook' });

      machine.send('START_INSTALL');
      machine.send('DOWNLOAD_COMPLETE');
      expect(machine.state).toBe('SecurityReview');

      // ESC should behave same as cancel
      machine.send('ESC');
      expect(machine.state).toBe('NotInstalled');
    });

    // SECURITY_L2_07: 源码无风险关键词 (JSON-driven)
    test('SECURITY_L2_07: 源码无风险关键词 -- 无高亮', async () => {
      const spec = securityCases.find((c) => c.id === 'SECURITY_L2_07')!;
      expect(spec.expected.highlightedKeywords).toEqual([]);
      expect(spec.expected.highlightCount).toBe(0);

      const { detectRiskKeywords } = await import(
        '@/modules/security/scanner'
      );
      const result = detectRiskKeywords(
        spec.input.sourceCode!,
        spec.riskKeywords!,
      );
      expect(result.highlightCount).toBe(0);
      expect(result.highlightedKeywords).toEqual([]);
    });

    // SECURITY_L2_08: 源码多个风险关键词 (JSON-driven)
    test('SECURITY_L2_08: 源码多个风险关键词 -- 全部标红', async () => {
      const spec = securityCases.find((c) => c.id === 'SECURITY_L2_08')!;
      expect(spec.expected.highlightedKeywords).toEqual(['curl', 'eval', 'rm -rf']);
      expect(spec.expected.highlightCount).toBe(3);

      const { detectRiskKeywords } = await import(
        '@/modules/security/scanner'
      );
      const result = detectRiskKeywords(
        spec.input.sourceCode!,
        spec.riskKeywords!,
      );
      expect(result.highlightCount).toBe(3);
      expect(result.highlightedKeywords).toEqual(
        expect.arrayContaining(['curl', 'eval', 'rm -rf']),
      );
      expect(result.highlightColor).toBe('red');
    });
  });
});
