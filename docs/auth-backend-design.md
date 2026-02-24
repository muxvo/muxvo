# Muxvo 登录系统 — 后端架构设计

> 版本: v1.0 | 日期: 2026-02-24

---

## 目录

1. [总体架构概览](#1-总体架构概览)
2. [服务器部署方案](#2-服务器部署方案)
3. [数据库设计](#3-数据库设计)
4. [三种认证流程的后端实现](#4-三种认证流程的后端实现)
5. [Token 管理方案](#5-token-管理方案)
6. [API 接口设计](#6-api-接口设计)
7. [安全方案](#7-安全方案)
8. [部署与运维](#8-部署与运维)

---

## 1. 总体架构概览

### 1.1 系统架构图

```
┌─────────────────────┐
│  Muxvo Electron App │
│  (桌面客户端)         │
│                     │
│  auth-handlers.ts   │──── HTTPS ────┐
│  token-storage.ts   │               │
└─────────────────────┘               ▼
                              ┌──────────────────┐
                              │   Nginx (反向代理) │
                              │   SSL 终结         │
                              │   Rate Limiting    │
                              └────────┬───────────┘
                                       │
                              ┌────────▼───────────┐
                              │  Fastify 后端服务    │
                              │  (Node.js)          │
                              │                     │
                              │  /auth/github/*     │
                              │  /auth/google/*     │
                              │  /auth/email/*      │
                              │  /auth/token/*      │
                              │  /user/*            │
                              └──┬─────┬────────┬───┘
                                 │     │        │
                    ┌────────────┘     │        └────────────┐
                    ▼                  ▼                     ▼
            ┌──────────────┐  ┌──────────────┐      ┌──────────────┐
            │  PostgreSQL  │  │    Redis      │      │  邮件服务     │
            │  (用户数据)   │  │  (会话/验证码) │      │  (阿里云)     │
            └──────────────┘  └──────────────┘      └──────────────┘
```

### 1.2 核心设计原则

- **无状态服务**: 后端服务本身无状态，所有会话数据存 Redis，便于水平扩展
- **统一身份**: 三种登录方式（GitHub / Google / 邮箱）最终映射到同一 `users` 表
- **双 Token**: Access Token (短期) + Refresh Token (长期) 分离
- **安全优先**: OAuth PKCE、HTTPS 强制、Rate Limiting、输入验证

---

## 2. 服务器部署方案

### 2.1 计算资源选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 阿里云 ECS | 完全可控，配置灵活，长期运行成本可预测 | 需要自行维护 OS 和中间件 | **推荐** |
| 函数计算 FC | 按调用付费，无需运维 | 冷启动延迟，WebSocket 不友好，调试困难 | 不推荐 |
| 容器服务 ACK | 弹性伸缩，容器化标准 | 认证服务流量初期不大，K8s 运维成本过高 | 过度设计 |

**推荐方案: 阿里云 ECS**

理由:
1. 认证服务是长驻进程，需要稳定的数据库连接池和 Redis 连接
2. Muxvo 是桌面应用，初期用户量可预期，ECS 2核4G 即可满足
3. 后续如需扩展，可在 ECS 上用 Docker Compose 部署，平滑过渡到容器化

**推荐配置:**

```
初期: ECS 计算型 c7 / 2vCPU 4GiB / 40GB ESSD / CentOS Stream 9 or Ubuntu 22.04
数据库: 同机部署 PostgreSQL (初期) → 后期迁移到 RDS
Redis: 同机部署 (初期) → 后期迁移到阿里云 Redis 版
```

### 2.2 后端框架选型

| 框架 | 性能 | 生态 | TypeScript 支持 | 结论 |
|------|------|------|----------------|------|
| Fastify | 极高 (接近原生 HTTP) | 丰富插件生态 | 一流 (内置 TS 类型) | **推荐** |
| Nest.js | 中等 | 企业级完整方案 | 一流 (装饰器) | 过度设计 |
| Express | 中等 | 最大社区 | 需额外配置 | 过于简单 |

**推荐: Fastify v5**

理由:
1. Muxvo 前端已用 TypeScript，Fastify 的 TypeScript 支持最好
2. 内置 JSON Schema 验证，无需额外引入 joi/zod
3. 插件系统优秀: `@fastify/cors`, `@fastify/rate-limit`, `@fastify/jwt` 等开箱即用
4. 性能优异，适合认证场景的高并发短请求

### 2.3 反向代理 & HTTPS

```nginx
# /etc/nginx/conf.d/muxvo-auth.conf

upstream muxvo_auth {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name auth.muxvo.com;

    # 阿里云免费 SSL 证书 或 Let's Encrypt
    ssl_certificate     /etc/nginx/ssl/auth.muxvo.com.pem;
    ssl_certificate_key /etc/nginx/ssl/auth.muxvo.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 安全头
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    location /api/ {
        proxy_pass http://muxvo_auth/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Nginx 层 Rate Limiting
        limit_req zone=auth_api burst=20 nodelay;
    }
}

# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name auth.muxvo.com;
    return 301 https://$server_name$request_uri;
}

# Rate Limit 区域定义 (放在 http 块)
# limit_req_zone $binary_remote_addr zone=auth_api:10m rate=10r/s;
```

**SSL 证书方案:**
- 推荐阿里云免费 SSL 证书（DigiCert DV 单域名，自动续期）
- 备选: Let's Encrypt + certbot 自动续期

---

## 3. 数据库设计

### 3.1 数据库选型

**推荐: PostgreSQL 16**

理由:
1. 强类型约束，适合存储用户敏感数据
2. 原生 JSON/JSONB 支持，方便存储 OAuth 返回的用户 profile
3. 与 Fastify 生态配合好 (`@fastify/postgres`, `pg` 驱动成熟)
4. 阿里云 RDS for PostgreSQL 支持完善，后续迁移无缝

### 3.2 表结构设计

#### users 表 — 核心用户表

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  VARCHAR(100),
    avatar_url    TEXT,
    email         VARCHAR(255) UNIQUE,          -- 可为空 (GitHub 无公开邮箱时)
    email_verified BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    status        VARCHAR(20) DEFAULT 'active'  -- active / suspended / deleted
);

CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_status ON users(status);
```

#### user_identities 表 — 多登录方式绑定

```sql
CREATE TABLE user_identities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      VARCHAR(20) NOT NULL,          -- 'github' | 'google' | 'email'
    provider_id   VARCHAR(255) NOT NULL,          -- GitHub user id / Google sub / 邮箱地址
    provider_data JSONB DEFAULT '{}',             -- 存储 OAuth profile 原始数据
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(provider, provider_id)
);

CREATE INDEX idx_identities_user ON user_identities(user_id);
CREATE INDEX idx_identities_provider ON user_identities(provider, provider_id);
```

#### refresh_tokens 表 — Refresh Token 持久化

```sql
CREATE TABLE refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    VARCHAR(128) NOT NULL UNIQUE,   -- SHA-256 hash，不存原文
    device_info   VARCHAR(255),                    -- 设备标识 (OS + app version)
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ                      -- 非空则已撤销
);

CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_expires ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;
```

#### email_verifications 表 — 邮箱验证码

```sql
CREATE TABLE email_verifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL,
    code          VARCHAR(6) NOT NULL,             -- 6 位数字验证码
    purpose       VARCHAR(20) DEFAULT 'login',     -- login / bind
    attempts      INT DEFAULT 0,                   -- 已尝试次数
    max_attempts  INT DEFAULT 5,                   -- 最大尝试次数
    expires_at    TIMESTAMPTZ NOT NULL,             -- 过期时间
    verified_at   TIMESTAMPTZ,                     -- 验证成功时间
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_verify_lookup ON email_verifications(email, code)
    WHERE verified_at IS NULL;
CREATE INDEX idx_email_verify_expires ON email_verifications(expires_at);
```

### 3.3 Redis 数据结构

```
# Rate Limiting — 验证码发送频率
rate:email:{email}        → counter  TTL=60s    (每分钟 1 次)
rate:email:daily:{email}  → counter  TTL=86400s (每日 10 次)

# Rate Limiting — 登录尝试
rate:login:{ip}           → counter  TTL=900s   (15 分钟内 10 次)

# OAuth State 防 CSRF
oauth:state:{state}       → JSON{provider,codeVerifier,redirectUri}  TTL=600s

# Active Access Token (用于主动撤销检查，可选)
token:blacklist:{jti}     → "1"  TTL=与 AT 剩余过期时间一致
```

---

## 4. 三种认证流程的后端实现

### 4.1 GitHub OAuth

#### 4.1.1 GitHub OAuth App 配置

```
GitHub Settings → Developer settings → OAuth Apps → New OAuth App

Application name:  Muxvo
Homepage URL:      https://muxvo.com
Authorization callback URL: https://auth.muxvo.com/api/auth/github/callback
```

> 注意: 桌面应用使用 PKCE 流程时，redirect_uri 也可以用自定义协议 `muxvo://auth/callback`，
> 但推荐走后端回调 URL 以统一处理。

#### 4.1.2 授权流程

```
Electron                          后端                          GitHub
   │                               │                              │
   │  1. GET /auth/github/init     │                              │
   │  ─────────────────────────►   │                              │
   │                               │  生成 state + PKCE           │
   │                               │  存入 Redis                  │
   │  2. 返回 {authUrl, state}     │                              │
   │  ◄─────────────────────────   │                              │
   │                               │                              │
   │  3. 打开系统浏览器 → authUrl   │                              │
   │  ─────────────────────────────────────────────────────────►  │
   │                               │                              │
   │                               │  4. GitHub 回调               │
   │                               │  GET /auth/github/callback   │
   │                               │  ?code=xxx&state=yyy         │
   │                               │  ◄────────────────────────── │
   │                               │                              │
   │                               │  5. POST /login/oauth/access_token
   │                               │  ─────────────────────────►  │
   │                               │                              │
   │                               │  6. 返回 access_token        │
   │                               │  ◄────────────────────────── │
   │                               │                              │
   │                               │  7. GET /user (Bearer token) │
   │                               │  ─────────────────────────►  │
   │                               │                              │
   │                               │  8. 返回用户信息              │
   │                               │  ◄────────────────────────── │
   │                               │                              │
   │                               │  9. 查询/创建本地用户         │
   │                               │  签发 JWT Token pair         │
   │                               │                              │
   │  10. 重定向 muxvo://auth/     │                              │
   │      success?token=...        │                              │
   │  ◄─────────────────────────   │                              │
```

#### 4.1.3 后端关键代码 (伪代码)

```typescript
// routes/auth/github.ts

// Step 1: 初始化 OAuth
fastify.get('/auth/github/init', async (request, reply) => {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // 存入 Redis，10 分钟过期
  await redis.setex(`oauth:state:${state}`, 600, JSON.stringify({
    provider: 'github',
    codeVerifier,
  }));

  const authUrl = `https://github.com/login/oauth/authorize?` +
    `client_id=${GITHUB_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(GITHUB_CALLBACK_URL)}` +
    `&scope=read:user user:email` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  return { authUrl, state };
});

// Step 4-9: 回调处理
fastify.get('/auth/github/callback', async (request, reply) => {
  const { code, state } = request.query;

  // 验证 state
  const stored = await redis.get(`oauth:state:${state}`);
  if (!stored) throw new AuthError('INVALID_STATE', 'OAuth state 无效或已过期');
  const { codeVerifier } = JSON.parse(stored);
  await redis.del(`oauth:state:${state}`);

  // 换取 access_token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
    }),
  });
  const { access_token } = await tokenRes.json();

  // 获取 GitHub 用户信息
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const ghUser = await userRes.json();

  // 获取邮箱 (可能需要额外请求)
  const emailRes = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const emails = await emailRes.json();
  const primaryEmail = emails.find(e => e.primary && e.verified)?.email;

  // 查询或创建本地用户
  const user = await findOrCreateUser({
    provider: 'github',
    providerId: String(ghUser.id),
    email: primaryEmail,
    displayName: ghUser.name || ghUser.login,
    avatarUrl: ghUser.avatar_url,
    providerData: ghUser,
  });

  // 签发 Token pair
  const tokens = await issueTokenPair(user.id, request);

  // 重定向回 Electron 应用
  const redirectUrl = `muxvo://auth/success?` +
    `accessToken=${tokens.accessToken}` +
    `&refreshToken=${tokens.refreshToken}`;
  reply.redirect(redirectUrl);
});
```

### 4.2 Google OAuth

#### 4.2.1 Google Cloud Console 配置

```
Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client

