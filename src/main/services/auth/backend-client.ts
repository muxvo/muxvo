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

const ERROR_MESSAGE_MAP: Record<string, string> = {
  'Invalid email or password': '邮箱或密码错误',
  'Invalid verification code': '验证码无效或已过期',
  'Email already registered': '该邮箱已注册',
  'Invalid or expired OAuth state': '登录已过期，请重试',
  'Invalid refresh token': '登录已过期，请重新登录',
  'Refresh token expired': '登录已过期，请重新登录',
};

export function createBackendClient(options: BackendClientOptions) {
  const { baseUrl, timeout = 15000 } = options;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = { ...init?.headers as Record<string, string> };
      // Only set Content-Type when there's a body (Fastify rejects empty JSON body)
      if (init?.body) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      }

      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const msg = (body as Record<string, string>).message || response.statusText;
        const friendly = ERROR_MESSAGE_MAP[msg];
        throw new Error(friendly || `API error ${response.status}: ${msg}`);
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
    async sendEmailCode(email: string, purpose?: string): Promise<EmailSendResponse> {
      return request<EmailSendResponse>('/auth/email/send', {
        method: 'POST',
        body: JSON.stringify({ email, ...(purpose ? { purpose } : {}) }),
      });
    },

    /** Verify email code and get tokens */
    async verifyEmailCode(email: string, code: string): Promise<EmailVerifyResponse> {
      return request<EmailVerifyResponse>('/auth/email/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      });
    },

    /** Register with email + code + password */
    async register(email: string, code: string, password: string): Promise<EmailVerifyResponse> {
      return request<EmailVerifyResponse>('/auth/password/register', {
        method: 'POST',
        body: JSON.stringify({ email, code, password }),
      });
    },

    /** Login with email + password */
    async loginPassword(email: string, password: string): Promise<EmailVerifyResponse> {
      return request<EmailVerifyResponse>('/auth/password/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },

    /** Reset password with email + code + newPassword */
    async resetPassword(email: string, code: string, newPassword: string): Promise<{ success: boolean }> {
      return request<{ success: boolean }>('/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ email, code, newPassword }),
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

    /** Poll for OAuth completion (for dev mode where deep links don't work) */
    async pollOAuthResult(state: string): Promise<{ pending: boolean; accessToken?: string; refreshToken?: string }> {
      return request<{ pending: boolean; accessToken?: string; refreshToken?: string }>(`/auth/poll?state=${encodeURIComponent(state)}`);
    },

    /** Get user profile (requires access token) */
    async getUserProfile(accessToken: string): Promise<BackendUser> {
      return request<BackendUser>('/user/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    },

    /** Track analytics events (batch). accessToken is optional for anonymous reporting. */
    async trackAnalytics(
      deviceId: string,
      events: Array<{ metric: string; value?: number; metadata?: object }>,
      accessToken?: string,
    ): Promise<{ success: boolean }> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId,
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${baseUrl}/analytics/track`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ events }),
          signal: controller.signal,
        });

        if (!response.ok) return { success: false };
        return { success: true };
      } catch {
        return { success: false };
      } finally {
        clearTimeout(timer);
      }
    },

    /** Send device heartbeat to register/update device info */
    async deviceHeartbeat(
      deviceId: string,
      info: { platform: string; arch: string; os_version: string; app_version: string; hostname: string },
      accessToken?: string,
      previousDeviceId?: string | null,
    ): Promise<{ device_id: string; status: string } | null> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Device-ID': deviceId,
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const body: Record<string, unknown> = { ...info };
      if (previousDeviceId) {
        body.previous_device_id = previousDeviceId;
      }

      try {
        const response = await fetch(`${baseUrl}/devices/heartbeat`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) return null;
        return (await response.json()) as { device_id: string; status: string };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
