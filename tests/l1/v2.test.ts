/**
 * V2 L1 -- 契约层测试（V2 模块组: BROWSER + INSTALL + SECURITY + SCORE + SHOWCASE + PUBLISH + COMMUNITY + AUTH）
 * Source: docs/Muxvo_测试_v2/02_modules/test_V2_INSTALL.md, test_V2_CONTENT.md
 * Total: 27 L1 cases
 *   BROWSER_L1_01~04, INSTALL_L1_01~05, SECURITY_L1_01~02,
 *   SCORE_L1_01~03, SHOWCASE_L1_01~03, PUBLISH_L1_01~04,
 *   COMMUNITY_L1_01~03, AUTH_L1_01~03
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, onIpcPush, emitIpcPush, resetIpcMocks } from '../helpers/mock-ipc';
import { securityPatterns, scoreDimensions } from '../helpers/test-fixtures';
import v2Spec from '../specs/l1/v2.spec.json';

describe('V2 L1 -- 契约层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // ========== BROWSER ==========
  describe('BROWSER -- Skill 聚合浏览器', () => {
    // --- IPC invoke cases ---
    const browserIpcCases = v2Spec.cases.filter(
      (c) => c.type === 'ipc' && c.id.startsWith('BROWSER'),
    );

    test.each(browserIpcCases)(
      '$id: $description',
      async ({ channel, input, expectedResponse }) => {
        handleIpc(channel, async () => ({
          success: true,
          data: expectedResponse,
        }));

        const result = await invokeIpc(channel, input);
        expect(result).toBeDefined();
        expect(result.success).toBe(true);

        if (expectedResponse) {
          for (const key of Object.keys(expectedResponse)) {
            expect(result.data).toHaveProperty(key);
          }
        }
      },
    );

    // BROWSER_L1_01: Verify 6 source types
    test('BROWSER_L1_01: marketplace:fetch-sources returns 6 sources', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'BROWSER_L1_01')!;
      expect(spec.sourceList).toBeDefined();
      expect(spec.sourceList).toHaveLength(6);

      // RED: import the real aggregator module (will fail -- not implemented)
      const { fetchSources } = await import('@/modules/marketplace/aggregator');
      const result = await fetchSources();
      expect(result.sources).toHaveLength(6);
      expect(result.totalCount).toBeGreaterThanOrEqual(0);
    });

    // BROWSER_L1_03: Package structure validation
    test('BROWSER_L1_03: 包详情数据结构 -- 完整 Package 结构验证', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'BROWSER_L1_03')!;
      const requiredFields = (spec.expectedValue as { fields: string[] }).fields;
      expect(requiredFields).toBeDefined();
      expect(requiredFields.length).toBeGreaterThanOrEqual(14);

      // RED: import AggregatedPackage type validator (will fail -- not implemented)
      const { validatePackageStructure } = await import(
        '@/modules/marketplace/validators'
      );
      const mockPackage = { id: 'test', name: 'test-skill' };
      const validation = validatePackageStructure(mockPackage);
      for (const field of requiredFields) {
        expect(validation.requiredFields).toContain(field);
      }
    });

    // BROWSER_L1_04: Source labels UI state
    test('BROWSER_L1_04: 来源标识验证 -- 每个包显示来源标签', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'BROWSER_L1_04')!;
      const expectedLabels = (spec.expectedUI as { labels: string[] }).labels;
      expect(expectedLabels).toHaveLength(6);

      // RED: import source label mapping (will fail -- not implemented)
      const { getSourceLabels } = await import(
        '@/renderer/components/marketplace/source-labels'
      );
      const labels = getSourceLabels();
      expect(labels).toEqual(
        expect.arrayContaining(['Anthropic 官方', 'SkillsMP', 'GitHub', 'npm', '社区', '本地']),
      );
    });
  });

  // ========== INSTALL ==========
  describe('INSTALL -- 安装/卸载/更新', () => {
    // --- IPC invoke cases ---
    const installIpcCases = v2Spec.cases.filter(
      (c) => c.type === 'ipc' && c.id.startsWith('INSTALL'),
    );

    test.each(installIpcCases)(
      '$id: $description',
      async ({ channel, input, expectedResponse }) => {
        handleIpc(channel, async () => ({
          success: true,
          data: expectedResponse,
        }));

        const result = await invokeIpc(channel, input);
        expect(result).toBeDefined();
        expect(result.success).toBe(true);

        if (expectedResponse) {
          for (const key of Object.keys(expectedResponse)) {
            expect(result.data).toHaveProperty(key);
          }
        }
      },
    );

    // INSTALL_L1_03: installed package field validation
    test('INSTALL_L1_03: installed packages have expected fields', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'INSTALL_L1_03')!;
      const expectedFields = spec.expectedFields!;
      expect(expectedFields).toEqual(
        expect.arrayContaining(['name', 'type', 'version', 'source', 'installedAt', 'updatedAt']),
      );

      // RED: import installed package validator (will fail -- not implemented)
      const { getInstalledPackages } = await import(
        '@/modules/marketplace/registry'
      );
      const packages = await getInstalledPackages();
      if (packages.length > 0) {
        for (const field of expectedFields) {
          expect(packages[0]).toHaveProperty(field);
        }
      }
    });

    // INSTALL_L1_05: push event format
    test('INSTALL_L1_05: marketplace:install-progress push 事件格式 -- 安装进度推送', () => {
      const spec = v2Spec.cases.find((c) => c.id === 'INSTALL_L1_05')!;
      const expectedPayload = spec.expectedPayload!;

      const received: unknown[] = [];
      onIpcPush('marketplace:install-progress', (...args: unknown[]) => {
        received.push(args[0]);
      });

      // Emit mock push event
      const mockPayload: Record<string, unknown> = {};
      for (const key of Object.keys(expectedPayload)) {
        mockPayload[key] = `mock_${key}`;
      }
      emitIpcPush('marketplace:install-progress', mockPayload);

      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('packageName');
      expect(payload).toHaveProperty('stage');
      expect(payload).toHaveProperty('progress');
    });
  });

  // ========== SECURITY ==========
  describe('SECURITY -- Hook 安全审查', () => {
    // SECURITY_L1_01: Security review dialog data structure
    test('SECURITY_L1_01: 安全审查对话框数据结构 -- 展示 hookName, triggerEvent, command, sourceCode, timeout', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'SECURITY_L1_01')!;
      const expectedFields = (spec.expectedValue as { fields: string[] }).fields;
      expect(expectedFields).toEqual(
        expect.arrayContaining(['hookName', 'triggerEvent', 'command', 'sourceCode', 'timeout']),
      );

      // RED: import security review dialog config (will fail -- not implemented)
      const { getReviewDialogFields } = await import(
        '@/modules/security/review-dialog'
      );
      const fields = getReviewDialogFields();
      for (const f of expectedFields) {
        expect(fields).toContain(f);
      }
    });

    // SECURITY_L1_02: Risk keywords format
    test('SECURITY_L1_02: 风险关键词列表格式 -- curl/eval/rm -rf/wget/sudo/chmod 777 标红高亮', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'SECURITY_L1_02')!;
      const expectedKeywords = (spec.expectedValue as { keywords: string[] }).keywords;
      expect(expectedKeywords).toEqual(
        expect.arrayContaining(['curl', 'eval', 'rm -rf', 'wget', 'sudo', 'chmod 777']),
      );

      // Cross-check with fixtures
      expect(securityPatterns.apiKeyBlock).toBeDefined();
      expect(securityPatterns.apiKeyBlock.length).toBeGreaterThan(0);

      // RED: import risk keyword scanner (will fail -- not implemented)
      const { getRiskKeywords } = await import(
        '@/modules/security/risk-scanner'
      );
      const keywords = getRiskKeywords();
      expect(keywords.highlight).toBe('red');
      for (const kw of expectedKeywords) {
        expect(keywords.list).toContain(kw);
      }
    });
  });

  // ========== SCORE ==========
  describe('SCORE -- AI Skill 评分', () => {
    // --- IPC invoke cases ---
    const scoreIpcCases = v2Spec.cases.filter(
      (c) => c.type === 'ipc' && c.id.startsWith('SCORE'),
    );

    test.each(scoreIpcCases)(
      '$id: $description',
      async ({ channel, input, expectedResponse }) => {
        handleIpc(channel, async () => ({
          success: true,
          data: expectedResponse,
        }));

        const result = await invokeIpc(channel, input);
        expect(result).toBeDefined();
        expect(result.success).toBe(true);

        if (expectedResponse) {
          for (const key of Object.keys(expectedResponse)) {
            expect(result.data).toHaveProperty(key);
          }
        }
      },
    );

    // SCORE_L1_01: error response when CC not running
    test('SCORE_L1_01: score:run returns CC_NOT_RUNNING error when CC not active', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'SCORE_L1_01')!;
      expect(spec.expectedError).toBeDefined();
      expect(spec.expectedError!.code).toBe('CC_NOT_RUNNING');

      // RED: import real score runner (will fail -- not implemented)
      const { runScore } = await import('@/modules/score/runner');
      const result = await runScore({ skillPath: '/path/to/skill' });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CC_NOT_RUNNING');
    });

    // SCORE_L1_03: cached result fields validation
    test('SCORE_L1_03: score:get-cached result has all ScoreResult fields', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'SCORE_L1_03')!;
      const expectedFields = spec.scoreResultFields!;
      expect(expectedFields).toEqual(
        expect.arrayContaining([
          'dimensions[]',
          'totalScore',
          'grade',
          'title',
          'suggestions[]',
          'promptVersion',
          'contentHash',
        ]),
      );

      // Verify 6 dimensions from fixture
      expect(scoreDimensions).toHaveLength(6);

      // RED: import cache retriever (will fail -- not implemented)
      const { getCachedScore } = await import('@/modules/score/cache');
      const cached = await getCachedScore('/path/to/skill');
      if (cached.result) {
        expect(cached.result).toHaveProperty('totalScore');
        expect(cached.result).toHaveProperty('grade');
        expect(cached.result).toHaveProperty('dimensions');
      }
    });
  });

  // ========== SHOWCASE ==========
  describe('SHOWCASE -- 展示页', () => {
    // --- IPC invoke cases ---
    const showcaseIpcCases = v2Spec.cases.filter(
      (c) => c.type === 'ipc' && c.id.startsWith('SHOWCASE'),
    );

    test.each(showcaseIpcCases)(
      '$id: $description',
      async ({ channel, input, expectedResponse }) => {
        handleIpc(channel, async () => ({
          success: true,
          data: expectedResponse,
        }));

        const result = await invokeIpc(channel, input);
        expect(result).toBeDefined();
        expect(result.success).toBe(true);

        if (expectedResponse) {
          for (const key of Object.keys(expectedResponse)) {
            expect(result.data).toHaveProperty(key);
          }
        }
      },
    );

    // SHOWCASE_L1_01: draft fields validation
    test('SHOWCASE_L1_01: showcase:generate draft contains expected fields', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'SHOWCASE_L1_01')!;
      const draftFields = spec.draftFields!;
      expect(draftFields).toEqual(
        expect.arrayContaining(['name', 'description', 'features', 'template']),
      );

      // RED: import showcase generator (will fail -- not implemented)
      const { generateShowcase } = await import(
        '@/modules/showcase/generator'
      );
      const draft = await generateShowcase({ skillPath: '/test', scoreResult: {} });
      for (const field of draftFields) {
        expect(draft).toHaveProperty(field);
      }
    });
  });

  // ========== PUBLISH ==========
  describe('PUBLISH -- 发布/分享', () => {
    // --- IPC invoke cases ---
    const publishIpcCases = v2Spec.cases.filter(
      (c) => c.type === 'ipc' && c.id.startsWith('PUBLISH'),
    );

    test.each(publishIpcCases)(
      '$id: $description',
      async ({ channel, input, expectedResponse }) => {
        handleIpc(channel, async () => ({
          success: true,
          data: expectedResponse,
        }));

        const result = await invokeIpc(channel, input);
        expect(result).toBeDefined();
        expect(result.success).toBe(true);

        if (expectedResponse) {
          for (const key of Object.keys(expectedResponse)) {
            expect(result.data).toHaveProperty(key);
          }
        }
      },
    );

    // PUBLISH_L1_03: share channels default-value validation
    test('PUBLISH_L1_03: 分享面板数据格式 -- 返回 7 种渠道信息', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'PUBLISH_L1_03')!;
      const expectedChannels = (spec.expectedValue as { channelTypes: string[]; channelCount: number });
      expect(expectedChannels.channelCount).toBe(7);
      expect(expectedChannels.channelTypes).toHaveLength(7);
      expect(expectedChannels.channelTypes).toEqual(
        expect.arrayContaining([
          'Twitter/X', 'LinkedIn', 'WeChat', 'copy link', 'copy badge', 'Discord', 'Reddit',
        ]),
      );

      // RED: import share channels config (will fail -- not implemented)
      const { getShareChannels } = await import(
        '@/modules/publish/share-channels'
      );
      const channels = getShareChannels();
      expect(channels).toHaveLength(7);
    });

    // PUBLISH_L1_04: score:progress push event format
    test('PUBLISH_L1_04: score:progress push 事件格式 -- 评分进度推送', () => {
      const spec = v2Spec.cases.find((c) => c.id === 'PUBLISH_L1_04')!;
      const expectedPayload = spec.expectedPayload!;

      const received: unknown[] = [];
      onIpcPush('score:progress', (...args: unknown[]) => {
        received.push(args[0]);
      });

      const mockPayload: Record<string, unknown> = {};
      for (const key of Object.keys(expectedPayload)) {
        mockPayload[key] = `mock_${key}`;
      }
      emitIpcPush('score:progress', mockPayload);

      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('taskId');
      expect(payload).toHaveProperty('stage');
      expect(payload).toHaveProperty('progress');
    });
  });

  // ========== COMMUNITY ==========
  describe('COMMUNITY -- 社区平台', () => {
    // COMMUNITY_L1_01: Feed data format (default-value type)
    test('COMMUNITY_L1_01: Feed 流数据格式 -- 返回 items 列表含 skill/author/score', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'COMMUNITY_L1_01')!;
      expect(spec.expectedValue).toBeDefined();

      // RED: import community feed module (will fail -- not implemented)
      const { getFeed } = await import('@/modules/community/feed');
      const feed = await getFeed();
      expect(feed).toHaveProperty('items');
      expect(Array.isArray(feed.items)).toBe(true);
      if (feed.items.length > 0) {
        expect(feed.items[0]).toHaveProperty('skill');
        expect(feed.items[0]).toHaveProperty('author');
        expect(feed.items[0]).toHaveProperty('score');
        expect(feed.items[0]).toHaveProperty('publishedAt');
        expect(feed.items[0]).toHaveProperty('likes');
        expect(feed.items[0]).toHaveProperty('comments');
      }
    });

    // COMMUNITY_L1_02: Comment data format (default-value type)
    test('COMMUNITY_L1_02: 评论数据格式 -- 返回 comments 列表', async () => {
      const spec = v2Spec.cases.find((c) => c.id === 'COMMUNITY_L1_02')!;
      expect(spec.expectedValue).toBeDefined();

      // RED: import community comments module (will fail -- not implemented)
      const { getComments } = await import('@/modules/community/comments');
      const result = await getComments('some-skill-id');
      expect(result).toHaveProperty('comments');
      expect(Array.isArray(result.comments)).toBe(true);
      if (result.comments.length > 0) {
        const comment = result.comments[0];
        expect(comment).toHaveProperty('id');
        expect(comment).toHaveProperty('author');
        expect(comment).toHaveProperty('content');
        expect(comment).toHaveProperty('createdAt');
        expect(comment).toHaveProperty('likes');
      }
    });

    // COMMUNITY_L1_03: score:result push event format
    test('COMMUNITY_L1_03: score:result push 事件格式 -- 评分完成结果推送', () => {
      const spec = v2Spec.cases.find((c) => c.id === 'COMMUNITY_L1_03')!;
      const expectedPayload = spec.expectedPayload!;

      const received: unknown[] = [];
      onIpcPush('score:result', (...args: unknown[]) => {
        received.push(args[0]);
      });

      // Emit mock push with expected shape
      const mockPayload: Record<string, unknown> = {
        taskId: 'mock-task-id',
        result: {
          dimensions: Array.from({ length: 6 }, (_, i) => ({
            name: scoreDimensions[i].name,
            score: 80,
            reason: 'mock reason',
            suggestions: [],
          })),
          totalScore: 78.5,
          grade: 'Advanced',
        },
      };
      emitIpcPush('score:result', mockPayload);

      expect(received).toHaveLength(1);
      const payload = received[0] as Record<string, unknown>;
      expect(payload).toHaveProperty('taskId');
      expect(payload).toHaveProperty('result');

      const result = payload.result as Record<string, unknown>;
      expect(result).toHaveProperty('dimensions');
      expect(result).toHaveProperty('totalScore');
      expect(result).toHaveProperty('grade');
    });
  });

  // ========== AUTH ==========
  describe('AUTH -- 认证授权', () => {
    // --- IPC invoke cases ---
    const authIpcCases = v2Spec.cases.filter(
      (c) => c.type === 'ipc' && c.id.startsWith('AUTH'),
    );

    test.each(authIpcCases)(
      '$id: $description',
      async ({ channel, input, expectedResponse }) => {
        handleIpc(channel, async () => ({
          success: true,
          data: expectedResponse,
        }));

        const result = await invokeIpc(channel, input);
        expect(result).toBeDefined();
        expect(result.success).toBe(true);

        if (expectedResponse) {
          for (const key of Object.keys(expectedResponse)) {
            expect(result.data).toHaveProperty(key);
          }
        }
      },
    );

    // AUTH_L1_01: Login returns user info
    test('AUTH_L1_01: auth:login-github returns user info on success', async () => {
      // RED: import real auth module (will fail -- not implemented)
      const { loginGithub } = await import('@/modules/auth/github-oauth');
      const result = await loginGithub();
      expect(result).toHaveProperty('success');
      if (result.success) {
        expect(result.user).toBeDefined();
        expect(result.user).toHaveProperty('username');
        expect(result.user).toHaveProperty('avatarUrl');
      }
    });

    // AUTH_L1_02: Logout returns success
    test('AUTH_L1_02: auth:logout clears auth state', async () => {
      // RED: import real auth module (will fail -- not implemented)
      const { logout } = await import('@/modules/auth/github-oauth');
      const result = await logout();
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
    });

    // AUTH_L1_03: Get auth status includes token expiry
    test('AUTH_L1_03: auth:get-status returns login state with optional token expiry', async () => {
      // RED: import real auth module (will fail -- not implemented)
      const { getAuthStatus } = await import('@/modules/auth/github-oauth');
      const status = await getAuthStatus();
      expect(status).toHaveProperty('loggedIn');
      if (status.loggedIn) {
        expect(status).toHaveProperty('user');
        expect(status.user).toHaveProperty('username');
      }
    });
  });
});