Application type: Desktop app (或 Web application)
Name: Muxvo
Authorized redirect URIs: https://auth.muxvo.com/api/auth/google/callback
```

需要启用的 API: Google People API (获取用户信息)

#### 4.2.2 授权流程

流程与 GitHub 类似，关键差异:

1. **授权端点**: `https://accounts.google.com/o/oauth2/v2/auth`
2. **Token 端点**: `https://oauth2.googleapis.com/token`
3. **Google 返回 ID Token (JWT)**: 可直接解析获取用户信息，无需额外 API 调用
4. **Scope**: `openid email profile`

```typescript
// routes/auth/google.ts

fastify.get('/auth/google/init', async (request, reply) => {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const nonce = crypto.randomUUID();

  await redis.setex(`oauth:state:${state}`, 600, JSON.stringify({
    provider: 'google',
    codeVerifier,
    nonce,
  }));

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(GOOGLE_CALLBACK_URL)}` +
    `&response_type=code` +
    `&scope=openid email profile` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256` +
    `&nonce=${nonce}`;

  return { authUrl, state };
});

fastify.get('/auth/google/callback', async (request, reply) => {
  const { code, state } = request.query;

  const stored = await redis.get(`oauth:state:${state}`);
  if (!stored) throw new AuthError('INVALID_STATE', 'OAuth state 无效或已过期');
  const { codeVerifier, nonce } = JSON.parse(stored);
  await redis.del(`oauth:state:${state}`);

  // 换取 tokens (Google 返回 id_token + access_token)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  const { id_token } = await tokenRes.json();

  // 验证 ID Token
  const payload = await verifyGoogleIdToken(id_token, GOOGLE_CLIENT_ID);

  // 验证 nonce
  if (payload.nonce !== nonce) {
    throw new AuthError('INVALID_NONCE', 'Nonce 不匹配');
  }

  // payload 包含: sub, email, email_verified, name, picture
  const user = await findOrCreateUser({
    provider: 'google',
    providerId: payload.sub,
    email: payload.email,
    displayName: payload.name,
    avatarUrl: payload.picture,
    providerData: payload,
  });

  const tokens = await issueTokenPair(user.id, request);

  reply.redirect(`muxvo://auth/success?` +
    `accessToken=${tokens.accessToken}` +
    `&refreshToken=${tokens.refreshToken}`);
});
```

#### 4.2.3 Google ID Token 验证

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
);

async function verifyGoogleIdToken(
  idToken: string,
  clientId: string
): Promise<GoogleIdTokenPayload> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  });
  return payload as GoogleIdTokenPayload;
}
```

