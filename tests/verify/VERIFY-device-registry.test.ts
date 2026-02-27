/**
 * VERIFY: Device registry — device info collection + heartbeat HTTP call + server route logic.
 *
 * Feature: Client collects device info (platform, arch, os_version, app_version, hostname),
 * sends heartbeat to POST /devices/heartbeat, server UPSERT into devices table.
 * If device is blocked, client shows dialog and quits.
 *
 * Tests cover:
 * 1. getDeviceInfo() returns all 5 required fields with correct types
 * 2. createBackendClient().deviceHeartbeat() sends correct HTTP request
 * 3. deviceHeartbeat() handles blocked response
 * 4. deviceHeartbeat() returns null on network failure (fail-open)
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. getDeviceInfo() — Pure logic test
// ---------------------------------------------------------------------------

// Mock electron app before importing
vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.2.3',
    getPath: () => '/tmp',
    getName: () => 'Muxvo',
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: {},
  Menu: {},
}));

import { getDeviceInfo } from '@/main/services/analytics/device-info';

describe('VERIFY: getDeviceInfo()', () => {
  test('returns object with all 5 required fields', () => {
    const info = getDeviceInfo();
    expect(info).toHaveProperty('platform');
    expect(info).toHaveProperty('arch');
    expect(info).toHaveProperty('os_version');
    expect(info).toHaveProperty('app_version');
    expect(info).toHaveProperty('hostname');
  });

  test('platform is a non-empty string matching process.platform', () => {
    const info = getDeviceInfo();
    expect(typeof info.platform).toBe('string');
    expect(info.platform.length).toBeGreaterThan(0);
    expect(info.platform).toBe(process.platform);
  });

  test('arch is a non-empty string matching process.arch', () => {
    const info = getDeviceInfo();
    expect(typeof info.arch).toBe('string');
    expect(info.arch.length).toBeGreaterThan(0);
    expect(info.arch).toBe(process.arch);
  });

  test('os_version is a non-empty string', () => {
    const info = getDeviceInfo();
    expect(typeof info.os_version).toBe('string');
    expect(info.os_version.length).toBeGreaterThan(0);
  });

  test('app_version uses electron app.getVersion()', () => {
    const info = getDeviceInfo();
    expect(info.app_version).toBe('1.2.3');
  });

  test('hostname is a non-empty string', () => {
    const info = getDeviceInfo();
    expect(typeof info.hostname).toBe('string');
    expect(info.hostname.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. createBackendClient().deviceHeartbeat() — Data flow test
// ---------------------------------------------------------------------------

import { createBackendClient } from '@/main/services/auth/backend-client';

describe('VERIFY: deviceHeartbeat()', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends POST to /devices/heartbeat with correct headers and body', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ device_id: 'abc-123', status: 'active' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = createBackendClient({ baseUrl: 'https://api.test.com' });
    const info = {
      platform: 'darwin',
      arch: 'arm64',
      os_version: '25.3.0',
      app_version: '1.0.0',
      hostname: 'test-mac.local',
    };

    const result = await client.deviceHeartbeat('device-uuid-123', info, 'my-access-token');

    // Verify URL
    expect(capturedUrl).toBe('https://api.test.com/devices/heartbeat');

    // Verify method
    expect(capturedInit?.method).toBe('POST');

    // Verify headers
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['X-Device-ID']).toBe('device-uuid-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer my-access-token');

    // Verify body
    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toEqual(info);

    // Verify response
    expect(result).toEqual({ device_id: 'abc-123', status: 'active' });
  });

  test('sends without Authorization header when no accessToken', async () => {
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ device_id: 'abc', status: 'active' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = createBackendClient({ baseUrl: 'https://api.test.com' });
    await client.deviceHeartbeat('dev-id', { platform: 'darwin', arch: 'arm64', os_version: '1', app_version: '1', hostname: 'h' });

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['X-Device-ID']).toBe('dev-id');
    expect(headers['Authorization']).toBeUndefined();
  });

  test('returns blocked status when device is blocked', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ device_id: 'abc', status: 'blocked' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = createBackendClient({ baseUrl: 'https://api.test.com' });
    const result = await client.deviceHeartbeat('dev-id', { platform: 'darwin', arch: 'arm64', os_version: '1', app_version: '1', hostname: 'h' });

    expect(result).not.toBeNull();
    expect(result!.status).toBe('blocked');
  });

  test('returns null on HTTP error (fail-open)', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Internal Server Error', { status: 500 });
    }) as unknown as typeof fetch;

    const client = createBackendClient({ baseUrl: 'https://api.test.com' });
    const result = await client.deviceHeartbeat('dev-id', { platform: 'darwin', arch: 'arm64', os_version: '1', app_version: '1', hostname: 'h' });

    expect(result).toBeNull();
  });

  test('returns null on network error (fail-open)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network error');
    }) as unknown as typeof fetch;

    const client = createBackendClient({ baseUrl: 'https://api.test.com' });
    const result = await client.deviceHeartbeat('dev-id', { platform: 'darwin', arch: 'arm64', os_version: '1', app_version: '1', hostname: 'h' });

    expect(result).toBeNull();
  });
});
