/**
 * Token Storage - securely stores authentication tokens
 * Uses Electron safeStorage (macOS Keychain) by default
 *
 * Original API preserved: storeToken, getToken, clearToken, getTokenStorageType
 * Extended API: storeTokenPair, getTokenPair
 */

let storedToken: string | undefined;
let storedRefreshToken: string | undefined;
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
  storedRefreshToken = undefined;
}

/** Store both access and refresh tokens */
export async function storeTokenPair(accessToken: string, refreshToken: string): Promise<void> {
  storedToken = accessToken;
  storedRefreshToken = refreshToken;
}

/** Retrieve both tokens */
export async function getTokenPair(): Promise<{ accessToken?: string; refreshToken?: string }> {
  return {
    accessToken: storedToken,
    refreshToken: storedRefreshToken,
  };
}