### 4.3 邮箱验证码登录

#### 4.3.1 邮件发送服务选型

| 服务 | 价格 | 特点 | 结论 |
|------|------|------|------|
| 阿里云邮件推送 | 免费额度 2000/日 | 与阿里云生态集成 | **推荐** |
| SendGrid | 免费 100/日 | 国际知名，到达率高 | 备选 |
| 自建 SMTP | 免费 | 容易进垃圾箱 | 不推荐 |

**推荐: 阿里云邮件推送 (DirectMail)**

理由: 与部署环境同生态，免费额度足够初期使用，国内邮箱投递率高。

#### 4.3.2 验证码流程

```
Electron                          后端                          邮件服务
   │                               │                              │
   │  1. POST /auth/email/send     │                              │
   │     {email}                   │                              │
   │  ─────────────────────────►   │                              │
   │                               │  2. Rate Limit 检查           │
   │                               │  3. 生成 6 位随机验证码       │
   │                               │  4. 存入 DB (5 分钟过期)      │
   │                               │                              │
   │                               │  5. 发送验证码邮件            │
   │                               │  ─────────────────────────►  │
   │                               │                              │
   │  6. 返回 {success, expiresIn} │                              │
   │  ◄─────────────────────────   │                              │
   │                               │                              │
   │  7. POST /auth/email/verify   │                              │
   │     {email, code}             │                              │
   │  ─────────────────────────►   │                              │
   │                               │  8. 验证码匹配 + 未过期检查   │
   │                               │  9. 查询/创建用户             │
   │                               │  10. 签发 Token pair          │
   │                               │                              │
   │  11. 返回 {accessToken,       │                              │
   │       refreshToken, user}     │                              │
   │  ◄─────────────────────────   │                              │
```

