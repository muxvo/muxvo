# Muxvo 登录系统前端改造设计方案

> 版本：v1.0 | 日期：2026-02-24
> 涵盖：登录 UI、状态机扩展、IPC 通道、OAuth 回调、Token 存储、前端状态管理

---

## 目录

1. [现状分析](#1-现状分析)
2. [登录 UI 设计](#2-登录-ui-设计)
3. [Auth 状态机扩展](#3-auth-状态机扩展)
4. [IPC Channel 扩展](#4-ipc-channel-扩展)
5. [Electron OAuth 回调处理](#5-electron-oauth-回调处理)
6. [Token 安全存储](#6-token-安全存储)
7. [前端状态管理](#7-前端状态管理)
8. [文件改造清单](#8-文件改造清单)
9. [组件层次关系图](#9-组件层次关系图)

---

## 1. 现状分析

### 1.1 现有认证架构

| 层 | 文件 | 职责 |
|----|------|------|
| 类型 | `src/shared/types/auth.types.ts` | `AuthLoginResponse` + `AuthStatus`，仅含 `username` / `avatarUrl` |
| IPC | `src/shared/constants/channels.ts` | `AUTH.LOGIN_GITHUB` / `AUTH.LOGOUT` / `AUTH.GET_STATUS` 三个通道 |
| Handler | `src/main/ipc/auth-handlers.ts` | 代理调用 `github-oauth.ts`，返回统一 `{ success, data/error }` |
| OAuth | `src/modules/auth/github-oauth.ts` | Stub 实现，`loginGithub()` 固定返回 `success: false` |
| 状态机 | `src/modules/auth/auth-machine.ts` | `LoggedOut → Authorizing → LoggedIn`，仅支持 GitHub PKCE |
| Token | `src/modules/auth/token-storage.ts` | 内存 Stub，未真正使用 `safeStorage` |
| Preload | `src/preload/index.ts` | `auth` 域暴露 `loginGithub` / `logout` / `getStatus` |
| 前端 | 无 Auth 组件 | MenuBar 右侧无用户状态展示 |

### 1.2 核心结论

- 现有代码是**骨架 Stub**，所有函数有签名无实现
- 状态机硬编码 GitHub 单一路径，需重构为 provider-agnostic
- Token 存储未接入 Electron `safeStorage`
- 前端完全没有 Auth UI 和状态管理

---

## 2. 登录 UI 设计

### 2.1 整体布局

登录入口放在 **MenuBar 右侧**（主题切换按钮和语言按钮之间），用户未登录时显示"登录"按钮，已登录时显示头像 + 用户名。

```
┌──────────────────────────────────────────────────────────┐
│ [拖拽区]  Muxvo  [终端|Skills|MCP|Hooks|历史]  ... [🌙] [👤登录] [EN] [+] │
└──────────────────────────────────────────────────────────┘
```

点击"登录"按钮弹出 **LoginModal**（居中模态框），点击用户头像弹出 **UserDropdown**。

### 2.2 LoginModal 组件设计

```
┌─────────────────────────────────────┐
│              Muxvo 登录              │  [×]
│                                     │
│  ┌─────────────────────────────┐    │
│  │  [G] 使用 GitHub 登录        │    │  ← OAuth 按钮（深色背景 + 图标）
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │  [G] 使用 Google 登录        │    │  ← OAuth 按钮
│  └─────────────────────────────┘    │
│                                     │
│  ─── 或使用邮箱 ───                  │  ← 分割线
│                                     │
│  邮箱: [________________]           │
│        [发送验证码]                   │  ← 60秒倒计时
│                                     │
│  验证码: [______]                    │
│        [登录]                        │
│                                     │
│  ─────────────────────────────      │
│  登录即表示同意服务条款和隐私政策       │
└─────────────────────────────────────┘
```

**交互逻辑**：

| 场景 | 行为 |
|------|------|
| 点击 GitHub 登录 | 调用 `window.api.auth.loginGithub()`，打开系统浏览器 → OAuth → Deep Link 回调 |
| 点击 Google 登录 | 调用 `window.api.auth.loginGoogle()`，同上 |
| 邮箱发送验证码 | 校验邮箱格式 → 调用 `window.api.auth.sendEmailCode(email)` → 按钮变为倒计时 60s |
| 邮箱登录 | 调用 `window.api.auth.loginEmail(email, code)` |
| 全部登录方式 | 成功后 Modal 关闭，MenuBar 切换为头像状态 |
| 错误情况 | 在 Modal 内显示红色错误提示条（如"验证码错误"、"GitHub 授权取消"等） |

### 2.3 UserDropdown 组件设计

```
┌──────────────────────┐
│  [头像]  用户名        │
│  provider: GitHub     │
│  ────────────────     │
│  登出                  │
└──────────────────────┘
```

已登录时点击头像 → 弹出下拉菜单，显示用户信息和登出按钮。

### 2.4 组件拆分

```
src/renderer/components/auth/
├── LoginModal.tsx         # 登录模态框（含三种方式）
├── LoginModal.css         # 样式
├── OAuthButton.tsx        # OAuth 登录按钮（复用于 GitHub / Google）
├── EmailLoginForm.tsx     # 邮箱 + 验证码表单
├── UserDropdown.tsx       # 已登录用户下拉菜单
├── UserDropdown.css       # 样式
└── AuthButton.tsx         # MenuBar 中的入口按钮（未登录→"登录"，已登录→头像）
```

### 2.5 加载与错误状态

| 状态 | UI 表现 |
|------|---------|
| `idle` | 按钮正常可点击 |
| `loading` | 按钮显示 Spinner，禁用所有登录按钮 |
| `error` | Modal 顶部红色横条，显示错误信息，3秒后自动消失或手动关闭 |
| `success` | Modal 关闭，MenuBar 过渡为已登录态 |
| `code_sent` | "发送验证码"按钮变为"60s 后重试"倒计时 |

---

## 3. Auth 状态机扩展

### 3.1 新的状态定义

```typescript
type AuthState =
  | 'LoggedOut'       // 未登录
  | 'Authorizing'     // OAuth 流程进行中（浏览器打开 / 等待回调）
  | 'CodeSent'        // 邮箱验证码已发送，等待用户输入
  | 'Verifying'       // 正在验证（OAuth token 交换 / 邮箱验证码校验）
  | 'LoggedIn';       // 已登录
```

### 3.2 新的 Context 定义

```typescript
type AuthProvider = 'github' | 'google' | 'email';

interface AuthContext {
  // OAuth PKCE (GitHub / Google)
  codeVerifier: string;
  codeChallenge: string;
  authCode?: string;

  // Token
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: string;
  tokenStorage: 'safeStorage' | 'memory';

  // User info
  provider?: AuthProvider;
  username?: string;
  email?: string;
  avatarUrl?: string;

  // Email login
  emailCodeSentAt?: number;     // 验证码发送时间戳

  // Error
  error?: string;
}
```

### 3.3 状态转换图

```
                          ┌──────────────────────────────────────┐
                          │                                      │
          LOGIN_GITHUB    │                                      │
          LOGIN_GOOGLE    ▼              AUTH_FAILED              │
 ┌──────────┐  ───>  ┌────────────┐  ──────────────────>  ┌──────────┐
 │ LoggedOut │        │ Authorizing│                       │ LoggedOut│
 └──────────┘  <───  └────────────┘                       └──────────┘
      │                    │
      │ SEND_EMAIL_CODE    │ AUTH_CALLBACK
      ▼                    ▼
 ┌──────────┐        ┌────────────┐      TOKEN_RECEIVED    ┌──────────┐
 │ CodeSent │ ──────>│  Verifying │  ──────────────────>   │ LoggedIn │
 └──────────┘        └────────────┘                        └──────────┘
   VERIFY_CODE             │                                    │
                     AUTH_FAILED                          LOGOUT / TOKEN_EXPIRED
                           │                                    │
                           ▼                                    ▼
                     ┌──────────┐                         ┌──────────┐
                     │ LoggedOut│                         │ LoggedOut│
                     └──────────┘                         └──────────┘
```

### 3.4 事件定义

```typescript
type AuthEvent =
  | 'LOGIN_GITHUB'       // 启动 GitHub OAuth
  | 'LOGIN_GOOGLE'       // 启动 Google OAuth
  | 'SEND_EMAIL_CODE'    // 发送邮箱验证码
  | 'VERIFY_CODE'        // 提交验证码
  | 'AUTH_CALLBACK'      // OAuth 回调（收到 authCode）
  | 'TOKEN_RECEIVED'     // Token 交换成功
  | 'AUTH_FAILED'        // 认证失败
  | 'LOGOUT'             // 主动登出
  | 'TOKEN_EXPIRED'      // Token 过期
  | 'TOKEN_REFRESHED';   // Token 刷新成功
```

### 3.5 改造后的状态机代码骨架

```typescript
export function createAuthMachine() {
  let state: AuthState = 'LoggedOut';
  const context: AuthContext = {
    codeVerifier: '',
    codeChallenge: '',
    tokenStorage: 'safeStorage',
  };

  function resetOAuthContext() {
    context.codeVerifier = '';
    context.codeChallenge = '';
    context.authCode = undefined;
    context.error = undefined;
  }

  function resetAll() {
    resetOAuthContext();
    context.accessToken = undefined;
    context.refreshToken = undefined;
    context.tokenExpiry = undefined;
    context.provider = undefined;
    context.username = undefined;
    context.email = undefined;
    context.avatarUrl = undefined;
    context.emailCodeSentAt = undefined;
  }

  function send(event: string, payload?: Record<string, unknown>) {
    switch (state) {
      case 'LoggedOut':
        if (event === 'LOGIN_GITHUB' || event === 'LOGIN_GOOGLE') {
          state = 'Authorizing';
          context.provider = event === 'LOGIN_GITHUB' ? 'github' : 'google';
          const pkce = generatePKCE();
          context.codeVerifier = pkce.verifier;
          context.codeChallenge = pkce.challenge;
          context.error = undefined;
        } else if (event === 'SEND_EMAIL_CODE') {
          state = 'CodeSent';
          context.provider = 'email';
          context.email = payload?.email as string;
          context.emailCodeSentAt = Date.now();
          context.error = undefined;
        }
        break;

      case 'Authorizing':
        if (event === 'AUTH_CALLBACK') {
          state = 'Verifying';
          context.authCode = payload?.authCode as string;
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = payload?.error as string || '授权失败';
          resetOAuthContext();
        }
        break;

      case 'CodeSent':
        if (event === 'VERIFY_CODE') {
          state = 'Verifying';
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = payload?.error as string || '验证码发送失败';
        } else if (event === 'SEND_EMAIL_CODE') {
          // 重新发送验证码
          context.emailCodeSentAt = Date.now();
        }
        break;

      case 'Verifying':
        if (event === 'TOKEN_RECEIVED') {
          state = 'LoggedIn';
          context.accessToken = payload?.accessToken as string;
          context.refreshToken = payload?.refreshToken as string;
          context.tokenExpiry = payload?.tokenExpiry as string;
          context.username = payload?.username as string;
          context.email = payload?.email as string;
          context.avatarUrl = payload?.avatarUrl as string;
        } else if (event === 'AUTH_FAILED') {
          state = 'LoggedOut';
          context.error = payload?.error as string || '验证失败';
          resetOAuthContext();
        }
        break;

      case 'LoggedIn':
        if (event === 'LOGOUT') {
          state = 'LoggedOut';
          resetAll();
        } else if (event === 'TOKEN_EXPIRED') {
          state = 'LoggedOut';
          resetAll();
        } else if (event === 'TOKEN_REFRESHED') {
          context.accessToken = payload?.accessToken as string;
          context.tokenExpiry = payload?.tokenExpiry as string;
        }
        break;
    }
  }

  return {
    get state() { return state; },
    get context() { return context; },
    send,
  };
}
```

---

## 4. IPC Channel 扩展

### 4.1 channels.ts 新增通道

```typescript
AUTH: {
  LOGIN_GITHUB: 'auth:login-github',        // 已有
  LOGIN_GOOGLE: 'auth:login-google',         // 新增
  SEND_EMAIL_CODE: 'auth:send-email-code',   // 新增
  LOGIN_EMAIL: 'auth:login-email',           // 新增
  LOGOUT: 'auth:logout',                     // 已有
  GET_STATUS: 'auth:get-status',             // 已有
  REFRESH_TOKEN: 'auth:refresh-token',       // 新增
  // Push events (Main → Renderer)
  AUTH_CALLBACK: 'auth:auth-callback',       // 新增 - Deep Link 回调
  STATUS_CHANGE: 'auth:status-change',       // 新增 - 登录状态变化推送
},
```

### 4.2 auth-handlers.ts 改造

新增 handler 方法，保持现有 `createXxxHandlers()` + `registerXxxHandlers()` 双函数模式：

```typescript
export function createAuthHandlers() {
  return {
    // 已有
    async loginGithub(): Promise<Record<string, unknown>> { ... },
    async logout(): Promise<Record<string, unknown>> { ... },
    async getStatus(): Promise<Record<string, unknown>> { ... },

    // 新增
    async loginGoogle(): Promise<Record<string, unknown>> {
      // 1. 生成 PKCE
      // 2. 用 shell.openExternal 打开 Google OAuth URL
      // 3. 等待 Deep Link 回调（通过 app.on('open-url') 接收）
      // 4. 用 authCode 换取 token（POST 到后端）
      // 5. 存储 token，返回用户信息
    },

    async sendEmailCode(params: { email: string }): Promise<Record<string, unknown>> {
      // POST 到后端 /api/auth/email/send-code
      // 返回 { success: true } 或错误
    },

    async loginEmail(params: { email: string; code: string }): Promise<Record<string, unknown>> {
      // POST 到后端 /api/auth/email/verify
      // 返回 { success, data: { user, tokens } }
    },

    async refreshToken(): Promise<Record<string, unknown>> {
      // POST 到后端 /api/auth/refresh
      // 用 refreshToken 换取新 accessToken
    },
  };
}

export function registerAuthHandlers(): void {
  const handlers = createAuthHandlers();

  ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_GITHUB, async () => handlers.loginGithub());
  ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_GOOGLE, async () => handlers.loginGoogle());
  ipcMain.handle(IPC_CHANNELS.AUTH.SEND_EMAIL_CODE, async (_e, p) => handlers.sendEmailCode(p));
  ipcMain.handle(IPC_CHANNELS.AUTH.LOGIN_EMAIL, async (_e, p) => handlers.loginEmail(p));
  ipcMain.handle(IPC_CHANNELS.AUTH.LOGOUT, async () => handlers.logout());
  ipcMain.handle(IPC_CHANNELS.AUTH.GET_STATUS, async () => handlers.getStatus());
  ipcMain.handle(IPC_CHANNELS.AUTH.REFRESH_TOKEN, async () => handlers.refreshToken());
}
```

### 4.3 preload API 扩展

```typescript
auth: {
  loginGithub: () =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN_GITHUB),
  loginGoogle: () =>                                          // 新增
    ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN_GOOGLE),
  sendEmailCode: (email: string) =>                           // 新增
    ipcRenderer.invoke(IPC_CHANNELS.AUTH.SEND_EMAIL_CODE, { email }),
  loginEmail: (email: string, code: string) =>                // 新增
    ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGIN_EMAIL, { email, code }),
  logout: () =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH.LOGOUT),
  getStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH.GET_STATUS),
  refreshToken: () =>                                         // 新增
    ipcRenderer.invoke(IPC_CHANNELS.AUTH.REFRESH_TOKEN),
  // Push events
  onAuthCallback: (callback: (data: { provider: string; authCode: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.AUTH.AUTH_CALLBACK, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH.AUTH_CALLBACK, handler);
  },
  onStatusChange: (callback: (data: AuthStatus) => void) => { // 新增
    const handler = (_e: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.AUTH.STATUS_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH.STATUS_CHANGE, handler);
  },
},
```

### 4.4 类型定义扩展（auth.types.ts）

```typescript
export type AuthProvider = 'github' | 'google' | 'email';

export interface AuthUser {
  username: string;
  email?: string;
  avatarUrl: string;
  provider: AuthProvider;
}

export interface AuthLoginResponse {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

export interface AuthStatus {
  loggedIn: boolean;
  user?: AuthUser;
  tokenExpiry?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;       // 秒
}

export interface SendCodeResponse {
  success: boolean;
  error?: string;
}
```

---

## 5. Electron OAuth 回调处理

### 5.1 方案选择：Deep Link（自定义协议 `muxvo://`）

| 方案 | 优点 | 缺点 |
|------|------|------|
| **Deep Link `muxvo://`** | 无需本地端口、不存在端口冲突、用户体验好 | 需配置协议注册、不同系统有差异 |
| localhost redirect | 实现简单 | 需要随机端口监听、防火墙可能拦截 |

**选择 Deep Link 方案**，原因：Electron 对自定义协议支持良好，macOS 上通过 `Info.plist` 注册，且不需要额外占用端口。

### 5.2 协议注册

**electron-builder.yml** 新增：

```yaml
mac:
  protocols:
    - name: Muxvo Auth
      schemes:
        - muxvo
```

**package.json** 开发模式注册（可选）：

```json
{
  "build": {
    "protocols": [{ "name": "Muxvo Auth", "schemes": ["muxvo"] }]
  }
}
```

### 5.3 回调处理流程

```
用户点击"GitHub登录"
    │
    ▼
主进程: shell.openExternal(githubOAuthUrl)
    │                           ┌──────────────┐
    │   浏览器完成授权            │  浏览器       │
    │   redirect 到:             │  GitHub OAuth │
    │   muxvo://auth/callback   │  授权页面      │
    │   ?code=xxx&state=yyy     └──────────────┘
    │
    ▼
macOS 唤起 Muxvo
    │
    ▼
主进程: app.on('open-url', (event, url) => {
    │   解析 url → 提取 code + state
    │   验证 state 匹配
    │   pushToAllWindows('auth:auth-callback', { provider, authCode })
    │ })
    │
    ▼
主进程: 用 authCode + codeVerifier 向后端换取 token
    │
    ▼
主进程: 存储 token → pushToAllWindows('auth:status-change', authStatus)
    │
    ▼
渲染进程: onStatusChange 回调更新 UI
```

### 5.4 主进程 Deep Link 处理代码

在 `src/main/index.ts` 中注册：

```typescript
// 确保单实例（防止多次打开）
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// macOS: 设置自定义协议
app.setAsDefaultProtocolClient('muxvo');

// macOS: Deep Link 回调
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// 已运行时收到第二个实例的 Deep Link
app.on('second-instance', (_event, commandLine) => {
  const url = commandLine.find(arg => arg.startsWith('muxvo://'));
  if (url) handleAuthCallback(url);
  // 聚焦主窗口
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function handleAuthCallback(url: string) {
  const parsed = new URL(url);
  // muxvo://auth/callback?code=xxx&state=yyy&provider=github
  if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    const provider = parsed.searchParams.get('provider') || 'github';

    // 验证 state 防 CSRF
    // 将 authCode 传递给 auth handler 完成 token 交换
    // 成功后 push 到渲染进程
    pushToAllWindows(IPC_CHANNELS.AUTH.AUTH_CALLBACK, {
      provider,
      authCode: code,
    });
  }
}
```

### 5.5 OAuth URL 构建

**GitHub OAuth URL**：
```
https://github.com/login/oauth/authorize
  ?client_id=<GITHUB_CLIENT_ID>
  &redirect_uri=<后端回调URL>        // 后端中转，再 redirect 到 muxvo://
  &scope=read:user user:email
  &state=<随机state>
  &code_challenge=<challenge>
  &code_challenge_method=S256
```

**Google OAuth URL**：
```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=<GOOGLE_CLIENT_ID>
  &redirect_uri=<后端回调URL>
  &scope=openid email profile
  &response_type=code
  &state=<随机state>
  &code_challenge=<challenge>
  &code_challenge_method=S256
```

**关键点**：`redirect_uri` 指向后端服务器（如 `https://api.muxvo.com/auth/callback/github`），后端完成 token 交换后 redirect 到 `muxvo://auth/callback?code=xxx&provider=github`。这样 OAuth 的 `redirect_uri` 是标准 HTTPS，符合 GitHub/Google 的要求。

### 5.6 后端中转回调流程

```
浏览器 → GitHub/Google → 后端 redirect_uri → 后端验证 code → redirect 到 muxvo://
```

后端中转的好处：
1. OAuth provider 要求 `redirect_uri` 为 HTTPS，`muxvo://` 不被接受
2. Client Secret 安全保存在后端，不暴露给客户端
3. 后端统一完成 token 交换和用户信息获取

---

## 6. Token 安全存储

### 6.1 Electron safeStorage 方案

```typescript
// src/modules/auth/token-storage.ts 改造

import { safeStorage } from 'electron';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

const TOKEN_FILE = join(app.getPath('userData'), '.auth-token');

export async function storeToken(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available');
  }
  const plaintext = JSON.stringify(tokens);
  const encrypted = safeStorage.encryptString(plaintext);
  writeFileSync(TOKEN_FILE, encrypted);
}

export async function getToken(): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
} | null> {
  if (!existsSync(TOKEN_FILE)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;

  const encrypted = readFileSync(TOKEN_FILE);
  const plaintext = safeStorage.decryptString(encrypted);
  return JSON.parse(plaintext);
}

export async function clearToken(): Promise<void> {
  if (existsSync(TOKEN_FILE)) {
    unlinkSync(TOKEN_FILE);
  }
}

export function isTokenExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}
```

### 6.2 存储位置

| 平台 | 加密方式 | 文件位置 |
|------|---------|---------|
| macOS | Keychain + ChaCha20Poly1305 | `~/Library/Application Support/Muxvo/.auth-token` |

### 6.3 Token 刷新策略

```
应用启动
  │
  ├─ 读取 .auth-token
  │   ├─ 不存在 → LoggedOut 状态
  │   └─ 存在 → 检查过期
  │       ├─ 未过期 → 直接 LoggedIn
  │       ├─ 即将过期（<5min） → 自动 refresh
  │       └─ 已过期 → 尝试 refresh
  │           ├─ refresh 成功 → LoggedIn
  │           └─ refresh 失败 → LoggedOut（清除 token）
  │
  └─ 定时器：每 4 分钟检查一次 token 过期
      └─ 过期前 5 分钟自动触发 refresh
```

### 6.4 安全擦除

- 登出时：`clearToken()` 删除加密文件
- Token 过期且 refresh 失败：同上
- 文件级删除（`unlinkSync`），无需手动清零内存（encrypted buffer 由 Electron 管理）

---

## 7. 前端状态管理

### 7.1 AuthContext（React Context）

新建 `src/renderer/contexts/AuthContext.tsx`，遵循 `PanelContext` 的相同模式：

```typescript
// src/renderer/contexts/AuthContext.tsx

import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';

// ── State ──
interface AuthState {
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  user: {
    username: string;
    email?: string;
    avatarUrl: string;
    provider: 'github' | 'google' | 'email';
  } | null;
  error: string | null;
  loginModalOpen: boolean;
}

const initialState: AuthState = {
  status: 'idle',
  user: null,
  error: null,
  loginModalOpen: false,
};

// ── Actions ──
type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; user: AuthState['user'] }
  | { type: 'LOGIN_FAILED'; error: string }
  | { type: 'LOGOUT' }
  | { type: 'OPEN_LOGIN_MODAL' }
  | { type: 'CLOSE_LOGIN_MODAL' }
  | { type: 'CLEAR_ERROR' };

// ── Reducer ──
function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, status: 'loading', error: null };
    case 'LOGIN_SUCCESS':
      return { ...state, status: 'authenticated', user: action.user, error: null, loginModalOpen: false };
    case 'LOGIN_FAILED':
      return { ...state, status: 'error', error: action.error };
    case 'LOGOUT':
      return { ...initialState };
    case 'OPEN_LOGIN_MODAL':
      return { ...state, loginModalOpen: true };
    case 'CLOSE_LOGIN_MODAL':
      return { ...state, loginModalOpen: false, error: null };
    case 'CLEAR_ERROR':
      return { ...state, error: null, status: state.user ? 'authenticated' : 'idle' };
    default:
      return state;
  }
}

// ── Context ──
interface AuthContextValue {
  state: AuthState;
  dispatch: React.Dispatch<AuthAction>;
  loginGithub: () => Promise<void>;
  loginGoogle: () => Promise<void>;
  sendEmailCode: (email: string) => Promise<boolean>;
  loginEmail: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // 启动时检查登录状态
  useEffect(() => {
    window.api.auth.getStatus().then((result: any) => {
      if (result?.success && result.data?.loggedIn && result.data.user) {
        dispatch({ type: 'LOGIN_SUCCESS', user: result.data.user });
      }
    }).catch(() => {});

    // 监听状态变化推送（Deep Link 回调后的登录成功）
    const unsub = window.api.auth.onStatusChange?.((data: any) => {
      if (data.loggedIn && data.user) {
        dispatch({ type: 'LOGIN_SUCCESS', user: data.user });
      } else {
        dispatch({ type: 'LOGOUT' });
      }
    });

    return () => unsub?.();
  }, []);

  async function loginGithub() {
    dispatch({ type: 'LOGIN_START' });
    const result = await window.api.auth.loginGithub();
    if (result?.success && result.data?.user) {
      dispatch({ type: 'LOGIN_SUCCESS', user: result.data.user });
    } else {
      dispatch({ type: 'LOGIN_FAILED', error: result?.error?.message || '登录失败' });
    }
  }

  async function loginGoogle() {
    dispatch({ type: 'LOGIN_START' });
    const result = await window.api.auth.loginGoogle();
    if (result?.success && result.data?.user) {
      dispatch({ type: 'LOGIN_SUCCESS', user: result.data.user });
    } else {
      dispatch({ type: 'LOGIN_FAILED', error: result?.error?.message || '登录失败' });
    }
  }

  async function sendEmailCode(email: string): Promise<boolean> {
    const result = await window.api.auth.sendEmailCode(email);
    if (!result?.success) {
      dispatch({ type: 'LOGIN_FAILED', error: result?.error?.message || '发送失败' });
      return false;
    }
    return true;
  }

  async function loginEmail(email: string, code: string) {
    dispatch({ type: 'LOGIN_START' });
    const result = await window.api.auth.loginEmail(email, code);
    if (result?.success && result.data?.user) {
      dispatch({ type: 'LOGIN_SUCCESS', user: result.data.user });
    } else {
      dispatch({ type: 'LOGIN_FAILED', error: result?.error?.message || '验证码错误' });
    }
  }

  async function logout() {
    await window.api.auth.logout();
    dispatch({ type: 'LOGOUT' });
  }

  return (
    <AuthContext.Provider value={{ state, dispatch, loginGithub, loginGoogle, sendEmailCode, loginEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

### 7.2 Provider 挂载位置

在 `App.tsx` 中，`AuthProvider` 包裹在 `PanelProvider` 外层：

```tsx
// App.tsx
export function App(): JSX.Element {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <AuthProvider>                    {/* 新增 */}
        <PanelProvider>
          <AppContent ... />
        </PanelProvider>
      </AuthProvider>                   {/* 新增 */}
    </I18nProvider>
  );
}
```

### 7.3 登录态与其他功能联动

| 功能 | 联动方式 |
|------|---------|
| Showcase 发布 | `useAuth()` 检查 `state.status === 'authenticated'`，未登录时弹出 LoginModal |
| Marketplace 上传 | 同上 |
| 评分提交 | 同上 |
| API 请求 | 所有需要认证的 API，主进程 handler 从 token-storage 读取 accessToken 附加到请求头 |

组件中使用示例：

```tsx
function PublishButton() {
  const { state, dispatch } = useAuth();

  function handlePublish() {
    if (state.status !== 'authenticated') {
      dispatch({ type: 'OPEN_LOGIN_MODAL' });
      return;
    }
    // 已登录，执行发布
    window.api.showcase.publish({ ... });
  }

  return <button onClick={handlePublish}>发布</button>;
}
```

### 7.4 自动登录

- 应用启动时，`AuthProvider` 的 `useEffect` 调用 `window.api.auth.getStatus()`
- 主进程 `getStatus()` 从 `token-storage` 读取加密 token，检查有效性
- 有效 → 返回 `loggedIn: true` + 用户信息 → 前端自动进入 `authenticated` 状态
- 无效或过期 → 尝试 refresh → 失败则返回 `loggedIn: false`

---

## 8. 文件改造清单

### 8.1 需要修改的现有文件

| 文件 | 改造点 |
|------|--------|
| `src/shared/types/auth.types.ts` | 扩展类型定义，增加 `AuthProvider`、`AuthUser`、`AuthTokens`、`SendCodeResponse` |
| `src/shared/constants/channels.ts` | AUTH 对象新增 `LOGIN_GOOGLE`、`SEND_EMAIL_CODE`、`LOGIN_EMAIL`、`REFRESH_TOKEN`、`AUTH_CALLBACK`、`STATUS_CHANGE` |
| `src/modules/auth/auth-machine.ts` | 重写状态机，支持三种登录方式、新增 `CodeSent` / `Verifying` 状态 |
| `src/modules/auth/github-oauth.ts` | 实现真实 GitHub OAuth PKCE 流程（shell.openExternal + token 交换） |
| `src/modules/auth/token-storage.ts` | 接入 Electron `safeStorage`，实现加密存储和读取 |
| `src/main/ipc/auth-handlers.ts` | 新增 `loginGoogle`、`sendEmailCode`、`loginEmail`、`refreshToken` handler |
| `src/main/index.ts` | 注册 Deep Link 协议、`app.on('open-url')` 处理、单实例锁 |
| `src/preload/index.ts` | auth 域新增 `loginGoogle`、`sendEmailCode`、`loginEmail`、`refreshToken`、`onAuthCallback`、`onStatusChange` |
| `src/preload/api.d.ts` | 类型跟随 preload 更新（自动推导，可能无需手动改） |
| `src/renderer/App.tsx` | 引入 `AuthProvider` 包裹组件树，引入 `LoginModal` |
| `src/renderer/components/layout/MenuBar.tsx` | 右侧新增 `AuthButton` 组件（未登录显示"登录"，已登录显示头像） |
| `electron-builder.yml` | mac 下新增 `protocols` 配置注册 `muxvo://` 协议 |

### 8.2 新增文件

| 文件 | 用途 |
|------|------|
| `src/renderer/contexts/AuthContext.tsx` | Auth 状态管理 Context + Provider + useAuth Hook |
| `src/renderer/components/auth/LoginModal.tsx` | 登录模态框 |
| `src/renderer/components/auth/LoginModal.css` | 登录模态框样式 |
| `src/renderer/components/auth/OAuthButton.tsx` | OAuth 登录按钮组件（GitHub/Google 复用） |
| `src/renderer/components/auth/EmailLoginForm.tsx` | 邮箱验证码登录表单 |
| `src/renderer/components/auth/AuthButton.tsx` | MenuBar 入口按钮 |
| `src/renderer/components/auth/UserDropdown.tsx` | 已登录用户信息下拉 |
| `src/renderer/components/auth/UserDropdown.css` | 下拉样式 |
| `src/modules/auth/google-oauth.ts` | Google OAuth 实现 |
| `src/modules/auth/email-auth.ts` | 邮箱验证码认证逻辑（调后端 API） |
| `src/modules/auth/token-refresh.ts` | Token 自动刷新定时器 |
| `src/modules/auth/deep-link.ts` | Deep Link URL 解析和处理 |

### 8.3 影响范围评估

| 层级 | 影响范围 | 风险等级 |
|------|---------|---------|
| 共享类型 | 类型扩展，向后兼容 | 低 |
| IPC 通道 | 新增通道，不改已有 | 低 |
| 主进程入口 | 新增 Deep Link + 单实例锁，需要测试窗口行为 | 中 |
| 状态机 | 完全重写，需要完整测试覆盖 | 中 |
| Preload | 新增方法，不改已有 | 低 |
| 前端 UI | 新增组件，MenuBar 小改 | 低 |
| electron-builder | 新增协议注册，需要验证 dmg 安装 | 中 |
| 测试 | 需要新增 L1 spec（IPC 契约）、L2（状态机）、L3（登录旅程） | 中 |

---

## 9. 组件层次关系图

```
App.tsx
├── I18nProvider
│   └── AuthProvider (NEW)               ← 全局认证状态
│       └── PanelProvider
│           └── AppContent
│               ├── MenuBar
│               │   ├── ... (existing tabs)
│               │   └── AuthButton (NEW)  ← 登录入口 / 用户头像
│               │       └── UserDropdown (NEW)  ← 点击头像弹出
│               ├── TerminalGrid
│               ├── ... (existing panels)
│               └── LoginModal (NEW)      ← 模态框（三种登录方式）
│                   ├── OAuthButton (NEW) × 2  ← GitHub / Google
│                   └── EmailLoginForm (NEW)   ← 邮箱验证码
```

---

## 附录：关键设计决策总结

| 决策 | 选择 | 理由 |
|------|------|------|
| OAuth 回调方式 | Deep Link (`muxvo://`) | 无需端口监听、更安全 |
| OAuth redirect_uri | 后端中转 | 符合 HTTPS 要求、保护 Client Secret |
| Token 存储 | Electron safeStorage + 文件 | macOS Keychain 级加密 |
| 前端状态管理 | React Context (AuthContext) | 与现有 PanelContext 模式一致 |
| 登录 UI | MenuBar 入口 + 模态框 | 不打断用户工作流 |
| 状态机 | 扩展为 5 状态 | 覆盖 OAuth + 邮箱两种异步流程 |
| 单实例锁 | `app.requestSingleInstanceLock()` | Deep Link 回调需要聚焦已有窗口 |
