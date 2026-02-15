/**
 * CHAT L2 -- Rule Layer Tests
 *
 * Source: docs/Muxvo_测试_v2/02_modules/test_CHAT.md
 * Covers: Chat panel state machine (L2 paths), dual-source read,
 *         JSONL parsing, search rules, mtime sync, special rules
 *
 * Total cases: 34
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetIpcMocks } from '../helpers/mock-ipc';
import {
  jsonlFixtures,
  searchFixtures,
  chatLayoutFixtures,
  timeConstants,
} from '../helpers/test-fixtures';

describe('CHAT L2 -- 规则层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // ---------------------------------------------------------------------------
  // 3.1 聊天面板状态机 -- L2 规则路径
  // ---------------------------------------------------------------------------
  describe('聊天面板状态机', () => {
    describe('大文件保护与索引超时', () => {
      test('CHAT_L2_02_large_file_protection: 大文件 >100MB 仅索引最近 6 个月', async () => {
        const { createSearchIndexer } = await import(
          '@/main/services/chat-search-indexer'
        );
        const indexer = createSearchIndexer();

        const largeFileSize = searchFixtures.largeFileThreshold + 1; // >100MB
        const result = await indexer.indexFile({
          path: '/mock/session.jsonl',
          size: largeFileSize,
        });

        expect(result.strategy).toBe('recent_only');
        expect(result.timeRangeMonths).toBe(6);
        // Should not index the entire file
        expect(result.fullIndex).toBe(false);
      });

      test('CHAT_L2_04_index_timeout: 索引超时保护', async () => {
        const { createSearchIndexer } = await import(
          '@/main/services/chat-search-indexer'
        );
        const indexer = createSearchIndexer();

        // Verify timeout thresholds match fixtures
        expect(indexer.singleFileTimeoutMs).toBe(searchFixtures.indexTimeoutSingle); // 30000ms
        expect(indexer.totalBuildTimeoutMs).toBe(searchFixtures.indexTimeoutTotal); // 300000ms

        // Simulate single file exceeding timeout
        const result = await indexer.indexFile({
          path: '/mock/huge.jsonl',
          simulateTimeoutMs: 35000, // >30s
        });
        expect(result.skipped).toBe(true);
        expect(result.reason).toContain('timeout');
      });

      test('CHAT_L2_20_index_resume: 索引断点续传', async () => {
        const { createSearchIndexer } = await import(
          '@/main/services/chat-search-indexer'
        );
        const indexer = createSearchIndexer();

        // Simulate previous run paused at file #5 of 10
        indexer.loadCheckpoint({ lastIndexedFile: 4, totalFiles: 10 });
        const result = await indexer.resumeBuild();

        // Should start from file #5, not from the beginning
        expect(result.startedFromFile).toBe(5);
        expect(result.resumedFromCheckpoint).toBe(true);
      });

      test('CHAT_L2_21_index_progress: 索引构建中搜索', async () => {
        const { createSearchIndexer } = await import(
          '@/main/services/chat-search-indexer'
        );
        const indexer = createSearchIndexer();

        // Set indexer to 50% progress
        indexer.setBuildProgress(0.5);

        const searchResult = indexer.search('test query');

        // Already indexed files should be searchable
        expect(searchResult.partialResults).toBe(true);
        expect(searchResult.indexProgress).toBeCloseTo(0.5, 1);
        expect(searchResult.hint).toContain('索引构建中');
      });
    });

    describe('三栏布局约束', () => {
      test('CHAT_L2_03_layout_min_widths: 三栏最小宽度约束', async () => {
        const { createChatLayoutManager } = await import(
          '@/renderer/stores/chat-layout'
        );
        const manager = createChatLayoutManager();

        // Try to resize left panel below minimum
        manager.resizeLeft(100); // below 180px minimum
        expect(manager.leftWidth).toBeGreaterThanOrEqual(chatLayoutFixtures.leftMin);

        // Try to resize center panel below minimum
        manager.resizeCenter(200); // below 280px minimum
        expect(manager.centerWidth).toBeGreaterThanOrEqual(chatLayoutFixtures.centerMin);

        // Right panel should respect minimum too
        expect(manager.rightWidth).toBeGreaterThanOrEqual(chatLayoutFixtures.rightMin);
      });

      test('CHAT_L2_22_layout_collapse: 窗口不足时左栏收起', async () => {
        const { createChatLayoutManager } = await import(
          '@/renderer/stores/chat-layout'
        );
        // Total min: 180+280+400 = 860px
        const manager = createChatLayoutManager({ windowWidth: 800 });

        // Left panel should collapse to icon mode
        expect(manager.leftWidth).toBe(chatLayoutFixtures.leftCollapsed); // 60px
        expect(manager.leftMode).toBe('collapsed');
      });

      test('CHAT_L2_23_layout_restore: 窗口恢复时左栏展开', async () => {
        const { createChatLayoutManager } = await import(
          '@/renderer/stores/chat-layout'
        );
        // Start collapsed
        const manager = createChatLayoutManager({ windowWidth: 800 });
        expect(manager.leftMode).toBe('collapsed');

        // Increase window width
        manager.setWindowWidth(1200);

        expect(manager.leftWidth).toBeGreaterThanOrEqual(chatLayoutFixtures.leftMin);
        expect(manager.leftMode).toBe('expanded');
      });
    });

    describe('快捷键', () => {
      test('CHAT_L2_31_shortcut_open: Cmd+F 打开搜索', async () => {
        const { createChatShortcutHandler } = await import(
          '@/renderer/utils/chat-shortcuts'
        );
        const handler = createChatShortcutHandler({
          panelOpen: false,
        });

        const result = handler.handle({ key: 'f', metaKey: true });

        expect(result.action).toBe('openPanel');
        expect(result.focusTarget).toBe('searchInput');
      });

      test('CHAT_L2_32_shortcut_esc: Esc 关闭面板', async () => {
        const { createChatShortcutHandler } = await import(
          '@/renderer/utils/chat-shortcuts'
        );
        const handler = createChatShortcutHandler({
          panelOpen: true,
        });

        const result = handler.handle({ key: 'Escape' });

        expect(result.action).toBe('closePanel');
      });

      test('CHAT_L2_33_shortcut_arrows: 上下箭头切换搜索结果', async () => {
        const { createChatShortcutHandler } = await import(
          '@/renderer/utils/chat-shortcuts'
        );
        const handler = createChatShortcutHandler({
          panelOpen: true,
          searchResults: ['r1', 'r2', 'r3'],
          selectedIndex: 0,
        });

        // Down arrow
        const downResult = handler.handle({ key: 'ArrowDown' });
        expect(downResult.action).toBe('selectNext');
        expect(downResult.selectedIndex).toBe(1);

        // Up arrow
        const upResult = handler.handle({ key: 'ArrowUp' });
        expect(upResult.action).toBe('selectPrevious');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3.2 双源读取规则 (PRD 8.3.1)
  // ---------------------------------------------------------------------------
  describe('双源读取规则', () => {
    test('CHAT_L2_06_primary_source: 主源（CC 原始文件）读取成功', async () => {
      const { createDualSourceReader } = await import(
        '@/main/services/chat-dual-source'
      );
      const reader = createDualSourceReader({
        ccPath: '~/.claude/history.jsonl',
        mirrorPath: '~/.muxvo/mirror/history.jsonl',
        ccExists: true,
        ccReadable: true,
      });

      const result = await reader.read();

      expect(result.source).toBe('cc');
      expect(result.data).toBeDefined();
      expect(result.fallback).toBe(false);
    });

    test('CHAT_L2_07_fallback_mirror: CC 文件不存在时切换到镜像', async () => {
      const { createDualSourceReader } = await import(
        '@/main/services/chat-dual-source'
      );
      const reader = createDualSourceReader({
        ccPath: '~/.claude/history.jsonl',
        mirrorPath: '~/.muxvo/mirror/history.jsonl',
        ccExists: false,
        mirrorExists: true,
      });

      const result = await reader.read();

      expect(result.source).toBe('mirror');
      expect(result.data).toBeDefined();
      expect(result.fallback).toBe(true);
      // User should not see error
      expect(result.error).toBeUndefined();
    });

    test('CHAT_L2_08_fallback_permission: CC 权限不足时切换到镜像', async () => {
      const { createDualSourceReader } = await import(
        '@/main/services/chat-dual-source'
      );
      const reader = createDualSourceReader({
        ccPath: '~/.claude/history.jsonl',
        mirrorPath: '~/.muxvo/mirror/history.jsonl',
        ccExists: true,
        ccReadable: false, // chmod 000
        mirrorExists: true,
      });

      const result = await reader.read();

      expect(result.source).toBe('mirror');
      expect(result.fallback).toBe(true);
      // Should not display error to user
      expect(result.error).toBeUndefined();
    });

    test('CHAT_L2_09_both_unavailable: 主备源均不可用进入 Error', async () => {
      const { createDualSourceReader } = await import(
        '@/main/services/chat-dual-source'
      );
      const reader = createDualSourceReader({
        ccPath: '~/.claude/history.jsonl',
        mirrorPath: '~/.muxvo/mirror/history.jsonl',
        ccExists: false,
        mirrorExists: false,
      });

      const result = await reader.read();

      expect(result.source).toBeNull();
      expect(result.error).toBeDefined();
      expect(result.state).toBe('Error');
    });

    test('CHAT_L2_10_mirror_hint: 镜像数据来源提示', async () => {
      const { createDualSourceReader } = await import(
        '@/main/services/chat-dual-source'
      );
      const reader = createDualSourceReader({
        ccPath: '~/.claude/history.jsonl',
        mirrorPath: '~/.muxvo/mirror/history.jsonl',
        ccExists: false,
        mirrorExists: true,
      });

      const result = await reader.read();

      expect(result.source).toBe('mirror');
      expect(result.hint).toContain('本地备份');
    });
  });

  // ---------------------------------------------------------------------------
  // 3.3 JSONL 解析规则 (PRD 8.3.1)
  // ---------------------------------------------------------------------------
  describe('JSONL 解析规则', () => {
    test('CHAT_L2_11_skip_bad_line: 格式错误行跳过', async () => {
      const { parseJsonl } = await import('@/main/services/jsonl-parser');

      // Mix valid and invalid lines
      const input =
        jsonlFixtures.validLine +
        jsonlFixtures.invalidLine +
        jsonlFixtures.validLine;

      const result = parseJsonl(input);

      // Should parse 2 valid lines, skip 1 invalid
      expect(result.entries).toHaveLength(2);
      expect(result.skippedLines).toBe(1);
      expect(result.errors).toHaveLength(0); // Silent skip, no user-facing errors
    });

    test('CHAT_L2_12_ignore_incomplete_tail: 忽略不完整末尾行', async () => {
      const { parseJsonl } = await import('@/main/services/jsonl-parser');

      // Valid line followed by incomplete (no trailing \n)
      const input = jsonlFixtures.validLine + jsonlFixtures.incompleteLine;

      const result = parseJsonl(input);

      // Should only parse the first complete line
      expect(result.entries).toHaveLength(1);
      expect(result.incompleteTailIgnored).toBe(true);
    });

    test('CHAT_L2_13_stream_parse: 逐行流式读取大文件', async () => {
      const { createStreamParser } = await import(
        '@/main/services/jsonl-parser'
      );

      const parser = createStreamParser();
      const chunks: unknown[] = [];

      parser.onEntry((entry: unknown) => {
        chunks.push(entry);
      });

      // Simulate streaming multiLine data in two chunks
      const lines = jsonlFixtures.multiLine;
      const midpoint = Math.floor(lines.length / 2);
      parser.feed(lines.slice(0, midpoint));
      parser.feed(lines.slice(midpoint));
      parser.end();

      // Should have parsed 3 entries from multiLine fixture
      expect(chunks).toHaveLength(3);
    });

    test('CHAT_L2_14_unknown_fields: 未知字段兼容', async () => {
      const { parseJsonl } = await import('@/main/services/jsonl-parser');

      // JSON line with known + unknown fields
      const lineWithExtra =
        '{"type":"human","content":"hello","unknownField":"value","futureFeature":123}\n';

      const result = parseJsonl(lineWithExtra);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe('human');
      expect(result.entries[0].content).toBe('hello');
      // Unknown fields are ignored but parsing succeeds
      expect(result.errors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3.4 搜索规则 (PRD 8.3.4)
  // ---------------------------------------------------------------------------
  describe('搜索规则', () => {
    test('CHAT_L2_01_search_debounce_300ms: 搜索 300ms 去抖', async () => {
      const { createSearchDebouncer } = await import(
        '@/renderer/utils/search-debounce'
      );

      const calls: string[] = [];
      const debouncer = createSearchDebouncer({
        delayMs: searchFixtures.debounceMs,
        onSearch: (query: string) => calls.push(query),
      });

      // Rapid input under 300ms
      debouncer.input('t');
      debouncer.input('te');
      debouncer.input('tes');
      debouncer.input('test');

      // Before debounce completes, no search triggered
      expect(calls).toHaveLength(0);

      // Wait for debounce
      await debouncer.flush();

      // Only the last input should trigger
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe('test');
    });

    test('CHAT_L2_15_search_index_build: 倒排索引构建', async () => {
      const { createSearchIndexer } = await import(
        '@/main/services/chat-search-indexer'
      );
      const indexer = createSearchIndexer();

      const buildResult = await indexer.build({
        files: ['/mock/a.jsonl', '/mock/b.jsonl'],
      });

      expect(buildResult.indexType).toBe('inverted');
      expect(buildResult.fileCount).toBe(2);
      expect(buildResult.progressiveAvailable).toBe(true);
    });

    test('CHAT_L2_16_search_index_persist: 索引持久化', async () => {
      const { createSearchIndexer } = await import(
        '@/main/services/chat-search-indexer'
      );
      const indexer = createSearchIndexer();

      // Build index
      await indexer.build({ files: ['/mock/a.jsonl'] });

      // Persist
      const persistResult = await indexer.persist();
      expect(persistResult.saved).toBe(true);
      expect(persistResult.path).toMatch(/search-index\//);

      // Load from persisted
      const loadResult = await indexer.loadPersisted();
      expect(loadResult.loaded).toBe(true);
      expect(loadResult.needsRebuild).toBe(false);
    });

    test('CHAT_L2_17_search_incremental: 增量更新索引', async () => {
      const { createSearchIndexer } = await import(
        '@/main/services/chat-search-indexer'
      );
      const indexer = createSearchIndexer();

      // Build initial index
      await indexer.build({ files: ['/mock/a.jsonl'] });

      // Simulate file change detected by chokidar
      const updateResult = await indexer.incrementalUpdate({
        changedFile: '/mock/a.jsonl',
        changeType: 'append',
      });

      expect(updateResult.incrementalUpdate).toBe(true);
      expect(updateResult.fullRebuild).toBe(false);
    });

    test('CHAT_L2_18_search_highlight: 搜索结果高亮', async () => {
      const { createSearchHighlighter } = await import(
        '@/renderer/utils/search-highlight'
      );
      const highlighter = createSearchHighlighter();

      const result = highlighter.highlight({
        text: 'Found an error in the build process',
        query: 'error',
        contextChars: 50,
      });

      expect(result.highlighted).toContain('<mark>error</mark>');
      expect(result.context.length).toBeLessThanOrEqual(100 + 'error'.length);
    });

    test('CHAT_L2_19_search_empty_no_results: 搜索无结果文案', async () => {
      const { getNoResultsConfig } = await import(
        '@/renderer/components/chat/search-empty-state'
      );
      const config = getNoResultsConfig();

      expect(config.message).toContain('没有找到匹配的记录');
      expect(config.suggestion).toContain('其他关键词');
      expect(config.icon).toBe('search');
      expect(config.action).toBeDefined();
      expect(config.action.text).toContain('清除搜索');
    });
  });

  // ---------------------------------------------------------------------------
  // 3.5 mtime 同步规则 (PRD 8.3.2)
  // ---------------------------------------------------------------------------
  describe('mtime 同步规则', () => {
    test('CHAT_L2_24_mtime_second_precision: mtime 秒级精度比较（相同）', async () => {
      const { compareMtime } = await import('@/main/services/chat-sync');

      // Same second, different milliseconds
      const ccMtime = 1700000000123;
      const mirrorMtime = 1700000000456;

      const result = compareMtime(ccMtime, mirrorMtime);

      // Floor to seconds: both become 1700000000
      expect(result.needsSync).toBe(false);
      expect(Math.floor(ccMtime / 1000)).toBe(Math.floor(mirrorMtime / 1000));
    });

    test('CHAT_L2_25_mtime_different: mtime 不同触发同步', async () => {
      const { compareMtime } = await import('@/main/services/chat-sync');

      const ccMtime = 1700001000000; // 1700001000 seconds
      const mirrorMtime = 1700000000000; // 1700000000 seconds

      const result = compareMtime(ccMtime, mirrorMtime);

      expect(result.needsSync).toBe(true);
      expect(Math.floor(ccMtime / 1000)).not.toBe(Math.floor(mirrorMtime / 1000));
    });

    test('CHAT_L2_26_dedup_session_id: 按 sessionId 去重', async () => {
      const { createSyncManager } = await import(
        '@/main/services/chat-sync'
      );
      const syncManager = createSyncManager();

      // CC has sessions A and B, mirror already has A
      const ccSessions = [
        { sessionId: 'A', mtime: 1700000000000 },
        { sessionId: 'B', mtime: 1700000000000 },
      ];
      const mirrorSessions = [
        { sessionId: 'A', mtime: 1700000000000 },
      ];

      const syncPlan = syncManager.calculateSyncPlan(ccSessions, mirrorSessions);

      // Only B should be synced (A already exists with same mtime)
      expect(syncPlan.toSync).toHaveLength(1);
      expect(syncPlan.toSync[0].sessionId).toBe('B');
      expect(syncPlan.skipped).toHaveLength(1);
      expect(syncPlan.skipped[0].sessionId).toBe('A');
    });
  });

  // ---------------------------------------------------------------------------
  // 3.6 特殊规则 (附录 H)
  // ---------------------------------------------------------------------------
  describe('特殊规则', () => {
    test('CHAT_L2_05_default_all_projects: 默认选中全部项目', async () => {
      const { useChatPanelStore } = await import(
        '@/renderer/stores/chat-panel'
      );
      const store = useChatPanelStore();

      expect(store.selectedProject).toBe('全部项目');
      // Should show total session count
      expect(store.totalSessionCount).toBeGreaterThanOrEqual(0);
    });

    test('CHAT_L2_27_lazy_load: 延迟加载历史数据', async () => {
      const { createChatHistoryLoader } = await import(
        '@/main/services/chat-history-loader'
      );
      const loader = createChatHistoryLoader();

      // Before panel opens, data should NOT be loaded
      expect(loader.isDataLoaded).toBe(false);
      expect(loader.memoryUsage).toBe(0);

      // Open panel triggers load
      await loader.loadOnDemand();
      expect(loader.isDataLoaded).toBe(true);
    });

    test('CHAT_L2_28_virtual_scroll: 虚拟滚动渲染', async () => {
      const { createVirtualScroller } = await import(
        '@/renderer/utils/virtual-scroll'
      );

      const scroller = createVirtualScroller({
        totalItems: 200,
        itemHeight: 60,
        containerHeight: 400,
      });

      // Only visible items should be rendered
      const rendered = scroller.getVisibleItems();
      const maxVisible = Math.ceil(400 / 60) + 2; // +2 for buffer
      expect(rendered.length).toBeLessThanOrEqual(maxVisible);
      expect(rendered.length).toBeLessThan(200);
    });

    test('CHAT_L2_29_paged_detail: 分页加载会话详情', async () => {
      const { createSessionDetailLoader } = await import(
        '@/renderer/stores/session-detail-loader'
      );
      const loader = createSessionDetailLoader({
        totalMessages: 120,
        pageSize: 50,
      });

      // First load: 50 messages
      const firstPage = await loader.loadPage(1);
      expect(firstPage).toHaveLength(50);

      // Scroll to top loads more
      const secondPage = await loader.loadPage(2);
      expect(secondPage).toHaveLength(50);

      // Total loaded so far
      expect(loader.loadedCount).toBe(100);
    });

    test('CHAT_L2_30_sync_throttle: 镜像同步节流', async () => {
      const { createSyncThrottler } = await import(
        '@/main/services/chat-sync'
      );
      const throttler = createSyncThrottler();

      const syncCalls: number[] = [];
      throttler.onSync(() => syncCalls.push(Date.now()));

      // Trigger multiple syncs in rapid succession
      throttler.triggerSync();
      throttler.triggerSync();
      throttler.triggerSync();

      await throttler.flush();

      // Should batch into single sync operation
      expect(syncCalls).toHaveLength(1);
    });

    test('CHAT_L2_34_shortcut_enter: Enter 打开选中会话', async () => {
      const { createChatShortcutHandler } = await import(
        '@/renderer/utils/chat-shortcuts'
      );
      const handler = createChatShortcutHandler({
        panelOpen: true,
        searchResults: ['r1', 'r2', 'r3'],
        selectedIndex: 1,
      });

      const result = handler.handle({ key: 'Enter' });

      expect(result.action).toBe('openSession');
      expect(result.sessionId).toBe('r2');
    });
  });
});