#### 4.3.3 后端关键代码 (伪代码)

```typescript
// routes/auth/email.ts

// 发送验证码
fastify.post('/auth/email/send', {
  schema: {
    body: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email', maxLength: 255 },
      },
    },
  },
}, async (request, reply) => {
  const { email } = request.body;

  // Rate Limiting: 同一邮箱 60 秒内只能发 1 次
  const minuteKey = `rate:email:${email}`;
  const minuteCount = await redis.incr(minuteKey);
  if (minuteCount === 1) await redis.expire(minuteKey, 60);
  if (minuteCount > 1) {
    throw new AuthError('RATE_LIMITED', '发送过于频繁，请 60 秒后重试', 429);
  }

  // Rate Limiting: 同一邮箱每日最多 10 次
  const dailyKey = `rate:email:daily:${email}`;
  const dailyCount = await redis.incr(dailyKey);
  if (dailyCount === 1) await redis.expire(dailyKey, 86400);
  if (dailyCount > 10) {
    throw new AuthError('RATE_LIMITED', '今日发送次数已达上限', 429);
  }

  // 生成 6 位数字验证码
  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 分钟

  // 使之前未验证的验证码失效 (同邮箱)
  await db.query(
    `UPDATE email_verifications SET verified_at = NOW()
     WHERE email = $1 AND verified_at IS NULL`,
    [email]
  );

  // 存储新验证码
  await db.query(
    `INSERT INTO email_verifications (email, code, expires_at)
     VALUES ($1, $2, $3)`,
    [email, code, expiresAt]
  );

  // 发送邮件
  await sendVerificationEmail(email, code);

  return { success: true, expiresIn: 300 };
});

// 验证码验证 + 登录
fastify.post('/auth/email/verify', {
  schema: {
    body: {
      type: 'object',
      required: ['email', 'code'],
      properties: {
        email: { type: 'string', format: 'email' },
        code: { type: 'string', pattern: '^[0-9]{6}$' },
      },
    },
  },
}, async (request, reply) => {
  const { email, code } = request.body;

  // 查找未过期、未验证的验证码
  const result = await db.query(
    `SELECT id, attempts, max_attempts, expires_at
     FROM email_verifications
     WHERE email = $1 AND code = $2
       AND verified_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email, code]
  );

  if (result.rows.length === 0) {
    // 尝试次数 +1 (防暴力猜测)
    await db.query(
      `UPDATE email_verifications
       SET attempts = attempts + 1
       WHERE email = $1 AND verified_at IS NULL AND expires_at > NOW()`,
      [email]
    );
    throw new AuthError('INVALID_CODE', '验证码无效或已过期');
  }

  const record = result.rows[0];
  if (record.attempts >= record.max_attempts) {
    throw new AuthError('TOO_MANY_ATTEMPTS', '验证码尝试次数过多，请重新获取');
  }

  // 标记验证码已使用
  await db.query(
    `UPDATE email_verifications SET verified_at = NOW() WHERE id = $1`,
    [record.id]
  );

  // 查询或创建用户
  const user = await findOrCreateUser({
    provider: 'email',
    providerId: email,
    email,
    displayName: email.split('@')[0],
    avatarUrl: null,
    providerData: {},
  });

  // 签发 Token pair
  const tokens = await issueTokenPair(user.id, request);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: {
      id: user.id,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      email: user.email,
    },
  };
});
```

#### 4.3.4 邮件发送 (阿里云 DirectMail)

```typescript
// services/email.ts
import { createClient } from '@alicloud/dm20151123';

const client = createClient({
  accessKeyId: process.env.ALIYUN_AK_ID,
  accessKeySecret: process.env.ALIYUN_AK_SECRET,
  endpoint: 'dm.aliyuncs.com',
});

