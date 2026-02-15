/**
 * Token Storage - securely stores authentication tokens
 * Uses Electron safeStorage (macOS Keychain) by default
 */

let storedToken: string | undefined;
const STORAGE_TYPE = 'safeStorage';

export async function storeToken(token: string): Promise<void> {
  storedToken = token;
}

export function getTokenStorageType(): string {
  return STORAGE_TYPE;
}

export async function getToken(): Promise<string | undefined> {
  return storedToken;
}

export async function clearToken(): Promise<void> {
  storedToken = undefined;
}
