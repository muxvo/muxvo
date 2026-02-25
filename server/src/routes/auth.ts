import type { FastifyPluginAsync } from 'fastify';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { redis } from '../db/redis.js';
import { query } from '../db/index.js';
import { findOrCreateUser } from '../services/user.js';
import {
  issueTokenPair,
  revokeRefreshToken,
  revokeAllUserTokens,
} from '../services/token.js';
import { AuthError, ValidationError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const APP_SCHEME = () => env('APP_SCHEME', 'muxvo');

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  return randomBytes(64).toString('hex');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Google JWKS (lazy singleton)
// ---------------------------------------------------------------------------

const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
let googleJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getGoogleJWKS() {
  if (!googleJWKS) {
    googleJWKS = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  }
  return googleJWKS;
}

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const emailSendSchema = {
  body: {
    type: 'object' as const,
    required: ['email'] as const,
    properties: {
      email: { type: 'string' as const, format: 'email' },
    },
  },
};

const emailVerifySchema = {
  body: {
    type: 'object' as const,
    required: ['email', 'code'] as const,
    properties: {
      email: { type: 'string' as const, format: 'email' },
      code: { type: 'string' as const, pattern: '^[0-9]{6}$' },
    },
  },
};

const refreshSchema = {
  body: {
    type: 'object' as const,
    required: ['refreshToken'] as const,
    properties: {
      refreshToken: { type: 'string' as const },
    },
  },
};

const logoutSchema = {
  body: {
    type: 'object' as const,
    required: ['refreshToken'] as const,
    properties: {
      refreshToken: { type: 'string' as const },
    },
  },
};

// ---------------------------------------------------------------------------
// Auth routes plugin
// ---------------------------------------------------------------------------

export const authRoutes: FastifyPluginAsync = async (app) => {
  // =========================================================================
  // GitHub OAuth
  // =========================================================================

  app.post('/github/init', async () => {
    const clientId = env('GITHUB_CLIENT_ID');
    const callbackUrl = env('GITHUB_CALLBACK_URL');

    const state = randomBytes(32).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Store in Redis with 10 minute TTL
    await redis.set(
      `oauth:state:${state}`,
      JSON.stringify({ codeVerifier, provider: 'github' }),
      'EX',
      600,
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: 'read:user user:email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

    return { authUrl, state };
  });

  app.get<{
    Querystring: { code?: string; state?: string };
  }>('/github/callback', async (request, reply) => {
    const { code, state } = request.query;

    if (!code || !state) {
      throw new ValidationError('Missing code or state parameter');
    }

    // Validate state from Redis
    const stateData = await redis.get(`oauth:state:${state}`);
    if (!stateData) {
      throw new AuthError('Invalid or expired OAuth state');
    }
    await redis.del(`oauth:state:${state}`);

    const { codeVerifier } = JSON.parse(stateData) as {
      codeVerifier: string;
      provider: string;
    };

    // Exchange code for access token
    const tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: env('GITHUB_CLIENT_ID'),
          client_secret: env('GITHUB_CLIENT_SECRET'),
          code,
          redirect_uri: env('GITHUB_CALLBACK_URL'),
          code_verifier: codeVerifier,
        }),
      },
    );

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      throw new AuthError(
        tokenData.error_description || 'Failed to exchange GitHub code for token',
      );
    }

    // Fetch GitHub user profile
    const profileResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!profileResponse.ok) {
      throw new AuthError('Failed to fetch GitHub user profile');
    }

    const profile = (await profileResponse.json()) as {
      id: number;
      login: string;
      name: string | null;
      email: string | null;
      avatar_url: string | null;
    };

    // If email is not public, fetch from emails endpoint
    let email = profile.email;
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email ?? null;
      }
    }

    // Find or create user
    const user = await findOrCreateUser({
      provider: 'github',
      providerId: String(profile.id),
      email,
      displayName: profile.name ?? profile.login,
      avatarUrl: profile.avatar_url,
      providerData: { login: profile.login, githubId: profile.id },
    });

    // Issue tokens
    const tokens = await issueTokenPair(user.id);

    // Redirect to app custom URL scheme
    const appScheme = APP_SCHEME();
    const redirectParams = new URLSearchParams({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });

    return reply.redirect(
      `${appScheme}://auth/callback?${redirectParams.toString()}`,
    );
  });

  // =========================================================================
  // Google OAuth
  // =========================================================================

  app.post('/google/init', async () => {
    const clientId = env('GOOGLE_CLIENT_ID');
    const callbackUrl = env('GOOGLE_CALLBACK_URL');

    const state = randomBytes(32).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Store in Redis with 10 minute TTL
    await redis.set(
      `oauth:state:${state}`,
      JSON.stringify({ codeVerifier, provider: 'google' }),
      'EX',
      600,
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return { authUrl, state };
  });

  app.get<{
    Querystring: { code?: string; state?: string };
  }>('/google/callback', async (request, reply) => {
    const { code, state } = request.query;

    if (!code || !state) {
      throw new ValidationError('Missing code or state parameter');
    }

    // Validate state from Redis
    const stateData = await redis.get(`oauth:state:${state}`);
    if (!stateData) {
      throw new AuthError('Invalid or expired OAuth state');
    }
    await redis.del(`oauth:state:${state}`);

    const { codeVerifier } = JSON.parse(stateData) as {
      codeVerifier: string;
      provider: string;
    };

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env('GOOGLE_CLIENT_ID'),
        client_secret: env('GOOGLE_CLIENT_SECRET'),
        code,
        redirect_uri: env('GOOGLE_CALLBACK_URL'),
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      id_token?: string;
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.id_token) {
      throw new AuthError(
        tokenData.error_description || 'Failed to exchange Google code for token',
      );
    }

    // Verify ID token using Google JWKS
    const { payload } = await jwtVerify(tokenData.id_token, getGoogleJWKS(), {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env('GOOGLE_CLIENT_ID'),
    });

    const googleId = payload.sub;
    if (!googleId) {
      throw new AuthError('Google ID token missing subject');
    }

    const email = payload.email as string | undefined;
    const name = payload.name as string | undefined;
    const picture = payload.picture as string | undefined;

    // Find or create user
    const user = await findOrCreateUser({
      provider: 'google',
      providerId: googleId,
      email: email ?? null,
      displayName: name ?? null,
      avatarUrl: picture ?? null,
      providerData: { googleId, email, name, picture },
    });

    // Issue tokens
    const tokens = await issueTokenPair(user.id);

    // Redirect to app custom URL scheme
    const appScheme = APP_SCHEME();
    const redirectParams = new URLSearchParams({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });

    return reply.redirect(
      `${appScheme}://auth/callback?${redirectParams.toString()}`,
    );
  });

  // =========================================================================
  // Email + Code
  // =========================================================================

  app.post<{
    Body: { email: string };
  }>('/email/send', { schema: emailSendSchema }, async (request) => {
    const { email } = request.body;

    // Rate limit: 1 per minute per email
    const minuteKey = `rate:email:${email}`;
    const minuteCount = await redis.incr(minuteKey);
    if (minuteCount === 1) {
      await redis.expire(minuteKey, 60);
    }
    if (minuteCount > 1) {
      throw new ValidationError(
        'Please wait at least 1 minute before requesting a new code',
      );
    }

    // Rate limit: 10 per day per email
    const dailyKey = `rate:email:daily:${email}`;
    const dailyCount = await redis.incr(dailyKey);
    if (dailyCount === 1) {
      await redis.expire(dailyKey, 86400);
    }
    if (dailyCount > 10) {
      throw new ValidationError('Daily email verification limit exceeded');
    }

    // Invalidate previous codes for same email
    await query(
      `UPDATE email_verifications
       SET verified_at = NOW()
       WHERE email = $1 AND verified_at IS NULL`,
      [email],
    );

    // Generate 6-digit code
    const code = String(randomInt(100000, 999999));

    // Insert verification record (expires in 5 minutes)
    await query(
      `INSERT INTO email_verifications (email, code, purpose, expires_at)
       VALUES ($1, $2, 'login', NOW() + INTERVAL '5 minutes')`,
      [email, code],
    );

    // TODO: Send email - placeholder for now
    request.log.info({ email, code }, '[auth] Email verification code generated');

    return { success: true, expiresIn: 300 };
  });

  app.post<{
    Body: { email: string; code: string };
  }>('/email/verify', { schema: emailVerifySchema }, async (request) => {
    const { email, code } = request.body;

    // Look up matching non-expired, non-verified code
    const result = await query<{
      id: string;
      code: string;
      attempts: number;
    }>(
      `SELECT id, code, attempts
       FROM email_verifications
       WHERE email = $1
         AND verified_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [email],
    );

    if (result.rows.length === 0) {
      throw new AuthError('No valid verification code found');
    }

    const record = result.rows[0];

    // Check attempts limit
    if (record.attempts >= 5) {
      throw new AuthError('Too many verification attempts');
    }

    // Check code match
    if (record.code !== code) {
      // Increment attempts
      await query(
        `UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1`,
        [record.id],
      );
      throw new AuthError('Invalid verification code');
    }

    // Mark as verified
    await query(
      `UPDATE email_verifications SET verified_at = NOW() WHERE id = $1`,
      [record.id],
    );

    // Find or create user
    const user = await findOrCreateUser({
      provider: 'email',
      providerId: email,
      email,
      displayName: null,
      avatarUrl: null,
    });

    // Issue tokens
    const tokens = await issueTokenPair(user.id);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
        avatarUrl: user.avatar_url,
        role: user.role,
      },
    };
  });

  // =========================================================================
  // Token refresh (with rotation detection)
  // =========================================================================

  app.post<{
    Body: { refreshToken: string };
  }>('/refresh', { schema: refreshSchema }, async (request) => {
    const { refreshToken } = request.body;
    const tokenHash = hashRefreshToken(refreshToken);

    // Look up the token
    const result = await query<{
      id: string;
      user_id: string;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, user_id, revoked_at, expires_at
       FROM refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      throw new AuthError('Invalid refresh token');
    }

    const record = result.rows[0];

    // Token rotation detection: if token was already revoked, this is reuse
    // Revoke ALL user tokens as a security measure
    if (record.revoked_at !== null) {
      await revokeAllUserTokens(record.user_id);
      throw new AuthError('Refresh token reuse detected — all sessions revoked');
    }

    // Check expiration
    if (new Date(record.expires_at) < new Date()) {
      throw new AuthError('Refresh token expired');
    }

    // Revoke old token
    await revokeRefreshToken(tokenHash);

    // Issue new pair
    const tokens = await issueTokenPair(record.user_id);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  });

  // =========================================================================
  // Logout
  // =========================================================================

  app.post<{
    Body: { refreshToken: string };
  }>('/logout', { schema: logoutSchema }, async (request) => {
    const { refreshToken } = request.body;
    const tokenHash = hashRefreshToken(refreshToken);

    await revokeRefreshToken(tokenHash);

    return { success: true };
  });
};
