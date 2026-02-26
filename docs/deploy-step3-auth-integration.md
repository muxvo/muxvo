# Step 3: Phase 5 — 客户端-后端集成检查报告

## 1. 后端 URL 环境切换

**文件**: `src/main/ipc/auth-handlers.ts:17-24`

**状态**: 已就绪 (本次修改)

**逻辑**:
```
优先级: MUXVO_API_URL 环境变量 > app.isPackaged 判断
- 开发环境 (!app.isPackaged): http://localhost:3000
- 生产环境 (app.isPackaged): https://api.muxvo.com
- 可通过 MUXVO_API_URL 覆盖任意环境
```

**本次修改**:
- 原代码: `process.env.MUXVO_API_URL || 'https://api.muxvo.com'` (开发环境默认打生产)
- 改为: `process.env.MUXVO_API_URL || (app?.isPackaged ? 'https://api.muxvo.com' : 'http://localhost:3000')`
- `app?.isPackaged` 使用可选链，确保在测试环境 (Node, 无 Electron runtime) 不会崩溃

**额外修改**:
- `logout` handler 从旧的 `oauthLogout` (仅清内存变量) 改为 `manager.logout()` (服务器 revoke + 本地清理)
- `getStatus` handler 从旧的 `getAuthStatus` (仅读内存变量) 改为 `manager.getStatus()` (读状态机)
- 移除了不再使用的 `@/modules/auth/github-oauth` 导入

## 2. Deep Link 协议

**状态**: 已就绪

### electron-builder.yml
```yaml
protocols:
  - name: Muxvo
    schemes:
      - muxvo
```
`muxvo://` 协议已注册。

### src/main/index.ts 深层链接处理

| 平台 | 机制 | 代码位置 | 状态 |
|------|------|---------|------|
| macOS | `app.on('open-url')` (line 118-125) | 支持 app ready 前缓存 URL | OK |
| macOS | `app.setAsDefaultProtocolClient('muxvo')` (line 221) | 仅 `app.isPackaged` 时注册 | OK |
| Windows/Linux | `app.on('second-instance')` (line 128-139) | 从 argv 提取 `muxvo://` URL | OK |

### 回调格式
```
muxvo://auth/callback?accessToken=...&refreshToken=...
```
`handleDeepLink()` (line 76-109):
- 验证 `protocol === 'muxvo:'`, `host === 'auth'`, `pathname === '/callback'`
- 提取 `accessToken` 和 `refreshToken` 参数
- 调用 `manager.handleOAuthCallback()` 完成登录
- 登录成功后通过 `pushToAllWindows(IPC_CHANNELS.AUTH.STATUS_CHANGE, ...)` 通知渲染进程

## 3. 三种登录方式客户端代码

### 3.1 GitHub OAuth

**流程**: `loginGithub()` → `manager.loginGithub()` → `client.initGithubAuth()` → 返回 `authUrl` → `shell.openExternal(authUrl)` → 浏览器跳转 → 服务器回调 → deep link `muxvo://auth/callback?...` → `handleDeepLink()` → `handleOAuthCallback()` → `getUserProfile()` → LoggedIn

**文件链**:
- `auth-handlers.ts:29-38` — IPC handler
- `auth-manager.ts:67-71` — manager 层
- `backend-client.ts:73-75` — HTTP `POST /auth/github/init`

**状态**: 完整

### 3.2 Google OAuth

**流程**: 与 GitHub 完全一致，仅 API 端点不同 (`/auth/google/init`)。

**文件链**:
- `auth-handlers.ts:65-75` — IPC handler
- `auth-manager.ts:74-78` — manager 层
- `backend-client.ts:78-80` — HTTP `POST /auth/google/init`

**状态**: 完整

### 3.3 Email 验证码

**流程**: `sendEmailCode(email)` → `client.sendEmailCode(email)` → 返回 `{ success, expiresIn }` → 用户输入验证码 → `verifyEmailCode(email, code)` → `client.verifyEmailCode()` → 返回 tokens + user → `storeTokenPair()` → LoggedIn

**文件链**:
- `auth-handlers.ts:77-97` — 发送 + 验证两个 IPC handler
- `auth-manager.ts:81-107` — manager 层处理状态机转换
- `backend-client.ts:83-96` — HTTP `POST /auth/email/send` + `POST /auth/email/verify`

**状态**: 完整

## 4. Token 管理

### 4.1 Token 存储

**文件**: `src/modules/auth/token-storage.ts`

| 存储方式 | 条件 | 安全级别 |
|---------|------|---------|
| `safeStorage` (macOS Keychain) | Electron + `safeStorage.isEncryptionAvailable()` | 高 |
| `plaintext` JSON | Electron + 无 safeStorage | 低 |
| `memory` | 测试环境 (非 Electron) | N/A |

存储路径: `{userData}/.auth-token`
写入方式: atomic write (tmp + rename)

### 4.2 自动刷新定时器

**文件**: `src/main/services/auth/auth-manager.ts:28-48`

- 间隔: `12 * 60 * 1000` ms (12 分钟, access token 15 分钟过期前刷新)
- 行为: 取 stored refreshToken → `client.refreshToken()` → `storeTokenPair()` → `machine.send('TOKEN_REFRESH')`
- 失败处理: `machine.send('REFRESH_FAILED')` → 停止定时器 → `clearToken()` → 回到 LoggedOut

### 4.3 Refresh Token Rotation 检测

