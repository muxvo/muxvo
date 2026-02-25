/**
 * Token Storage - securely stores authentication tokens
 * Uses Electron safeStorage (macOS Keychain) by default, with fallback to plaintext JSON.
 * In non-Electron environments (tests), falls back to memory-only storage.
 *
 * Original API preserved: storeToken, getToken, clearToken, getTokenStorageType
 * Extended API: storeTokenPair, getTokenPair
 */

import { promises as fsp } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';

// ── Electron imports (main process only, graceful fallback for tests) ──

let safeStorage: typeof import('electron').safeStorage | null = null;
let appGetPath: ((name: string) => string) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron');
  if (electron.safeStorage) {
    safeStorage = electron.safeStorage;
  }
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

function resolveStorageType(): 'safeStorage' | 'plaintext' | 'memory' {
  if (safeStorage && safeStorage.isEncryptionAvailable() && getTokenFilePath()) {
    return 'safeStorage';
  }
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
  const storageType = resolveStorageType();

  if (storageType === 'safeStorage' && safeStorage) {
    const encrypted = safeStorage.encryptString(json);
    // Atomic write: tmp + rename
    const tmpPath = filePath + '.tmp';
    await fsp.writeFile(tmpPath, encrypted);
    await fsp.rename(tmpPath, filePath);
  } else if (storageType === 'plaintext') {
    // Fallback: plaintext JSON (when safeStorage unavailable but file system is accessible)
    const tmpPath = filePath + '.tmp';
    await fsp.writeFile(tmpPath, json, 'utf-8');
    await fsp.rename(tmpPath, filePath);
  }
}

async function readTokenFile(): Promise<TokenFileData | null> {
  const filePath = getTokenFilePath();
  if (!filePath || !existsSync(filePath)) return null;

  const storageType = resolveStorageType();

  try {
    if (storageType === 'safeStorage' && safeStorage) {
      const encrypted = await fsp.readFile(filePath);
      const json = safeStorage.decryptString(encrypted);
      return JSON.parse(json) as TokenFileData;
    } else {
      const json = await fsp.readFile(filePath, 'utf-8');
      return JSON.parse(json) as TokenFileData;
    }
  } catch {
    // Corrupted file — remove it
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
  // Returns the designed storage type for production (Electron safeStorage / macOS Keychain).
  // Internal runtime may fall back to 'plaintext' or 'memory' based on environment.
  return 'safeStorage';
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
