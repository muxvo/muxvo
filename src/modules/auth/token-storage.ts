/**
 * Token Storage - stores authentication tokens as plaintext JSON.
 * File is protected by macOS file permissions (mode 0600).
 * In non-Electron environments (tests), falls back to memory-only storage.
 *
 * Original API preserved: storeToken, getToken, clearToken, getTokenStorageType
 * Extended API: storeTokenPair, getTokenPair
 */

import { promises as fsp } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';

// ── Electron imports (main process only, graceful fallback for tests) ──

let appGetPath: ((name: string) => string) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron');
  if (electron.app?.getPath) {
    appGetPath = (name: string) => electron.app.getPath(name);
  }
} catch {
  // Not in Electron main process (e.g. test environment) — memory-only fallback
}

// ── Token file path ──

function getTokenFilePath(): string | null {
  if (!appGetPath) return null;
  try {
    return join(appGetPath('userData'), '.auth-token');
  } catch {
    return null;
  }
}

// ── In-memory cache (always maintained for fast reads) ──

let cachedAccessToken: string | undefined;
let cachedRefreshToken: string | undefined;

// ── Storage type detection (runtime) ──

function resolveStorageType(): 'plaintext' | 'memory' {
  if (getTokenFilePath()) {
    return 'plaintext';
  }
  return 'memory';
}

// ── File I/O helpers ──

interface TokenFileData {
  accessToken: string;
  refreshToken: string;
}

async function writeTokenFile(data: TokenFileData): Promise<void> {
  const filePath = getTokenFilePath();
  if (!filePath) return;

  const json = JSON.stringify(data);
  const tmpPath = filePath + '.tmp';
  await fsp.writeFile(tmpPath, json, 'utf-8');
  await fsp.rename(tmpPath, filePath);
  // Restrict file permissions to owner only (macOS/Linux)
  try { await fsp.chmod(filePath, 0o600); } catch { /* ignore on unsupported platforms */ }
}

async function readTokenFile(): Promise<TokenFileData | null> {
  const filePath = getTokenFilePath();
  if (!filePath || !existsSync(filePath)) return null;

  try {
    const json = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(json) as TokenFileData;
  } catch {
    // Corrupted or old safeStorage-encrypted file — remove it (user will re-login once)
    await deleteTokenFile();
    return null;
  }
}

async function deleteTokenFile(): Promise<void> {
  const filePath = getTokenFilePath();
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch {
    // File may not exist — ignore
  }
  // Clean up leftover tmp file
  try {
    await fsp.unlink(filePath + '.tmp');
  } catch {
    // ignore
  }
}

// ── Public API (signatures preserved) ──

export async function storeToken(token: string): Promise<void> {
  cachedAccessToken = token;
  await writeTokenFile({
    accessToken: token,
    refreshToken: cachedRefreshToken || '',
  });
}

export function getTokenStorageType(): string {
  return 'plaintext';
}

export async function getToken(): Promise<string | undefined> {
  if (cachedAccessToken) return cachedAccessToken;

  // Try loading from file on first access
  const data = await readTokenFile();
  if (data) {
    cachedAccessToken = data.accessToken;
    cachedRefreshToken = data.refreshToken || undefined;
    return cachedAccessToken;
  }
  return undefined;
}

export async function clearToken(): Promise<void> {
  cachedAccessToken = undefined;
  cachedRefreshToken = undefined;
  await deleteTokenFile();
}

/** Store both access and refresh tokens */
export async function storeTokenPair(accessToken: string, refreshToken: string): Promise<void> {
  cachedAccessToken = accessToken;
  cachedRefreshToken = refreshToken;
  await writeTokenFile({ accessToken, refreshToken });
}

/** Retrieve both tokens */
export async function getTokenPair(): Promise<{ accessToken?: string; refreshToken?: string }> {
  if (cachedAccessToken || cachedRefreshToken) {
    return {
      accessToken: cachedAccessToken,
      refreshToken: cachedRefreshToken,
    };
  }

  // Try loading from file on first access
  const data = await readTokenFile();
  if (data) {
    cachedAccessToken = data.accessToken;
    cachedRefreshToken = data.refreshToken || undefined;
    return {
      accessToken: cachedAccessToken,
      refreshToken: cachedRefreshToken,
    };
  }

  return {};
}
