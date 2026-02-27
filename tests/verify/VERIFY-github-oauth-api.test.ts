/**
 * VERIFY: GitHub OAuth API Flow
 *
 * Tests the server-side OAuth endpoints directly:
 * 1. POST /auth/github/init returns valid authUrl with correct client_id and redirect_uri
 * 2. GET /auth/github/callback handles codes correctly
 * 3. GitHub actually accepts our redirect_uri (no "not associated" error)
 */
import { describe, test, expect } from 'vitest';

const SERVER_URL = 'http://localhost:3100';
const EXPECTED_CLIENT_ID = 'Ov23li9S2prPOvtgBXpg';
const EXPECTED_REDIRECT_URI = 'http://localhost:3100/auth/github/callback';

describe('VERIFY: GitHub OAuth API flow', () => {
  test('POST /auth/github/init returns valid authUrl', async () => {
    const res = await fetch(`${SERVER_URL}/auth/github/init`, { method: 'POST' });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.authUrl).toBeDefined();
    expect(data.state).toBeDefined();

    // Parse authUrl
    const url = new URL(data.authUrl);
    expect(url.hostname).toBe('github.com');
    expect(url.pathname).toBe('/login/oauth/authorize');

    // Check client_id matches our dev OAuth App
    expect(url.searchParams.get('client_id')).toBe(EXPECTED_CLIENT_ID);

    // Check redirect_uri matches
    expect(url.searchParams.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);

    // Check required OAuth params
    expect(url.searchParams.get('scope')).toContain('read:user');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('GitHub accepts our redirect_uri (no "not associated" error)', async () => {
    // Get authUrl from our server
    const initRes = await fetch(`${SERVER_URL}/auth/github/init`, { method: 'POST' });
    const { authUrl } = await initRes.json();

    // Request GitHub authorize page (like a browser would)
    const githubRes = await fetch(authUrl, { redirect: 'follow' });
    expect(githubRes.ok).toBe(true);

    const html = await githubRes.text();

    // Should NOT contain the "redirect_uri is not associated" error
    expect(html).not.toContain('is not associated with this application');
    expect(html).not.toContain('Be careful');

    // Should contain a login form or authorize form (meaning GitHub accepted our params)
    const hasLoginForm = html.includes('login') || html.includes('session');
    expect(hasLoginForm).toBe(true);
  });

  test('GET /auth/github/callback rejects without valid state', async () => {
    // Calling callback without valid code/state should fail gracefully
    const res = await fetch(`${SERVER_URL}/auth/github/callback?code=fake&state=fake`);
    // Should return an error (not crash)
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('Server health check is ok', async () => {
    const res = await fetch(`${SERVER_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
