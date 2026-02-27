/**
 * VERIFY: Full Auth Flow — End-to-End Automated
 *
 * Tests the ENTIRE auth infrastructure automatically:
 * 1. GitHub OAuth init → correct authUrl
 * 2. GitHub callback → error handling for invalid state
 * 3. Email login → full flow: send code → read from DB via server API → verify → get tokens
 * 4. Token usage → GET /user/me with access token
 * 5. Token refresh → POST /auth/refresh with refresh token
 * 6. Logout → POST /auth/logout revokes token
 */
import { describe, test, expect } from 'vitest';
import { execSync } from 'child_process';

const SERVER_URL = 'http://localhost:3100';
const EXPECTED_CLIENT_ID = 'Ov23li9S2prPOvtgBXpg';
const EXPECTED_REDIRECT_URI = 'http://localhost:3100/auth/github/callback';
const TEST_EMAIL = `test-${Date.now()}@muxvo.dev`;

// Read verification code from DB using docker exec psql
function getVerificationCodeFromDB(email: string): string {
  const result = execSync(
    `docker exec muxvo-dev-postgres psql -U muxvo -d muxvo_dev -t -A -c "SELECT code FROM email_verifications WHERE email = '${email}' AND verified_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1"`,
    { encoding: 'utf-8' },
  ).trim();
  return result;
}

// Clear rate limits using docker exec redis-cli
function clearRateLimits(email: string): void {
  execSync(
    `docker exec muxvo-dev-redis redis-cli DEL "rate:email:${email}" "rate:email:daily:${email}"`,
    { encoding: 'utf-8' },
  );
}

describe('VERIFY: GitHub OAuth API', () => {
  test('POST /auth/github/init returns correct authUrl', async () => {
    const res = await fetch(`${SERVER_URL}/auth/github/init`, { method: 'POST' });
    expect(res.ok).toBe(true);

    const data = await res.json();
    const url = new URL(data.authUrl);

    expect(url.hostname).toBe('github.com');
    expect(url.searchParams.get('client_id')).toBe(EXPECTED_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  test('GitHub callback rejects invalid state', async () => {
    const res = await fetch(`${SERVER_URL}/auth/github/callback?code=fake&state=fake`, {
      redirect: 'manual',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('VERIFY: Full Email Auth Flow (proves JWT + token + user infrastructure)', () => {
  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  test('Send email verification code', async () => {
    clearRateLimits(TEST_EMAIL);

    const res = await fetch(`${SERVER_URL}/auth/email/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL }),
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.expiresIn).toBe(300);
  });

  test('Verify email code and get tokens', async () => {
    const code = getVerificationCodeFromDB(TEST_EMAIL);
    expect(code).toBeDefined();
    expect(code).toMatch(/^\d{6}$/);

    const res = await fetch(`${SERVER_URL}/auth/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, code }),
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(TEST_EMAIL);

    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
    userId = data.user.id;
  });

  test('Access protected endpoint with token', async () => {
    const res = await fetch(`${SERVER_URL}/user/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.id).toBe(userId);
    expect(data.email).toBe(TEST_EMAIL);
  });

  test('Refresh token returns new token pair', async () => {
    const res = await fetch(`${SERVER_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();

    // Update tokens for subsequent tests
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
  });

  test('New access token still works', async () => {
    const res = await fetch(`${SERVER_URL}/user/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.ok).toBe(true);
  });

  test('Logout revokes refresh token', async () => {
    const res = await fetch(`${SERVER_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    expect(res.ok).toBe(true);

    // Revoked refresh token should fail
    const refreshRes = await fetch(`${SERVER_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    expect(refreshRes.ok).toBe(false);
  });
});

describe('VERIFY: Server health', () => {
  test('Health check returns ok', async () => {
    const res = await fetch(`${SERVER_URL}/health`);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
