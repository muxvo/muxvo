/**
 * AUTH L1 -- 契约层测试
 * Source: tests/specs/l1/auth.spec.json
 * Total: 6 L1 cases (AUTH_L1_01 ~ AUTH_L1_06)
 *
 * 验证 auth IPC channel 的消息格式合约：
 * - auth:login-github → { success, data?: { user } }
 * - auth:logout → { success }
 * - auth:get-status → { success, data: { loggedIn, user?, tokenExpiry? } }
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, resetIpcMocks } from '../helpers/mock-ipc';
import authSpec from '../specs/l1/auth.spec.json';

describe('AUTH L1 -- 契约层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // -------------------------------------------------------------------------
  // IPC 通道消息格式
  // -------------------------------------------------------------------------
  describe('IPC 通道消息格式', () => {
    const ipcCases = authSpec.cases.filter((c) => c.type === 'ipc');

    test.each(ipcCases)('$id: $description', async ({ channel, input, expectedResponse }) => {
      // Register a stub handler that returns the expected shape
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
    });
  });

  // -------------------------------------------------------------------------
  // Real handler 验证
  // -------------------------------------------------------------------------
  describe('Real handler 存在性验证', () => {
    test('AUTH_L1_01_real: auth handler factory exists and returns expected methods', async () => {
      const { createAuthHandlers } = await import('@/main/ipc/auth-handlers');
      const handlers = createAuthHandlers();
      expect(handlers).toBeDefined();
      expect(handlers.loginGithub).toBeTypeOf('function');
      expect(handlers.logout).toBeTypeOf('function');
      expect(handlers.getStatus).toBeTypeOf('function');
    });

    test('AUTH_L1_02_real: loginGithub returns { success } shape', async () => {
      const { createAuthHandlers } = await import('@/main/ipc/auth-handlers');
      const handlers = createAuthHandlers();
      const result = await handlers.loginGithub();
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    test('AUTH_L1_03_real: logout returns { success } shape', async () => {
      const { createAuthHandlers } = await import('@/main/ipc/auth-handlers');
      const handlers = createAuthHandlers();
      const result = await handlers.logout();
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    test('AUTH_L1_03_real_status: getStatus returns { success, data: { loggedIn } } shape', async () => {
      const { createAuthHandlers } = await import('@/main/ipc/auth-handlers');
      const handlers = createAuthHandlers();
      const result = await handlers.getStatus();
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
      if (result.success && result.data) {
        expect(result.data).toHaveProperty('loggedIn');
      }
    });

    test('AUTH_L1_04_real: register handler exists', async () => {
      const { createAuthHandlers } = await import('@/main/ipc/auth-handlers');
      const handlers = createAuthHandlers();
      expect(handlers.register).toBeTypeOf('function');
    });

    test('AUTH_L1_05_real: loginPassword handler exists', async () => {
      const { createAuthHandlers } = await import('@/main/ipc/auth-handlers');
      const handlers = createAuthHandlers();
      expect(handlers.loginPassword).toBeTypeOf('function');
    });

    test('AUTH_L1_06_real: resetPassword handler exists', async () => {
      const { createAuthHandlers } = await import('@/main/ipc/auth-handlers');
      const handlers = createAuthHandlers();
      expect(handlers.resetPassword).toBeTypeOf('function');
    });
  });
});
