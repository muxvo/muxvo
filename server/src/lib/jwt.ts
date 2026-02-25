import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

const ALGORITHM = 'RS256';
const ISSUER = 'https://api.muxvo.com';
const AUDIENCE = 'muxvo-app';

let privateKey: CryptoKey;
let publicKey: CryptoKey;

/**
 * Load RSA key-pair from PEM files specified by env vars.
 * Must be called once before signing / verifying.
 */
export async function loadKeys(): Promise<void> {
  const privatePath = process.env.JWT_PRIVATE_KEY_PATH;
  const publicPath = process.env.JWT_PUBLIC_KEY_PATH;

  if (!privatePath || !publicPath) {
    throw new Error(
      'JWT_PRIVATE_KEY_PATH and JWT_PUBLIC_KEY_PATH must be set',
    );
  }

  const [privPem, pubPem] = await Promise.all([
    readFile(privatePath, 'utf-8'),
    readFile(publicPath, 'utf-8'),
  ]);

  privateKey = await importPKCS8(privPem, ALGORITHM);
  publicKey = await importSPKI(pubPem, ALGORITHM);
}

/**
 * Sign a short-lived access token (15 minutes).
 */
export async function signAccessToken(userId: string): Promise<string> {
  const kid = process.env.JWT_KEY_ID || 'muxvo-auth-key-v1';

  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: ALGORITHM, kid })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);
}

/**
 * Verify an access token and return its payload.
 */
export async function verifyAccessToken(
  token: string,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: [ALGORITHM],
  });
  return payload;
}

/**
 * Generate a cryptographically random refresh token.
 *
 * Returns the plain-text value (sent to the client) and its SHA-256 hash
 * (stored in the database).
 */
export function generateRefreshToken(): { value: string; hash: string } {
  const value = randomUUID();
  const hash = createHash('sha256').update(value).digest('hex');
  return { value, hash };
}