async function sendVerificationEmail(email: string, code: string) {
  await client.singleSendMail({
    accountName: 'noreply@mail.muxvo.com',
    addressType: 1,
    replyToAddress: false,
    toAddress: email,
    subject: `Muxvo 登录验证码: ${code}`,
    htmlBody: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2>Muxvo 登录验证</h2>
        <p>您的验证码是:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px;
                    padding: 16px; background: #f5f5f5; text-align: center;
                    border-radius: 8px; margin: 16px 0;">
          ${code}
        </div>
        <p style="color: #666;">验证码 5 分钟内有效，请勿分享给他人。</p>
        <p style="color: #999; font-size: 12px;">如果这不是您的操作，请忽略此邮件。</p>
      </div>
    `,
  });
}
```

### 4.4 统一用户查询/创建逻辑

```typescript
// services/user.ts

interface FindOrCreateParams {
  provider: 'github' | 'google' | 'email';
  providerId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  providerData: Record<string, unknown>;
}

async function findOrCreateUser(params: FindOrCreateParams) {
  const { provider, providerId, email, displayName, avatarUrl, providerData } = params;

  // 1. 先查 identity 表: 是否已绑定过
  const existing = await db.query(
    `SELECT u.* FROM user_identities i
     JOIN users u ON i.user_id = u.id
     WHERE i.provider = $1 AND i.provider_id = $2`,
    [provider, providerId]
  );

  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    // 更新最近登录时间和 provider_data
    await db.query(
      `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [user.id]
    );
    await db.query(
      `UPDATE user_identities SET provider_data = $1, updated_at = NOW()
       WHERE provider = $2 AND provider_id = $3`,
      [JSON.stringify(providerData), provider, providerId]
    );
    return user;
  }

  // 2. 通过邮箱查找已有用户 (支持多登录方式绑定同一账号)
  let user = null;
  if (email) {
    const emailUser = await db.query(
      `SELECT * FROM users WHERE email = $1 AND status = 'active'`,
      [email]
    );
    if (emailUser.rows.length > 0) {
      user = emailUser.rows[0];
    }
  }

  // 3. 没有匹配到已有用户，创建新用户
  if (!user) {
    const newUser = await db.query(
      `INSERT INTO users (display_name, avatar_url, email, email_verified, last_login_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [displayName, avatarUrl, email, provider !== 'email' ? false : true]
    );
    user = newUser.rows[0];
  }

  // 4. 创建 identity 关联
  await db.query(
    `INSERT INTO user_identities (user_id, provider, provider_id, provider_data)
     VALUES ($1, $2, $3, $4)`,
    [user.id, provider, providerId, JSON.stringify(providerData)]
  );

  // 更新最近登录时间
  await db.query(
    `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [user.id]
  );

  return user;
}
```

---

## 5. Token 管理方案

### 5.1 选型: JWT + Refresh Token

**选择 JWT 而非 Session 的理由:**

1. **Muxvo 是桌面应用**: 没有浏览器 cookie 机制，JWT 通过 Authorization header 传递更自然
2. **无状态验证**: Access Token 在后端无需查库验证，降低延迟
3. **易于扩展**: 后续如果有 Web 端或移动端，JWT 天然跨平台

### 5.2 双 Token 方案

| Token | 有效期 | 存储位置 | 用途 |
|-------|--------|----------|------|
| Access Token (AT) | 15 分钟 | Electron 内存 (变量) | API 请求鉴权 |
| Refresh Token (RT) | 30 天 | Electron safeStorage (系统钥匙串) | 刷新 AT |

### 5.3 JWT 签名配置

```typescript
// config/jwt.ts

export const JWT_CONFIG = {
  // 签名算法: RS256 (非对称，公钥可分发给微服务验证)
  algorithm: 'RS256' as const,

  // Access Token
  accessToken: {
    expiresIn: '15m',
  },

  // Refresh Token
  refreshToken: {
    expiresIn: '30d',
  },
};
```

**为什么选 RS256 而非 HS256:**
- RS256 使用 RSA 公私钥对，私钥仅后端持有，公钥可安全分发
- 未来如有其他服务需验证 Token，只需分发公钥即可，无需共享密钥
- 安全性更高，密钥泄露风险更低

### 5.4 Token 签发

```typescript
// services/token.ts
import { SignJWT, importPKCS8 } from 'jose';

const privateKey = await importPKCS8(process.env.JWT_PRIVATE_KEY, 'RS256');

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

async function issueTokenPair(
  userId: string,
  request: FastifyRequest
): Promise<TokenPair> {
  const jti = crypto.randomUUID();

  // Access Token — 包含用户基本信息
  const accessToken = await new SignJWT({
    sub: userId,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti(jti)
    .setIssuer('https://auth.muxvo.com')
    .setAudience('muxvo-app')
    .sign(privateKey);

  // Refresh Token — 最小化 payload
  const refreshTokenValue = crypto.randomUUID() + crypto.randomUUID();
  const refreshTokenHash = createHash('sha256')
    .update(refreshTokenValue)
    .digest('hex');

  // 持久化 Refresh Token (hash 存储)
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
    [userId, refreshTokenHash, request.headers['user-agent'] || 'unknown']
  );

  return {
    accessToken,
    refreshToken: refreshTokenValue,
  };
}
```

### 5.5 Token 刷新流程

```
Electron                           后端
   │                                │
   │  API 请求 (AT 已过期)           │
   │  ────────────────────────►     │
   │  ◄──── 401 Unauthorized        │
   │                                │
   │  POST /auth/token/refresh      │
   │  {refreshToken}                │
   │  ────────────────────────►     │
   │                                │
   │  验证 RT hash → 签发新 AT+RT    │
   │  旧 RT 标记 revoked            │
   │                                │
   │  ◄──── {accessToken,           │
   │         refreshToken}          │
   │                                │
   │  用新 AT 重试原请求             │
   │  ────────────────────────►     │
   │  ◄──── 200 OK                  │
```

```typescript
// routes/auth/token.ts

fastify.post('/auth/token/refresh', async (request, reply) => {
  const { refreshToken } = request.body;

  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

  // 查找未撤销、未过期的 Refresh Token
  const result = await db.query(
    `SELECT id, user_id FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh Token 无效或已过期', 401);
  }

  const { id: oldTokenId, user_id: userId } = result.rows[0];

  // 撤销旧 Refresh Token (Rotation: 每次刷新都签发新 RT)
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
    [oldTokenId]
  );

  // 检查用户状态
  const userResult = await db.query(
    `SELECT * FROM users WHERE id = $1 AND status = 'active'`,
    [userId]
  );
  if (userResult.rows.length === 0) {
    throw new AuthError('USER_INACTIVE', '用户账号已停用', 403);
  }

  // 签发新 Token pair
  const tokens = await issueTokenPair(userId, request);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
});
```

### 5.6 Refresh Token Rotation 安全机制

每次刷新都签发新的 Refresh Token 并撤销旧的。如果检测到已撤销的 RT 被重用（说明 RT 已泄露），立即撤销该用户所有 RT:

```typescript
// 在 refresh 接口中增加泄露检测
const revokedCheck = await db.query(
  `SELECT id FROM refresh_tokens
   WHERE token_hash = $1 AND revoked_at IS NOT NULL`,
  [tokenHash]
);

if (revokedCheck.rows.length > 0) {
  // Refresh Token 重放攻击! 撤销该用户所有 Token
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = (
       SELECT user_id FROM refresh_tokens WHERE token_hash = $1
     )`,
    [tokenHash]
  );
  throw new AuthError('TOKEN_REUSE_DETECTED', '检测到异常登录，已强制登出所有设备', 401);
}
```

### 5.7 密钥管理

```bash
# 生成 RSA 密钥对 (2048 bit)
openssl genrsa -out jwt-private.pem 2048
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem

# 密钥存储: 环境变量 (生产环境推荐阿里云 KMS)
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ..."
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIj..."
JWT_KEY_ID="muxvo-auth-key-v1"   # Key ID, 用于密钥轮换
```

**密钥轮换策略:**
1. 新密钥生成后，更新 `JWT_KEY_ID` 为 v2
2. 签发新 Token 用 v2 密钥
3. 验证时同时支持 v1 和 v2 (通过 JWT header 的 `kid` 字段判断)
4. v1 所有 AT 过期后 (15 分钟)，移除 v1 公钥

---

## 6. API 接口设计

### 6.1 路由总览

```
POST   /auth/github/init          → 初始化 GitHub OAuth
GET    /auth/github/callback       → GitHub OAuth 回调
POST   /auth/google/init          → 初始化 Google OAuth
GET    /auth/google/callback       → Google OAuth 回调
POST   /auth/email/send            → 发送邮箱验证码
POST   /auth/email/verify          → 验证码验证 + 登录
POST   /auth/token/refresh         → 刷新 Access Token
POST   /auth/logout                → 登出 (撤销 RT)
GET    /user/me                    → 获取当前用户信息 [需认证]
PATCH  /user/me                    → 更新用户信息 [需认证]
GET    /user/me/identities         → 获取已绑定的登录方式 [需认证]
POST   /user/me/identities/bind    → 绑定新的登录方式 [需认证]
DELETE /user/me/identities/:id     → 解绑登录方式 [需认证]
```

### 6.2 统一响应格式

```typescript
// 成功响应
interface SuccessResponse<T> {
  success: true;
  data: T;
}

// 错误响应
interface ErrorResponse {
  success: false;
  error: {
    code: string;       // 业务错误码
    message: string;    // 人类可读的错误描述
  };
}
```

### 6.3 错误码定义

| HTTP Status | 错误码 | 说明 |
|-------------|--------|------|
| 400 | `INVALID_PARAMS` | 请求参数校验失败 |
| 400 | `INVALID_CODE` | 邮箱验证码无效或已过期 |
| 400 | `INVALID_STATE` | OAuth state 无效或已过期 |
| 400 | `INVALID_NONCE` | Google OAuth nonce 不匹配 |
| 401 | `UNAUTHORIZED` | 未提供或无效的 Access Token |
| 401 | `TOKEN_EXPIRED` | Access Token 已过期 |
| 401 | `INVALID_REFRESH_TOKEN` | Refresh Token 无效或已过期 |
| 401 | `TOKEN_REUSE_DETECTED` | 检测到 Refresh Token 重放攻击 |
| 403 | `USER_INACTIVE` | 用户账号已停用 |
| 403 | `IDENTITY_UNBIND_DENIED` | 不能解绑最后一种登录方式 |
| 409 | `IDENTITY_ALREADY_BOUND` | 该第三方账号已绑定到其他用户 |
| 429 | `RATE_LIMITED` | 请求频率超限 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |
| 502 | `OAUTH_PROVIDER_ERROR` | OAuth 提供商返回错误 |
| 503 | `EMAIL_SEND_FAILED` | 邮件发送失败 |

### 6.4 详细接口定义

#### POST /auth/email/send

```
Request:
  Content-Type: application/json
  Body: { "email": "user@example.com" }

Response 200:
  { "success": true, "data": { "expiresIn": 300 } }

Response 429:
  { "success": false, "error": { "code": "RATE_LIMITED", "message": "发送过于频繁，请 60 秒后重试" } }
```

#### POST /auth/email/verify

```
Request:
  Content-Type: application/json
  Body: { "email": "user@example.com", "code": "123456" }

Response 200:
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "550e8400-e29b...",
      "user": {
        "id": "uuid",
        "displayName": "user",
        "avatarUrl": null,
        "email": "user@example.com"
      }
    }
  }
```

#### POST /auth/github/init

```
Request: (无 body)

Response 200:
  {
    "success": true,
    "data": {
      "authUrl": "https://github.com/login/oauth/authorize?client_id=...&state=...",
      "state": "uuid"
    }
  }
```

#### POST /auth/token/refresh

```
Request:
  Content-Type: application/json
  Body: { "refreshToken": "550e8400-e29b..." }

Response 200:
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOi...(新)",
      "refreshToken": "770a9500-f38c...(新)"
    }
  }
