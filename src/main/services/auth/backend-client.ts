/**
 * Backend Auth Client
 *
 * Encapsulates HTTP calls to the Muxvo backend API (api.muxvo.com).
 * All methods return structured responses; callers handle state machine transitions.
 */

export interface BackendTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface BackendUser {
  id: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
}

export interface AuthInitResponse {
  authUrl: string;
  state: string;
}

export interface EmailSendResponse {
  success: boolean;
  expiresIn: number;
}

export interface EmailVerifyResponse extends BackendTokenPair {
  user: BackendUser;
}

export interface RefreshResponse extends BackendTokenPair {}

export interface BackendClientOptions {
  baseUrl: string;
  timeout?: number;
}

export function createBackendClient(options: BackendClientOptions) {
  const { baseUrl, timeout = 15000 } = options;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const msg = (body as Record<string, string>).message || response.statusText;
        throw new Error(`API error ${response.status}: ${msg}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** Initialize GitHub OAuth flow — returns authUrl for browser open */
    async initGithubAuth(): Promise<AuthInitResponse> {
      return request<AuthInitResponse>('/auth/github/init', { method: 'POST' });
    },

    /** Initialize Google OAuth flow — returns authUrl for browser open */
    async initGoogleAuth(): Promise<AuthInitResponse> {
      return request<AuthInitResponse>('/auth/google/init', { method: 'POST' });
    },

    /** Send email verification code */
    async sendEmailCode(email: string): Promise<EmailSendResponse> {
      return request<EmailSendResponse>('/auth/email/send', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    },

    /** Verify email code and get tokens */
    async verifyEmailCode(email: string, code: string): Promise<EmailVerifyResponse> {
      return request<EmailVerifyResponse>('/auth/email/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      });
    },

    /** Refresh access token using refresh token (rotation) */
    async refreshToken(refreshToken: string): Promise<RefreshResponse> {
      return request<RefreshResponse>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    },

    /** Logout — revoke refresh token on server */
    async logout(refreshToken: string): Promise<{ success: boolean }> {
      return request<{ success: boolean }>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    },

    /** Get user profile (requires access token) */
    async getUserProfile(accessToken: string): Promise<BackendUser> {
      return request<BackendUser>('/user/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    },
  };
}