服务器端实现 (rotation detection 在 `server/src/routes/auth.ts`)。客户端在 `refreshToken()` 调用时:
- 服务器返回新的 `{ accessToken, refreshToken }` 对 (rotation)
- 客户端用 `storeTokenPair()` 存储新的两个 token
- 如果服务器检测到 refreshToken 重用 (被盗用)，返回错误 → 客户端 `clearToken()` → 强制登出

### 4.4 Session 恢复 (`tryRestoreSession()`)

**文件**: `src/main/services/auth/auth-manager.ts:190-228`

启动流程:
1. `getTokenPair()` 从文件/缓存读取 tokens
2. 如果无 tokens → `{ success: false }` 返回
3. 用 accessToken 调用 `getUserProfile()`:
   - 成功: 设置状态机 → `startRefreshTimer()` → 返回 user
   - 失败 (token 过期): 尝试 `refreshToken()` → 重新 `getUserProfile()`:
     - 成功: 设置状态机 → `startRefreshTimer()` → 返回 user
     - 失败: `clearToken()` → `{ success: false }` (静默登出)

调用时机: `src/main/index.ts:436-452` — 在 `did-finish-load` + 500ms 延迟后执行，确保渲染进程已就绪接收 push events。

## 5. IPC Channel 总览

| Channel | Handler | Preload | 状态 |
|---------|---------|---------|------|
| `auth:login-github` | `loginGithub()` | `auth.loginGithub()` | OK |
| `auth:logout` | `logout()` | `auth.logout()` | OK (已切换到 manager) |
| `auth:get-status` | `getStatus()` | `auth.getStatus()` | OK (已切换到 manager) |
| `auth:login-google` | `loginGoogle()` | `auth.loginGoogle()` | OK |
| `auth:send-email-code` | `sendEmailCode()` | `auth.sendEmailCode()` | OK |
| `auth:verify-email-code` | `verifyEmailCode()` | `auth.verifyEmailCode()` | OK |
| `auth:oauth-callback` | `oauthCallback()` | `auth.oauthCallback()` | OK |
| `auth:refresh-token` | `refreshToken()` | `auth.refreshToken()` | OK |
| `auth:get-profile` | `getProfile()` | `auth.getProfile()` | OK |
| `auth:session-expired` | push: `pushSessionExpired()` | `auth.onSessionExpired()` | OK |
| `auth:status-change` | push: `pushToAllWindows()` | `auth.onStatusChange()` | OK |

## 6. E2E 测试操作手册

### 前提条件
1. 后端服务器运行中: `cd server && npm run dev` (默认 `http://localhost:3000`)
2. Muxvo 开发模式运行: `nohup npx electron-vite dev > /dev/null 2>&1 & disown`

### 6.1 GitHub OAuth 登录

1. 在 Muxvo 设置面板点击 "GitHub 登录"
2. 确认浏览器打开 GitHub 授权页面 (URL 包含 `/auth/github/init` 返回的 authUrl)
3. 在 GitHub 页面授权
4. 确认浏览器跳转到 `muxvo://auth/callback?accessToken=...&refreshToken=...`
5. 确认 Muxvo 自动接收 deep link, 控制台打印 `[MUXVO:deeplink] OAuth callback success`
6. 确认 UI 显示已登录状态 (用户名/头像)

### 6.2 Google OAuth 登录

1. 先登出 (如已登录)
2. 点击 "Google 登录"
3. 确认浏览器打开 Google 授权页面
4. 在 Google 页面授权
5. 同 6.1 步骤 4-6

### 6.3 Email 验证码登录

1. 先登出
2. 输入邮箱地址，点击 "发送验证码"
3. 确认返回 `{ success: true, expiresIn: ... }`
4. 从邮箱获取验证码
5. 输入验证码，点击 "验证"
6. 确认 UI 显示已登录状态

### 6.4 Token 刷新验证

1. 完成任意方式登录
2. 等待 12 分钟 (或临时修改 `TOKEN_REFRESH_INTERVAL_MS` 为 30000 进行加速测试)
3. 观察控制台，确认无 `REFRESH_FAILED` 日志
4. 调用 DevTools → `window.api.auth.getStatus()` 确认仍为 `{ loggedIn: true }`

### 6.5 Session 恢复验证

1. 完成登录后关闭 Muxvo
2. 重新启动 Muxvo
3. 观察控制台 `[MUXVO:auth] Session restored for user: ...`
4. 确认 UI 自动显示已登录状态 (无需重新登录)

### 6.6 登出验证

1. 点击登出
2. 确认 UI 显示未登录状态
3. 确认 `{userData}/.auth-token` 文件已删除
4. 重启 Muxvo，确认不会自动登录

## 7. 已知问题 / 待确认项

| # | 项目 | 说明 |
|---|------|------|
| 1 | macOS 开发模式 deep link | `app.setAsDefaultProtocolClient('muxvo')` 仅在 `app.isPackaged` 时注册。开发模式需手动注册或在 Info.plist 中配置，否则 deep link 无法自动唤起 Muxvo |
| 2 | `pushSessionExpired` 未调用 | `pushSessionExpired()` 已导出但目前没有代码调用它。当 refresh 失败时，manager 会 `clearToken()` + `REFRESH_FAILED` 但不会主动 push session expired 到渲染进程。建议在 `startRefreshTimer` 的 catch 块中加入 `pushSessionExpired()` 调用 |
| 3 | 旧 `github-oauth.ts` 模块 | 文件 `src/modules/auth/github-oauth.ts` 已无任何导入者，可安全删除 |
| 4 | entitlements.mac.plist | 当前 entitlements 未包含 `com.apple.security.network.client`。虽然 Electron Hardened Runtime 默认允许网络，但若 Apple 未来收紧政策可考虑显式添加 |
