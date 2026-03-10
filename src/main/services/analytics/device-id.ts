/**
 * 设备标识 — 基于 macOS IOPlatformUUID 的 SHA-256 hash，稳定且隐私安全
 * 重装 app 甚至重装系统后 ID 不变，避免 DAU 虚高
 * 路径: app.getPath('userData')/device_id（缓存，避免每次 exec）
 */
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';

let cachedDeviceId: string | null = null;
let previousDeviceId: string | null = null;

/** 返回升级前的旧 device_id（仅在 ID 发生变更时有值），供 heartbeat 迁移用 */
export function getPreviousDeviceId(): string | null {
  return previousDeviceId;
}

function getMacHardwareId(): string | null {
  try {
    const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf-8' });
    const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (match) {
      return createHash('sha256').update(match[1]).digest('hex').slice(0, 32);
    }
  } catch { /* fallback to random UUID */ }
  return null;
}

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  const filePath = join(app.getPath('userData'), 'device_id');
  const hardwareId = getMacHardwareId();

  if (hardwareId) {
    // 硬件 ID 可用：始终使用它（覆盖旧的随机 UUID）
    if (existsSync(filePath)) {
      const existingId = readFileSync(filePath, 'utf-8').trim();
      if (existingId && existingId !== hardwareId) {
        // 旧版本用的随机 UUID，记录下来供 heartbeat 迁移
        previousDeviceId = existingId;
      }
    }
    cachedDeviceId = hardwareId;
    writeFileSync(filePath, hardwareId, 'utf-8');
  } else if (existsSync(filePath)) {
    // 硬件 ID 不可用，但有缓存文件
    cachedDeviceId = readFileSync(filePath, 'utf-8').trim();
  } else {
    // 兜底：随机 UUID
    cachedDeviceId = randomUUID();
    writeFileSync(filePath, cachedDeviceId, 'utf-8');
  }

  return cachedDeviceId;
}
