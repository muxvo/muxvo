# Muxvo 登录系统 — 完整技术方案

> 版本: v1.0 | 日期: 2026-02-24
> 支持: GitHub OAuth + Google OAuth + 邮箱验证码 三种登录方式
> 部署: 阿里云 ECS

---

## 目录

1. [系统架构总览](#1-系统架构总览)
2. [三种登录流程时序图](#2-三种登录流程时序图)
3. [后端服务设计](#3-后端服务设计)
4. [API 接口设计](#4-api-接口设计)
5. [数据库设计](#5-数据库设计)
6. [前端改造设计](#6-前端改造设计)
7. [安全方案](#7-安全方案)
8. [部署方案](#8-部署方案)
9. [实施步骤与优先级](#9-实施步骤与优先级)

---

## 1. 系统架构总览

### 1.1 架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    Muxvo Electron App                        │
│                                                              │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐ │
│  │ LoginModal   │  │ AuthContext     │  │ AuthButton       │ │
│  │ (3种登录UI)   │  │ (状态管理)      │  │ (MenuBar入口)    │ │
│  └──────┬───────┘  └───────┬────────┘  └──────────────────┘ │
│         │ IPC              │ IPC                              │
│  ┌──────▼──────────────────▼─────────────────────────────┐   │
│  │ auth-handlers.ts (主进程)                               │   │
│  │ ├─ loginGithub / loginGoogle → shell.openExternal()    │   │
│  │ ├─ sendEmailCode / loginEmail → POST 后端 API          │   │
│  │ ├─ token-storage.ts → safeStorage 加密存储              │   │
│  │ └─ deep-link.ts → muxvo:// 协议处理                    │   │
│  └──────────────────────┬────────────────────────────────┘   │
└─────────────────────────┼────────────────────────────────────┘
                          │ HTTPS
                          ▼
              ┌───────────────────────┐
              │ Nginx (auth.muxvo.com)│
              │ SSL终结 + Rate Limit  │
              └───────────┬───────────┘
                          │
              ┌───────────▼───────────┐
              │  Fastify v5 后端服务   │
              │  (Node.js + TypeScript)│
              │                       │
              │  /auth/github/*       │
              │  /auth/google/*       │
              │  /auth/email/*        │
              │  /auth/token/*        │
              │  /user/*              │
              └──┬─────┬─────────┬────┘
                 │     │         │
        ┌────────┘     │         └──────────┐
        ▼              ▼                    ▼
 ┌────────────┐ ┌────────────┐     ┌──────────────┐
 │ PostgreSQL │ │   Redis    │     │ 阿里云        │
 │ 16         │ │   7        │     │ DirectMail   │
 │ (用户数据)  │ │ (缓存/限流) │     │ (邮件发送)    │
 └────────────┘ └────────────┘     └──────────────┘
```

### 1.2 技术栈总结

| 层级 | 技术选型 | 理由 |
|------|---------|------|
| 后端框架 | Fastify v5 | TS 一流支持、内置 JSON Schema 验证、性能优异 |
| 数据库 | PostgreSQL 16 | 强类型、JSONB 支持、阿里云 RDS 无缝迁移 |
| 缓存 | Redis 7 | OAuth state、Rate Limit、Token 黑名单 |
| 邮件 | 阿里云 DirectMail | 同生态、国内投递率高、免费额度 2000/日 |
| JWT 签名 | RS256 (jose 库) | 非对称密钥、公钥可分发、安全性高 |
| Token 存储 | Electron safeStorage | macOS Keychain 级加密 |
| OAuth 回调 | Deep Link `muxvo://` | 无需端口监听、用户体验好 |
| 部署 | 阿里云 ECS + Docker Compose | 初期成本可控、后续可迁移 |

### 1.3 核心设计原则

- **统一身份**: 三种登录方式最终映射到同一 `users` 表，通过 `user_identities` 支持多方式绑定同一账号
- **后端中转 OAuth**: redirect_uri 指向后端，后端完成 token 交换后 redirect 到 `muxvo://`，保护 Client Secret
- **双 Token**: Access Token (15min, 内存) + Refresh Token (30天, safeStorage 加密文件)
- **无状态服务**: 后端无 session，JWT 自包含验证，便于水平扩展

---

## 2. 三种登录流程时序图

### 2.1 GitHub OAuth 流程

```
Electron                     后端 (auth.muxvo.com)                 GitHub
   │                              │                                   │
   │ 1. POST /auth/github/init   │                                   │
   ├─────────────────────────────►│                                   │
   │                              │ 2. 生成 state + PKCE → Redis     │
   │ 3. {authUrl, state}         │                                   │
   │◄─────────────────────────────┤                                   │
   │                              │                                   │
   │ 4. shell.openExternal(authUrl) ─────────────────────────────────►│
   │                              │                                   │
   │                              │ 5. GET /auth/github/callback      │
   │                              │    ?code=xxx&state=yyy            │
   │                              │◄──────────────────────────────────┤
   │                              │                                   │
   │                              │ 6. 验证 state → 换 access_token  │
   │                              │────────────────────────────────►  │
   │                              │◄──────────────────────────────────┤
   │                              │                                   │
   │                              │ 7. GET /user 获取用户信息          │
   │                              │────────────────────────────────►  │
   │                              │◄──────────────────────────────────┤
   │                              │                                   │
   │                              │ 8. 查询/创建本地用户               │
   │                              │    签发 JWT AT+RT                 │
   │                              │                                   │
   │ 9. redirect → muxvo://auth/ │                                   │
   │    success?at=...&rt=...    │                                   │
   │◄─────────────────────────────┤                                   │
   │                              │                                   │
   │ 10. Deep Link 唤起 Electron  │                                   │
   │     存储 Token → 更新 UI     │                                   │
```

### 2.2 Google OAuth 流程

与 GitHub 流程相同，关键差异:
- 授权端点: `accounts.google.com/o/oauth2/v2/auth`
- Token 端点: `oauth2.googleapis.com/token`
- Google 返回 `id_token` (JWT)，可直接解析获取用户信息，无需额外 API 调用
- Scope: `openid email profile`
- 额外验证 nonce 防重放

### 2.3 邮箱验证码流程

```
Electron                     后端 (auth.muxvo.com)          阿里云 DirectMail
   │                              │                              │
   │ 1. POST /auth/email/send    │                              │
   │    {email}                  │                              │
   ├─────────────────────────────►│                              │
   │                              │ 2. Rate Limit 检查           │
   │                              │ 3. 生成 6位验证码 → DB       │
   │                              │ 4. 发送验证码邮件            │
   │                              │─────────────────────────────►│
   │ 5. {success, expiresIn:300} │                              │
   │◄─────────────────────────────┤                              │
   │                              │                              │
   │ [用户收到邮件,输入验证码]      │                              │
   │                              │                              │
   │ 6. POST /auth/email/verify  │                              │
   │    {email, code}            │                              │
   ├─────────────────────────────►│                              │
   │                              │ 7. 匹配验证码 + 未过期检查    │
   │                              │ 8. 查询/创建用户              │
   │                              │ 9. 签发 JWT AT+RT            │
   │                              │                              │
   │ 10. {accessToken,           │                              │
   │      refreshToken, user}    │                              │
   │◄─────────────────────────────┤                              │
   │                              │                              │
   │ 11. 存储 Token → 更新 UI    │                              │
```

### 2.4 Token 刷新流程

```
Electron                     后端
   │                              │
   │ API 请求 (AT 过期)           │
   ├─────────────────────────────►│
   │◄───── 401 TOKEN_EXPIRED ─────┤
   │                              │
   │ POST /auth/token/refresh     │
   │ {refreshToken}               │
   ├─────────────────────────────►│
   │                              │ 验证 RT hash → 签发新 AT+RT
   │                              │ 旧 RT 标记 revoked (Rotation)
   │◄─── {新 AT, 新 RT} ──────────┤
   │                              │
   │ 用新 AT 重试原请求            │
   ├─────────────────────────────►│
   │◄───── 200 OK ────────────────┤
```

---

## 3. 后端服务设计

### 3.1 项目结构

```
muxvo-auth-server/
├── src/
│   ├── app.ts                  # Fastify 实例 + 插件注册
│   ├── server.ts               # 启动入口
│   ├── config/
│   │   ├── env.ts              # 环境变量验证 (@fastify/env)
│   │   └── jwt.ts              # JWT RS256 配置
│   ├── routes/
│   │   ├── auth/
│   │   │   ├── github.ts       # /auth/github/init + callback
│   │   │   ├── google.ts       # /auth/google/init + callback
│   │   │   ├── email.ts        # /auth/email/send + verify
│   │   │   └── token.ts        # /auth/token/refresh + logout
│   │   └── user/
│   │       └── me.ts           # /user/me (CRUD)
│   ├── services/
│   │   ├── user.ts             # findOrCreateUser (统一用户查询/创建)
│   │   ├── token.ts            # issueTokenPair / verifyToken
│   │   └── email.ts            # 阿里云 DirectMail 发送
│   ├── plugins/
│   │   ├── auth.ts             # JWT 认证中间件
│   │   ├── db.ts               # PostgreSQL 连接池
│   │   └── redis.ts            # Redis 连接
│   ├── errors/
│   │   └── auth-error.ts       # 自定义错误类 + 13种错误码
│   └── utils/
│       └── pkce.ts             # PKCE 工具函数
├── migrations/
│   ├── 001_create_users.sql
│   ├── 002_create_identities.sql
│   ├── 003_create_refresh_tokens.sql
│   └── 004_create_email_verifications.sql
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── tsconfig.json
```

### 3.2 核心依赖

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

### 3.3 统一用户查询/创建逻辑

三种登录方式共用 `findOrCreateUser()`，核心逻辑:

1. 先查 `user_identities` 表：该 provider+providerId 是否已绑定 → 有则直接返回用户
2. 通过 email 查 `users` 表：同邮箱的已有用户 → 绑定新 identity 到该用户
3. 都没匹配 → 创建新用户 + 新 identity

这实现了**多种登录方式绑定同一账号**的核心需求。

---

## 4. API 接口设计

### 4.1 路由总览 (13 个接口)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/auth/github/init` | 初始化 GitHub OAuth | 否 |
| GET | `/auth/github/callback` | GitHub OAuth 回调 | 否 |
| POST | `/auth/google/init` | 初始化 Google OAuth | 否 |
| GET | `/auth/google/callback` | Google OAuth 回调 | 否 |
| POST | `/auth/email/send` | 发送邮箱验证码 | 否 |
| POST | `/auth/email/verify` | 验证码验证 + 登录 | 否 |
| POST | `/auth/token/refresh` | 刷新 Access Token | 否 |
| POST | `/auth/logout` | 登出 (撤销 RT) | 是 |
| GET | `/user/me` | 获取当前用户信息 | 是 |
| PATCH | `/user/me` | 更新用户信息 | 是 |
| GET | `/user/me/identities` | 获取已绑定登录方式 | 是 |
| POST | `/user/me/identities/bind` | 绑定新登录方式 | 是 |
| DELETE | `/user/me/identities/:id` | 解绑登录方式 | 是 |

### 4.2 统一响应格式

```typescript
// 成功
{ "success": true, "data": { ... } }

// 错误
{ "success": false, "error": { "code": "ERROR_CODE", "message": "描述" } }
```

### 4.3 错误码 (13 种)

| HTTP | 错误码 | 说明 |
|------|--------|------|
| 400 | `INVALID_PARAMS` | 参数校验失败 |
| 400 | `INVALID_CODE` | 验证码无效或已过期 |
| 400 | `INVALID_STATE` | OAuth state 无效 |
| 400 | `INVALID_NONCE` | Google nonce 不匹配 |
| 401 | `UNAUTHORIZED` | 未提供 Access Token |
| 401 | `TOKEN_EXPIRED` | AT 已过期 |
| 401 | `INVALID_REFRESH_TOKEN` | RT 无效或已过期 |
| 401 | `TOKEN_REUSE_DETECTED` | RT 重放攻击，强制登出所有设备 |
| 403 | `USER_INACTIVE` | 账号已停用 |
| 403 | `IDENTITY_UNBIND_DENIED` | 不能解绑最后一种登录方式 |
| 409 | `IDENTITY_ALREADY_BOUND` | 第三方账号已绑定其他用户 |
| 429 | `RATE_LIMITED` | 请求频率超限 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

### 4.4 关键接口详情

#### POST /auth/email/send

```
请求: { "email": "user@example.com" }
成功: { "success": true, "data": { "expiresIn": 300 } }
限流: { "success": false, "error": { "code": "RATE_LIMITED", "message": "60秒后重试" } }
```

#### POST /auth/email/verify

```
请求: { "email": "user@example.com", "code": "123456" }
成功: { "success": true, "data": { "accessToken": "...", "refreshToken": "...", "user": {...} } }
```

#### POST /auth/github/init

```
请求: (无 body)
成功: { "success": true, "data": { "authUrl": "https://github.com/login/oauth/authorize?...", "state": "uuid" } }
```

#### POST /auth/token/refresh

```
请求: { "refreshToken": "550e8400-e29b..." }
成功: { "success": true, "data": { "accessToken": "(新)", "refreshToken": "(新)" } }
```

---

## 5. 数据库设计

### 5.1 ER 关系

```
users (1) ──── (N) user_identities     多种登录方式绑定同一用户
users (1) ──── (N) refresh_tokens       一个用户可有多设备 Token
email_verifications                     独立验证码表
```

### 5.2 表结构

#### users — 核心用户表

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  VARCHAR(100),
    avatar_url    TEXT,
    email         VARCHAR(255) UNIQUE,          -- 可为空
    email_verified BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    status        VARCHAR(20) DEFAULT 'active'  -- active / suspended / deleted
);
```

#### user_identities — 多登录方式绑定

```sql
CREATE TABLE user_identities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      VARCHAR(20) NOT NULL,          -- 'github' | 'google' | 'email'
    provider_id   VARCHAR(255) NOT NULL,          -- GitHub uid / Google sub / 邮箱地址
    provider_data JSONB DEFAULT '{}',             -- OAuth profile 原始数据
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(provider, provider_id)
);
```

#### refresh_tokens — RT 持久化

```sql
CREATE TABLE refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    VARCHAR(128) NOT NULL UNIQUE,   -- SHA-256 hash，不存原文
    device_info   VARCHAR(255),
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    revoked_at    TIMESTAMPTZ                      -- 非空则已撤销
);
```

#### email_verifications — 邮箱验证码

```sql
CREATE TABLE email_verifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL,
    code          VARCHAR(6) NOT NULL,
    purpose       VARCHAR(20) DEFAULT 'login',
    attempts      INT DEFAULT 0,
    max_attempts  INT DEFAULT 5,
    expires_at    TIMESTAMPTZ NOT NULL,            -- 5 分钟
    verified_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.3 Redis 数据结构

```
rate:email:{email}        → counter  TTL=60s     每分钟 1 次验证码
rate:email:daily:{email}  → counter  TTL=86400s  每日 10 次
rate:login:{ip}           → counter  TTL=900s    15分钟内 10 次登录
oauth:state:{state}       → JSON     TTL=600s    OAuth state + PKCE
token:blacklist:{jti}     → "1"      TTL=AT剩余   Token 主动撤销(可选)
```

---

## 6. 前端改造设计

### 6.1 Auth 状态机扩展 (5 状态)

```
                         LOGIN_GITHUB
                         LOGIN_GOOGLE          AUTH_FAILED
 ┌──────────┐  ───────>  ┌────────────┐  ────────────>  ┌──────────┐
 │ LoggedOut │            │ Authorizing│                  │ LoggedOut│
 └──────────┘            └────────────┘                  └──────────┘
      │                       │
      │ SEND_EMAIL_CODE       │ AUTH_CALLBACK
      ▼                       ▼
 ┌──────────┐  VERIFY_CODE  ┌────────────┐  TOKEN_RECEIVED  ┌──────────┐
 │ CodeSent │ ─────────────>│  Verifying │ ────────────────> │ LoggedIn │
 └──────────┘               └────────────┘                   └──────────┘
                                  │                               │
                            AUTH_FAILED                    LOGOUT / TOKEN_EXPIRED
                                  ▼                               ▼
                            ┌──────────┐                    ┌──────────┐
                            │ LoggedOut│                    │ LoggedOut│
                            └──────────┘                    └──────────┘
```

- **LoggedOut** → 未登录，初始状态
- **Authorizing** → OAuth 浏览器已打开，等待回调
- **CodeSent** → 邮箱验证码已发送，等待用户输入
- **Verifying** → 正在验证（OAuth token 交换 / 验证码校验）
- **LoggedIn** → 已登录

### 6.2 IPC Channel 扩展

```typescript
AUTH: {
  LOGIN_GITHUB: 'auth:login-github',        // 已有
  LOGIN_GOOGLE: 'auth:login-google',         // 新增
  SEND_EMAIL_CODE: 'auth:send-email-code',   // 新增
  LOGIN_EMAIL: 'auth:login-email',           // 新增
  LOGOUT: 'auth:logout',                     // 已有
  GET_STATUS: 'auth:get-status',             // 已有
  REFRESH_TOKEN: 'auth:refresh-token',       // 新增
  AUTH_CALLBACK: 'auth:auth-callback',       // 新增 push event
  STATUS_CHANGE: 'auth:status-change',       // 新增 push event
}
```

新增 6 个 channel，**不修改现有 3 个**，向后兼容。

### 6.3 登录 UI 设计

```
┌─────────────────────────────────────┐
│              Muxvo 登录              │  [x]
│                                     │
│  ┌─────────────────────────────┐    │
│  │  [G] 使用 GitHub 登录        │    │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │  [G] 使用 Google 登录        │    │
│  └─────────────────────────────┘    │
│                                     │
│  ─── 或使用邮箱 ───                  │
│                                     │
│  邮箱: [________________]           │
│        [发送验证码]  (60s倒计时)      │
│  验证码: [______]                    │
│        [登录]                        │
│                                     │
│  登录即表示同意服务条款和隐私政策       │
└─────────────────────────────────────┘
```

入口: MenuBar 右侧 `AuthButton`，未登录显示"登录"，已登录显示头像 + UserDropdown。

### 6.4 前端新增/改造文件清单

**新增 12 个文件:**

| 文件 | 用途 |
|------|------|
| `src/renderer/contexts/AuthContext.tsx` | Auth 状态管理 (useReducer + Context) |
| `src/renderer/components/auth/LoginModal.tsx` | 登录模态框 |
| `src/renderer/components/auth/LoginModal.css` | 样式 |
| `src/renderer/components/auth/OAuthButton.tsx` | OAuth 按钮 (GitHub/Google 复用) |
| `src/renderer/components/auth/EmailLoginForm.tsx` | 邮箱验证码表单 |
| `src/renderer/components/auth/AuthButton.tsx` | MenuBar 入口按钮 |
| `src/renderer/components/auth/UserDropdown.tsx` | 用户信息下拉 |
| `src/renderer/components/auth/UserDropdown.css` | 样式 |
| `src/modules/auth/google-oauth.ts` | Google OAuth 实现 |
| `src/modules/auth/email-auth.ts` | 邮箱验证码逻辑 |
| `src/modules/auth/token-refresh.ts` | Token 自动刷新定时器 |
| `src/modules/auth/deep-link.ts` | Deep Link URL 解析 |

**修改 12 个现有文件:**

| 文件 | 改造点 |
|------|--------|
| `src/shared/types/auth.types.ts` | 扩展类型: AuthProvider, AuthUser, AuthTokens |
| `src/shared/constants/channels.ts` | AUTH 新增 6 个 channel |
| `src/modules/auth/auth-machine.ts` | 重写: 3状态 → 5状态，支持三种登录方式 |
| `src/modules/auth/github-oauth.ts` | 实现真实 OAuth 流程 |
| `src/modules/auth/token-storage.ts` | 接入 safeStorage 加密 |
| `src/main/ipc/auth-handlers.ts` | 新增 4 个 handler |
| `src/main/index.ts` | 注册 Deep Link + 单实例锁 |
| `src/preload/index.ts` | auth 域新增 6 个方法 |
| `src/renderer/App.tsx` | 引入 AuthProvider |
| `src/renderer/components/layout/MenuBar.tsx` | 新增 AuthButton |
| `electron-builder.yml` | 注册 muxvo:// 协议 |
| `src/preload/api.d.ts` | 类型更新 |

### 6.5 Token 安全存储

| 项目 | 方案 |
|------|------|
| Access Token | 内存变量，15 分钟有效 |
| Refresh Token | Electron safeStorage 加密文件 (`~/Library/Application Support/Muxvo/.auth-token`) |
| 加密方式 | macOS Keychain + ChaCha20Poly1305 |
| 自动刷新 | 定时器每 4 分钟检查，过期前 5 分钟自动 refresh |
| 安全擦除 | 登出时 `unlinkSync` 删除加密文件 |

---

## 7. 安全方案

### 7.1 安全矩阵

| 威胁 | 防护措施 |
|------|---------|
| OAuth CSRF | 随机 state 参数 + Redis 存储验证 |
| OAuth 重放 | Google nonce 验证 |
| Token 劫持 | PKCE (S256)、HTTPS 强制、短期 AT |
| RT 泄露 | Refresh Token Rotation — 每次刷新签发新 RT，旧 RT 撤销；检测已撤销 RT 重用时强制登出所有设备 |
| 暴力破解 | 双层 Rate Limiting (Nginx + Fastify)，验证码 5 次尝试上限 |
| 验证码滥用 | 同邮箱 60s/次、10次/日 限制 |
| 中间人攻击 | HTTPS + HSTS + TLS 1.2+ |
| Client Secret 泄露 | 后端中转 OAuth，Secret 不入客户端 |
| Token 存储安全 | Electron safeStorage (Keychain 加密) |
| XSS/注入 | Fastify JSON Schema 输入验证、Helmet 安全头 |

### 7.2 Rate Limiting 策略

```
Nginx 层:     10 req/s per IP (auth_api zone)
Fastify 全局:  100 req/min per IP
邮箱发送:     1次/分钟/邮箱, 10次/日/邮箱
登录验证:     10次/15分钟/IP
验证码尝试:   5次/验证码
```

### 7.3 密钥管理

- JWT 使用 RS256 非对称密钥 (2048 bit RSA)
- 私钥: 环境变量 (生产用阿里云 KMS)
- Key ID (`kid`) 支持密钥轮换
- 轮换策略: 新密钥 v2 签发新 Token，验证时同时支持 v1+v2，v1 AT 全部过期后 (15min) 移除

---

## 8. 部署方案

### 8.1 服务器配置

```
阿里云 ECS 计算型 c7
├── 2 vCPU / 4 GiB 内存
├── 40GB ESSD 系统盘
├── Ubuntu 22.04
├── 域名: auth.muxvo.com
└── Docker Compose 部署
    ├── auth-api (Fastify, port 3000)
    ├── postgres:16-alpine
    └── redis:7-alpine
```

### 8.2 Nginx SSL 配置

```
auth.muxvo.com:443 → SSL 终结 → proxy_pass → 127.0.0.1:3000
证书: 阿里云免费 SSL (DigiCert DV) 或 Let's Encrypt
安全头: HSTS + X-Content-Type-Options + X-Frame-Options
```

### 8.3 环境变量清单

```bash
# 服务
NODE_ENV=production
PORT=3000

# 数据库
DATABASE_URL=postgresql://muxvo:xxx@postgres:5432/muxvo_auth

# Redis
REDIS_URL=redis://redis:6379

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

# 阿里云 DirectMail
ALIYUN_AK_ID=xxx
ALIYUN_AK_SECRET=xxx
ALIYUN_EMAIL_SENDER=noreply@mail.muxvo.com

# Electron 协议
APP_SCHEME=muxvo
```

---

## 9. 实施步骤与优先级

### Phase 1: 基础设施 (预计第1周)

| # | 任务 | 优先级 |
|---|------|--------|
| 1.1 | 创建 `muxvo-auth-server` 项目，搭建 Fastify + TypeScript 骨架 | P0 |
| 1.2 | 配置 PostgreSQL + Redis (Docker Compose) | P0 |
| 1.3 | 执行数据库迁移 (4 张表) | P0 |
| 1.4 | 实现 JWT Token 签发/验证 (RS256) | P0 |
| 1.5 | 实现统一用户查询/创建逻辑 (`findOrCreateUser`) | P0 |
| 1.6 | 实现认证中间件 + 统一错误处理 | P0 |

### Phase 2: 邮箱登录 (预计第2周)

| # | 任务 | 优先级 |
|---|------|--------|
| 2.1 | 配置阿里云 DirectMail，实现邮件发送 | P0 |
| 2.2 | 实现 `/auth/email/send` + `/auth/email/verify` | P0 |
| 2.3 | 实现 Rate Limiting (Redis) | P0 |
| 2.4 | Electron 前端: 扩展 IPC channels + auth-handlers | P0 |
| 2.5 | 前端: 实现 AuthContext + EmailLoginForm + LoginModal | P0 |
| 2.6 | 前端: Token safeStorage 存储 + 自动刷新 | P0 |

### Phase 3: OAuth 登录 (预计第3周)

| # | 任务 | 优先级 |
|---|------|--------|
| 3.1 | 注册 GitHub OAuth App + Google Cloud OAuth Client | P0 |
| 3.2 | 后端: 实现 GitHub OAuth 流程 (init + callback) | P0 |
| 3.3 | 后端: 实现 Google OAuth 流程 (init + callback + ID Token 验证) | P0 |
| 3.4 | Electron: 注册 `muxvo://` Deep Link 协议 | P0 |
| 3.5 | Electron: 实现 Deep Link 回调处理 + 单实例锁 | P0 |
| 3.6 | 前端: OAuthButton 组件 + 状态机扩展 | P0 |

### Phase 4: 完善与部署 (预计第4周)

| # | 任务 | 优先级 |
|---|------|--------|
| 4.1 | 实现 `/auth/token/refresh` + RT Rotation | P1 |
| 4.2 | 实现 `/user/me` + 账号绑定/解绑接口 | P1 |
| 4.3 | 实现 UserDropdown + AuthButton 组件 | P1 |
| 4.4 | 阿里云 ECS 部署 + Nginx SSL 配置 | P0 |
| 4.5 | 前端登录态与 Marketplace/Showcase 功能联动 | P1 |
| 4.6 | 编写测试: L1 (IPC 契约) + L2 (状态机) + L3 (登录旅程) | P1 |

### Phase 5: 安全加固 (持续)

| # | 任务 | 优先级 |
|---|------|--------|
| 5.1 | 安全审计: OAuth 流程、Token 管理、输入验证 | P1 |
| 5.2 | 日志监控: 异常登录检测、RT 重放告警 | P2 |
| 5.3 | 密钥轮换方案实施 | P2 |
| 5.4 | 阿里云 KMS 接入 (替代环境变量存密钥) | P2 |

---

## 附录: 详细设计文档索引

| 文档 | 路径 | 内容 |
|------|------|------|
| 后端架构详细设计 | `docs/auth-backend-design.md` | 完整后端代码示例、Nginx 配置、Docker Compose |
| 前端改造详细设计 | `docs/auth-frontend-design.md` | 状态机代码、组件设计、AuthContext 完整实现 |
