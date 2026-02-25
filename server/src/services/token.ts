import { query } from '../db/index.js';
import { signAccessToken, generateRefreshToken } from '../lib/jwt.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Issue a new access token + refresh token pair for the given user.
 *
 * The refresh token's SHA-256 hash is stored in the database (never the
 * plain-text value). The plain-text refresh token is returned to the caller
 * so it can be sent to the client.
 */
export async function issueTokenPair(
  userId: string,
  deviceInfo?: Record<string, unknown>,
): Promise<TokenPair> {
  const accessToken = await signAccessToken(userId);
  const { value: refreshToken, hash: tokenHash } = generateRefreshToken();

  // 30 days from now
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, JSON.stringify(deviceInfo ?? {}), expiresAt.toISOString()],
  );

  return { accessToken, refreshToken };
}

/**
 * Revoke a single refresh token by its hash.
 */
export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [tokenHash],
  );
}

/**
 * Revoke ALL active refresh tokens for a user (e.g. on token reuse detection).
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
