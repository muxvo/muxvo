/**
 * V2 内容模块组 L2 规则层测试（COMMUNITY + AUTH）
 *
 * Source: docs/Muxvo_测试_v2/02_modules/test_V2_CONTENT.md
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect } from 'vitest';

// ============================================================
// COMMUNITY L2 -- 社区平台（10 cases）
// ============================================================

describe('COMMUNITY L2 -- 规则层测试', () => {
  // COMMUNITY_L2_01: Feed 流排序
  test('COMMUNITY_L2_01: Feed 流排序', async () => {
    // RED: import feed sorter (will fail -- not implemented)
    const { sortFeedItems } = await import('@/modules/community/feed');
    const items = [
      { publishedAt: '2026-01-01T12:00:00Z', name: 'old' },
      { publishedAt: '2026-02-15T12:00:00Z', name: 'new' },
      { publishedAt: '2026-01-15T12:00:00Z', name: 'mid' },
    ];
    const sorted = sortFeedItems(items);
    expect(sorted[0].name).toBe('new');
    expect(sorted[1].name).toBe('mid');
    expect(sorted[2].name).toBe('old');
  });

  // COMMUNITY_L2_02: 点赞交互
  test('COMMUNITY_L2_02: 点赞交互', async () => {
    const { toggleLike } = await import('@/modules/community/interactions');
    // Not liked -> like
    const result1 = toggleLike({ skillId: 'test', currentLiked: false, currentLikes: 10 });
    expect(result1.liked).toBe(true);
    expect(result1.likes).toBe(11);

    // Liked -> unlike
    const result2 = toggleLike({ skillId: 'test', currentLiked: true, currentLikes: 11 });
    expect(result2.liked).toBe(false);
    expect(result2.likes).toBe(10);
  });

  // COMMUNITY_L2_03: 评论交互
  test('COMMUNITY_L2_03: 评论交互', async () => {
    const { postComment } = await import('@/modules/community/interactions');
    const result = await postComment({
      skillId: 'test',
      author: 'user1',
      content: 'Great skill!',
    });
    expect(result.success).toBe(true);
    expect(result.comment).toHaveProperty('id');
    expect(result.comment.content).toBe('Great skill!');
    expect(result.comment.createdAt).toBeDefined();
  });

  // COMMUNITY_L2_04: 排行榜
  test('COMMUNITY_L2_04: 排行榜', async () => {
    const { getLeaderboard } = await import('@/modules/community/leaderboard');
    const weekly = await getLeaderboard({ period: 'weekly' });
    expect(Array.isArray(weekly.items)).toBe(true);
    // Items should be sorted by totalScore descending
    if (weekly.items.length >= 2) {
      expect(weekly.items[0].totalScore).toBeGreaterThanOrEqual(
        weekly.items[1].totalScore,
      );
    }

    const monthly = await getLeaderboard({ period: 'monthly' });
    expect(Array.isArray(monthly.items)).toBe(true);
  });

  // COMMUNITY_L2_05: 个人主页
  test('COMMUNITY_L2_05: 个人主页', async () => {
    const { getUserProfile } = await import('@/modules/community/profile');
    const profile = await getUserProfile('testuser');
    expect(profile.url).toContain('showcase.muxvo.com/@testuser');
    expect(profile).toHaveProperty('skills');
    expect(profile).toHaveProperty('username');
  });

  // COMMUNITY_L2_06: Feed 流分页
  test('COMMUNITY_L2_06: Feed 流分页', async () => {
    const { getFeed } = await import('@/modules/community/feed');

    // First page
    const page1 = await getFeed({ cursor: undefined });
    expect(page1).toHaveProperty('items');
    expect(page1).toHaveProperty('nextCursor');

    // Second page using cursor
    if (page1.nextCursor) {
      const page2 = await getFeed({ cursor: page1.nextCursor });
      expect(page2).toHaveProperty('items');
      // Items from page2 should not overlap with page1
    }
  });

  // COMMUNITY_L2_07: 社区页面安装
  test('COMMUNITY_L2_07: 社区页面安装', async () => {
    const { resolveInstallAction } = await import(
      '@/modules/community/install-bridge'
    );

    // User has Muxvo installed -> deep link
    const withApp = resolveInstallAction({ muxvoInstalled: true, packageName: 'test-skill' });
    expect(withApp.action).toBe('deep-link');
    expect(withApp.url).toContain('muxvo://install/');

    // User does not have Muxvo -> manual install instructions
    const withoutApp = resolveInstallAction({ muxvoInstalled: false, packageName: 'test-skill' });
    expect(withoutApp.action).toBe('manual');
  });

  // COMMUNITY_L2_08: 公开源码一键安装
  test('COMMUNITY_L2_08: 公开源码一键安装', async () => {
    const { checkOneClickInstall } = await import(
      '@/modules/community/install-bridge'
    );
    const result = checkOneClickInstall({
      skillId: 'test-skill',
      sourceCodePublic: true,
    });
    expect(result.oneClickAvailable).toBe(true);
  });

  // COMMUNITY_L2_09: Feed 流空状态
  test('COMMUNITY_L2_09: Feed 流空状态', async () => {
    const { getFeedEmptyState } = await import('@/modules/community/feed');
    const emptyState = getFeedEmptyState();
    expect(emptyState.message).toContain('还没有人发布');
  });

  // COMMUNITY_L2_10: 周榜/月榜切换
  test('COMMUNITY_L2_10: 周榜/月榜切换', async () => {
    const { getLeaderboard } = await import('@/modules/community/leaderboard');

    const weekly = await getLeaderboard({ period: 'weekly' });
    expect(weekly.periodDays).toBe(7);

    const monthly = await getLeaderboard({ period: 'monthly' });
    expect(monthly.periodDays).toBe(30);
  });
});

// ============================================================
// AUTH L2 -- 认证授权（5 cases）
// ============================================================

describe('AUTH L2 -- 规则层测试', () => {
  describe('状态机: 用户认证 (PRD 6.17)', () => {
    // AUTH_L2_01: GitHub OAuth PKCE 流程
    test('AUTH_L2_01: GitHub OAuth PKCE 流程', async () => {
      // RED: import OAuth PKCE handler (will fail -- not implemented)
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      expect(machine.state).toBe('LoggedOut');

      machine.send('LOGIN');
      expect(machine.state).toBe('Authorizing');

      // Verify PKCE challenge generated
      expect(machine.context.codeVerifier).toBeDefined();
      expect(machine.context.codeChallenge).toBeDefined();
      expect(machine.context.codeVerifier.length).toBeGreaterThan(0);

      // Simulate successful callback
      machine.send('AUTH_CALLBACK', { authCode: 'mock-code' });
      machine.send('TOKEN_RECEIVED', { accessToken: 'ghp_test', username: 'testuser' });
      expect(machine.state).toBe('LoggedIn');
      expect(machine.context.tokenStorage).toBe('safeStorage');
    });

    // AUTH_L2_02: 授权取消/失败 (Authorizing -> LoggedOut)
    test('AUTH_L2_02: 授权取消/失败 (Authorizing -> LoggedOut)', async () => {
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      machine.send('LOGIN');
      expect(machine.state).toBe('Authorizing');

      machine.send('AUTH_FAILED', { error: 'user_cancelled' });
      expect(machine.state).toBe('LoggedOut');
      expect(machine.context.error).toContain('GitHub 授权失败');
    });

    // AUTH_L2_03: Token 过期处理 (LoggedIn -> LoggedOut)
    test('AUTH_L2_03: Token 过期处理 (LoggedIn -> LoggedOut)', async () => {
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      // Bring to LoggedIn
      machine.send('LOGIN');
      machine.send('AUTH_CALLBACK', { authCode: 'mock-code' });
      machine.send('TOKEN_RECEIVED', { accessToken: 'ghp_test', username: 'testuser' });
      expect(machine.state).toBe('LoggedIn');

      // Token expires
      machine.send('TOKEN_EXPIRED');
      expect(machine.state).toBe('LoggedOut');
      expect(machine.context.accessToken).toBeUndefined();
    });

    // AUTH_L2_04: 手动登出
    test('AUTH_L2_04: 手动登出', async () => {
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      machine.send('LOGIN');
      machine.send('AUTH_CALLBACK', { authCode: 'mock-code' });
      machine.send('TOKEN_RECEIVED', { accessToken: 'ghp_test', username: 'testuser' });
      expect(machine.state).toBe('LoggedIn');

      machine.send('LOGOUT');
      expect(machine.state).toBe('LoggedOut');
      expect(machine.context.accessToken).toBeUndefined();
      expect(machine.context.username).toBeUndefined();
    });

    // AUTH_L2_05: Token 安全存储
    test('AUTH_L2_05: Token 安全存储', async () => {
      const { storeToken, getTokenStorageType } = await import(
        '@/modules/auth/token-storage'
      );

      await storeToken('ghp_test_token');
      const storageType = getTokenStorageType();

      // Should use Electron safeStorage (macOS Keychain)
      expect(storageType).toBe('safeStorage');
    });
  });

  // ─── Phase 5 新增 AUTH L2 测试 ───
  describe('状态机: ExchangingToken 新路径 (Phase 5)', () => {
    // AUTH_L2_06: ExchangingToken 状态转换
    test('AUTH_L2_06: ExchangingToken 新路径 (Authorizing -> ExchangingToken -> LoggedIn)', async () => {
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      machine.send('LOGIN', { authMethod: 'github' });
      expect(machine.state).toBe('Authorizing');

      machine.send('EXCHANGE_TOKEN');
      expect(machine.state).toBe('ExchangingToken');

      machine.send('BACKEND_TOKEN_RECEIVED', {
        accessToken: 'jwt_access',
        refreshToken: 'jwt_refresh',
        username: 'testuser',
        userId: 'usr_123',
        email: 'test@example.com',
      });
      expect(machine.state).toBe('LoggedIn');
      expect(machine.context.accessToken).toBe('jwt_access');
      expect(machine.context.refreshToken).toBe('jwt_refresh');
      expect(machine.context.userId).toBe('usr_123');
    });

    // AUTH_L2_07: ExchangingToken 失败回退
    test('AUTH_L2_07: ExchangingToken 失败回退 (ExchangingToken -> LoggedOut)', async () => {
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      machine.send('LOGIN');
      machine.send('EXCHANGE_TOKEN');
      expect(machine.state).toBe('ExchangingToken');

      machine.send('AUTH_FAILED', { error: 'Token exchange failed' });
      expect(machine.state).toBe('LoggedOut');
      expect(machine.context.error).toContain('Token exchange failed');
    });

    // AUTH_L2_08: TOKEN_REFRESH 保持 LoggedIn
    test('AUTH_L2_08: TOKEN_REFRESH 保持 LoggedIn 并更新 token', async () => {
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      // Bring to LoggedIn via original path
      machine.send('LOGIN');
      machine.send('TOKEN_RECEIVED', { accessToken: 'old_token', username: 'user' });
      expect(machine.state).toBe('LoggedIn');

      machine.send('TOKEN_REFRESH', {
        accessToken: 'new_token',
        refreshToken: 'new_refresh',
      });
      expect(machine.state).toBe('LoggedIn');
      expect(machine.context.accessToken).toBe('new_token');
      expect(machine.context.refreshToken).toBe('new_refresh');
    });

    // AUTH_L2_09: REFRESH_FAILED 回退到 LoggedOut
    test('AUTH_L2_09: REFRESH_FAILED 回退到 LoggedOut', async () => {
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      machine.send('LOGIN');
      machine.send('TOKEN_RECEIVED', { accessToken: 'token', username: 'user' });
      expect(machine.state).toBe('LoggedIn');

      machine.send('REFRESH_FAILED', { error: 'Refresh 过期' });
      expect(machine.state).toBe('LoggedOut');
      expect(machine.context.error).toContain('Refresh 过期');
      expect(machine.context.accessToken).toBeUndefined();
    });

    // AUTH_L2_10: authMethod 上下文保留
    test('AUTH_L2_10: authMethod 上下文在 LOGIN 时设置', async () => {
      const { createAuthMachine } = await import('@/modules/auth/auth-machine');
      const machine = createAuthMachine();

      machine.send('LOGIN', { authMethod: 'google' });
      expect(machine.context.authMethod).toBe('google');

      machine.send('AUTH_FAILED');
      expect(machine.state).toBe('LoggedOut');
      expect(machine.context.authMethod).toBeUndefined();
    });
  });

  describe('Token 存储扩展 (Phase 5)', () => {
    // AUTH_L2_11: Token 对存储和读取
    test('AUTH_L2_11: storeTokenPair/getTokenPair 存储和读取 token 对', async () => {
      const { storeTokenPair, getTokenPair, clearToken } = await import(
        '@/modules/auth/token-storage'
      );

      await storeTokenPair('access_abc', 'refresh_xyz');
      const pair = await getTokenPair();
      expect(pair.accessToken).toBe('access_abc');
      expect(pair.refreshToken).toBe('refresh_xyz');

      await clearToken();
      const cleared = await getTokenPair();
      expect(cleared.accessToken).toBeUndefined();
      expect(cleared.refreshToken).toBeUndefined();
    });

    // AUTH_L2_12: storeToken 兼容性
    test('AUTH_L2_12: storeToken 原有接口兼容性保持', async () => {
      const { storeToken, getToken, getTokenStorageType, clearToken } = await import(
        '@/modules/auth/token-storage'
      );

      await storeToken('single_token');
      expect(await getToken()).toBe('single_token');
      expect(getTokenStorageType()).toBe('safeStorage');

      await clearToken();
      expect(await getToken()).toBeUndefined();
    });
  });
});