```

#### POST /auth/logout

```
Request:
  Authorization: Bearer <accessToken>
  Content-Type: application/json
  Body: { "refreshToken": "550e8400-e29b..." }

Response 200:
  { "success": true, "data": { "loggedOut": true } }
```

#### GET /user/me

```
Request:
  Authorization: Bearer <accessToken>

Response 200:
  {
    "success": true,
    "data": {
      "id": "uuid",
      "displayName": "John Doe",
      "avatarUrl": "https://...",
      "email": "user@example.com",
      "emailVerified": true,
      "createdAt": "2026-01-01T00:00:00Z",
      "identities": [
        { "provider": "github", "providerId": "12345" },
        { "provider": "email", "providerId": "user@example.com" }
      ]
    }
  }
```

### 6.5 认证中间件

```typescript
// plugins/auth.ts
import { jwtVerify, importSPKI } from 'jose';

const publicKey = await importSPKI(process.env.JWT_PUBLIC_KEY, 'RS256');

async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('UNAUTHORIZED', '未提供认证令牌', 401);
  }

  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: 'https://auth.muxvo.com',
      audience: 'muxvo-app',
    });

    if (payload.type !== 'access') {
      throw new Error('Invalid token type');
    }

    request.userId = payload.sub;
  } catch (err) {
    if (err.code === 'ERR_JWT_EXPIRED') {
      throw new AuthError('TOKEN_EXPIRED', 'Access Token 已过期', 401);
    }
    throw new AuthError('UNAUTHORIZED', '无效的认证令牌', 401);
  }
}

