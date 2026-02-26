/**
 * 设备标识 — 首次启动生成 UUIDv4，持久化到 userData 目录
 * 路径: app.getPath('userData')/device_id
 */
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  const filePath = join(app.getPath('userData'), 'device_id');

  if (existsSync(filePath)) {
    cachedDeviceId = readFileSync(filePath, 'utf-8').trim();
  } else {
    cachedDeviceId = randomUUID();
    writeFileSync(filePath, cachedDeviceId, 'utf-8');
  }

  return cachedDeviceId;
}
