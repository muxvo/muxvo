import { readFile, stat, writeFile, rm, mkdir } from 'node:fs/promises';
import { createHash, randomUUID, generateKeyPairSync } from 'node:crypto';
import { dirname } from 'node:path';
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

const ALGORITHM = 'RS256';
const ISSUER = 'https://api.muxvo.com';
const AUDIENCE = 'muxvo-app';

let privateKey: CryptoKey;
let publicKey: CryptoKey;

/**
 * Ensure JWT key files exist. If missing or corrupted (e.g. Docker created
 * empty directories instead of files), auto-generate a new RSA 2048 key pair.
 */
async function ensureKeyFiles(privatePath: string, publicPath: string): Promise<void> {
  // Clean up any directories that Docker may have created in place of files
  for (const p of [privatePath, publicPath]) {
    try {
      const s = await stat(p);
      if (s.isDirectory()) await rm(p, { recursive: true });
    } catch { /* not found — will generate below */ }
  }

  const [privOk, pubOk] = await Promise.all([
    stat(privatePath).then((s) => s.isFile()).catch(() => false),
    stat(publicPath).then((s) => s.isFile()).catch(() => false),
  ]);

  if (privOk && pubOk) return;

  console.warn('[jwt] Key files missing or invalid, generating new RSA 2048 key pair...');
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Ensure parent directories exist
  await mkdir(dirname(privatePath), { recursive: true });
  await mkdir(dirname(publicPath), { recursive: true });

  await writeFile(privatePath, pair.privateKey as string, 'utf-8');
  await writeFile(publicPath, pair.publicKey as string, 'utf-8');
  console.warn('[jwt] New key pair written to', privatePath, publicPath);
}

/**
 * Load RSA key-pair from PEM files specified by env vars.
 * Auto-generates keys if files are missing or corrupted.
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

  await ensureKeyFiles(privatePath, publicPath);

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