// 注册为 Fastify 装饰器
fastify.decorate('authenticate', authMiddleware);

// 使用方式
fastify.get('/user/me', {
  preHandler: [fastify.authenticate],
}, async (request) => {
  return getUserProfile(request.userId);
});
```

---

## 7. 安全方案

### 7.1 OAuth PKCE

所有 OAuth 流程均使用 PKCE (Proof Key for Code Exchange):

```typescript
// utils/pkce.ts
import { randomBytes, createHash } from 'crypto';

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
```

- `code_challenge_method`: 固定使用 `S256`
- `code_verifier` 仅存于 Redis (后端)，不经网络传输到客户端

### 7.2 CSRF 防护

1. **OAuth State 参数**: 每次 OAuth 流程生成随机 state，回调时严格匹配
2. **Google Nonce**: 额外生成 nonce 防重放
3. **SameSite**: Electron 桌面应用不使用 Cookie，此风险天然规避
4. **Origin 检查**: API 层校验 request origin

### 7.3 Rate Limiting

```typescript
// Fastify 层 Rate Limiting
import rateLimit from '@fastify/rate-limit';

// 全局限制
await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.ip,
});

// 邮箱验证码发送 — 更严格的限制
fastify.post('/auth/email/send', {
  config: {
    rateLimit: {
      max: 3,
      timeWindow: '5 minutes',
      keyGenerator: (request) => `email:${request.body?.email || request.ip}`,
    },
  },
}, handler);

// 登录/验证 — 防暴力破解
fastify.post('/auth/email/verify', {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '15 minutes',
      keyGenerator: (request) => request.ip,
    },
  },
}, handler);
```

Nginx 层额外限流 (见 2.3 节配置)，形成两层防护。

### 7.4 CORS 配置

```typescript
import cors from '@fastify/cors';

await fastify.register(cors, {
  // Electron 桌面应用发出的请求 origin 为 null 或 app://
  // 允许特定来源
  origin: [
    'app://.',                    // Electron 协议
    'muxvo://.',                  // 自定义协议
    'http://localhost:5173',      // 开发环境
  ],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,              // 不使用 Cookie
});
```

### 7.5 输入验证

所有接口通过 Fastify JSON Schema 验证:

```typescript
// 邮箱格式
{ type: 'string', format: 'email', maxLength: 255 }

// 验证码格式
{ type: 'string', pattern: '^[0-9]{6}$' }

// UUID 格式
{ type: 'string', format: 'uuid' }
```

### 7.6 敏感数据处理

| 数据 | 存储方式 |
|------|----------|
| Refresh Token | SHA-256 hash 后存入 DB，原文不存 |
| OAuth client_secret | 环境变量，不入代码库 |
| JWT 私钥 | 环境变量 (生产用阿里云 KMS) |
| 邮箱验证码 | DB 明文 (短期有效 + 限次，可接受) |
| GitHub/Google access_token | 仅在回调时使用，不持久化 |

### 7.7 安全头

```typescript
import helmet from '@fastify/helmet';

await fastify.register(helmet, {
  contentSecurityPolicy: false, // API 服务不需要 CSP
  hsts: { maxAge: 31536000, includeSubDomains: true },
});
```

---

## 8. 部署与运维

### 8.1 项目结构

```
muxvo-auth-server/
├── src/
│   ├── app.ts                  # Fastify 实例创建与插件注册
│   ├── server.ts               # 启动入口
│   ├── config/
│   │   ├── env.ts              # 环境变量验证 (使用 @fastify/env)
│   │   └── jwt.ts              # JWT 配置
│   ├── routes/
│   │   ├── auth/
│   │   │   ├── github.ts       # GitHub OAuth 路由
│   │   │   ├── google.ts       # Google OAuth 路由
│   │   │   ├── email.ts        # 邮箱验证码路由
│   │   │   └── token.ts        # Token 刷新/登出
│   │   └── user/
│   │       └── me.ts           # 用户信息路由
│   ├── services/
│   │   ├── user.ts             # 用户查询/创建
│   │   ├── token.ts            # Token 签发/验证
│   │   └── email.ts            # 邮件发送
│   ├── plugins/
│   │   ├── auth.ts             # 认证中间件
│   │   ├── db.ts               # PostgreSQL 连接
│   │   └── redis.ts            # Redis 连接
│   ├── errors/
│   │   └── auth-error.ts       # 自定义错误类
│   └── utils/
│       └── pkce.ts             # PKCE 工具函数
├── migrations/
│   ├── 001_create_users.sql
│   ├── 002_create_identities.sql
│   ├── 003_create_refresh_tokens.sql
│   └── 004_create_email_verifications.sql
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

### 8.2 Docker Compose (初期部署)

```yaml
# docker-compose.yml
version: '3.8'

services:
  auth-api:
    build: .
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://muxvo:${DB_PASSWORD}@postgres:5432/muxvo_auth
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=muxvo_auth
      - POSTGRES_USER=muxvo
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    ports:
      - "127.0.0.1:5432:5432"
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    ports:
      - "127.0.0.1:6379:6379"
    restart: unless-stopped

volumes:
  pgdata:
  redisdata:
```

### 8.3 环境变量清单

```bash
# .env.example

# 服务
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# 数据库
DATABASE_URL=postgresql://muxvo:password@localhost:5432/muxvo_auth

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."
JWT_KEY_ID=muxvo-auth-key-v1

# GitHub OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_CALLBACK_URL=https://auth.muxvo.com/api/auth/github/callback

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_CALLBACK_URL=https://auth.muxvo.com/api/auth/google/callback

# 阿里云邮件推送
ALIYUN_AK_ID=xxx
ALIYUN_AK_SECRET=xxx
ALIYUN_EMAIL_SENDER=noreply@mail.muxvo.com

# Electron 自定义协议 (OAuth 回调后重定向)
APP_SCHEME=muxvo
```

### 8.4 数据库迁移

推荐使用 `node-pg-migrate` (轻量，纯 SQL 迁移):

```bash
npm install node-pg-migrate
npx node-pg-migrate up    # 执行迁移
npx node-pg-migrate down  # 回滚
```

### 8.5 健康检查

```typescript
// routes/health.ts
fastify.get('/health', async () => {
  const dbOk = await db.query('SELECT 1').then(() => true).catch(() => false);
  const redisOk = await redis.ping().then(() => true).catch(() => false);

  return {
    status: dbOk && redisOk ? 'healthy' : 'degraded',
    db: dbOk ? 'ok' : 'error',
    redis: redisOk ? 'ok' : 'error',
    uptime: process.uptime(),
  };
});
```

### 8.6 日志

```typescript
// Fastify 内置 Pino logger
const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
});
```

生产环境日志输出 JSON 格式，通过 `journalctl` 或 Docker 日志收集。

### 8.7 核心依赖清单

```json
{
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0",
    "@fastify/rate-limit": "^10.0.0",
    "@fastify/helmet": "^12.0.0",
    "@fastify/env": "^5.0.0",
    "jose": "^6.0.0",
    "pg": "^8.13.0",
    "ioredis": "^5.4.0",
    "node-pg-migrate": "^7.0.0",
    "@alicloud/dm20151123": "^2.0.0"
  }
}
```
