# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Muxvo is an Electron desktop workbench for AI CLI tools (Claude Code, Codex, Gemini CLI). It provides terminal management, chat history browsing, config editing, a rich editor, and a V2 Skill marketplace with AI scoring and showcase publishing.

## 启动 Muxvo

启动 Muxvo 时必须使用 `nohup` + `disown`，确保关闭 Claude Code 后 Muxvo 不会被终止：

```bash
nohup npx electron-vite dev > /dev/null 2>&1 &
disown
```

## Commands

```bash
# Build for production
npm run build

# Run all tests (534 tests, runs verify-coverage as pretest)
npm test

# Run tests by layer
npm run test:l1          # L1 unit/contract tests
npm run test:l2          # L2 integration/rule tests
npm run test:l3          # L3 end-to-end user journey tests

# Run a single test file
npx vitest run tests/l2/chat.test.ts

# Run tests matching a pattern
npx vitest run -t "TERM_L1_01"

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Verify JSON spec ↔ test code 1:1 match (also runs as pretest)
npm run verify:coverage

# Type check
npx tsc --noEmit
```

## Playwright E2E Testing (Electron)

Muxvo 是 Electron 应用，E2E 测试需要特殊的启动方式：

**前提条件**: `npx electron-vite dev` 必须正在运行（vite renderer server 在 5173 端口）。

**在测试脚本中启动 Electron**:

```js
import { _electron } from '@playwright/test';

const app = await _electron.launch({
  args: [resolve(PROJECT, 'out/main/index.js')],
  cwd: PROJECT,
  env: { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' },
});
const window = await app.firstWindow();
await window.waitForTimeout(6000); // 等待 React 挂载
await window.waitForLoadState('networkidle');
```

**常见错误**:
- 白屏 (body 84 chars) → vite server 没在跑，或没设 `ELECTRON_RENDERER_URL`
- `is.dev` 始终为 true → 来自 `@electron-toolkit/utils`，检查 `app.isPackaged`（未打包=true），设 `NODE_ENV` 无效
- `window.api` undefined → 不能用 `chromium.launch()` + `page.goto()`，必须用 `_electron.launch()` 才有 preload

## Architecture

### Process Model (Electron)

```
Main Process (src/main/)          Renderer Process (src/renderer/)
├── ipc/        ← IPC handlers   ├── components/   ← UI components
├── services/   ← Core logic     ├── contexts/     ← React contexts
                                  ├── features/     ← Feature stores/views
                                  ├── hooks/        ← Custom React hooks
                                  ├── stores/       ← State management
                                  ├── styles/       ← Global styles
                                  └── utils/        ← UI utilities
```

Communication is exclusively through IPC channels organized by 10 domains (`src/shared/constants/channels.ts`): `terminal:*`, `fs:*`, `chat:*`, `config:*`, `app:*`, `auth:*`, `marketplace:*`, `score:*`, `showcase:*`, `analytics:*`. All 60 channels are fully wired (handler + preload + renderer).

### Source Code Layout

- **`src/shared/`** — Cross-process code: types (12 files), state machines, utility functions, error definitions, constants
- **`src/shared/machines/`** — State machines using simple class pattern (NO XState). Each exports a `create*Machine()` factory returning `{ state, context, send() }`
- **`src/modules/`** — 15 domain modules (app, auth, chat, community, config, data, editor, file, marketplace, onboarding, publish, score, security, showcase, terminal). These are higher-level orchestrators used primarily by L3 tests
- **`src/main/services/`** — Main process business logic (terminal manager, chat sync, file watcher, marketplace installer, etc.)
- **`src/renderer/features/`** — Feature-scoped UI logic (file-panel, temp-view, config-manager, marketplace store)

### Path Aliases

- `@/*` → `./src/*`
- `@tests/*` → `./tests/*`

Configured in both `tsconfig.json` and `vitest.config.ts`. The `tests/setup.ts` file patches Node's `require()` to resolve `@/` paths and compile `.ts` via esbuild at runtime.

### Test Architecture (3-Layer)

| Layer | Directory | Purpose | Style |
|-------|-----------|---------|-------|
| L1 | `tests/l1/` | IPC contracts, default values, data shapes | JSON-driven via `test.each` from `tests/specs/l1/*.spec.json` |
| L2 | `tests/l2/` | State machines, business rules, boundaries | Mixed: JSON-driven for simple rules + hand-written for complex logic |
| L3 | `tests/l3/` | Multi-step user journeys, cross-module flows | Hand-written, imports from `src/modules/` |

**JSON Spec System**: 225 test cases defined in `tests/specs/` (L1 + L2 simple rules). The verification script `tests/scripts/verify-coverage.ts` ensures 1:1 match between JSON spec IDs and test functions. It detects both static `test('ID: ...')` and dynamic `test.each(...)('$id: ...')` patterns.

**Test helpers** (`tests/helpers/`): `mock-ipc.ts` (IPC channel mocking), `mock-electron.ts` (Electron API stubs), `test-fixtures.ts` (shared test data).

### IPC Handler Pattern

All IPC handlers live in `src/main/ipc/*-handlers.ts` and follow a two-function pattern:

```typescript
// Factory returns handler methods
export function createXxxHandlers() {
  return { async method1(params), async method2(params), ... };
}
// Registration wires to ipcMain.handle
export function registerXxxHandlers(): void {
  const h = createXxxHandlers();
  ipcMain.handle(IPC_CHANNELS.XXX.METHOD, (_e, p) => h.method(p));
}
```

All 12 handler files in `src/main/ipc/`:
- `terminal-handlers.ts` — accepts manager instance + persistence callback
- `chat-handlers.ts` — multi-source reader (CC + Codex + archive) for history/session
- `config-handlers.ts` — resource scanning, settings/CLAUDE.md with atomic writes
- `fs-handlers.ts`, `fs-watcher-handlers.ts`, `fs-image-handlers.ts` — file ops, watch, temp images
- `app-handlers.ts` — preferences + CLI detection with format conversion
- `auth-handlers.ts` — Multi-method auth: GitHub OAuth + Google OAuth + Email verification
- `marketplace-handlers.ts` — fetch sources, search, install/uninstall, updates + 3 push events
- `score-handlers.ts` — run scorer, check/get-cached + 2 push events
- `showcase-handlers.ts` — generate/publish/unpublish + publish-result push
- `analytics-handlers.ts` — track/getSummary/clear with DI tracker (`createAnalyticsHandlers(tracker)`)

All registered in `src/main/index.ts` at app startup. Legacy stub exports (e.g., `configHandlers`) maintained for L1 test compatibility.

### Preload API Surface

`window.api` exposes 10 domains to the renderer (type: `MuxvoAPI`):

| Domain | Methods | Push events (on*) |
|--------|---------|-------------------|
| terminal | create, write, resize, close, list, getState, getBuffer, getForegroundProcess, updateCwd | onOutput, onStateChange, onExit, onListUpdated |
| app | getConfig, saveConfig, getPreferences, savePreferences, detectCliTools, getHomePath | onMemoryWarning |
| fs | selectDirectory, readDir, readFile, writeFile, watchStart, watchStop, writeTempImage, writeClipboardImage | onFileChange |
| chat | getHistory, getSession, search, export | onSessionUpdate, onSyncStatus |
| config | getResources, getResourceContent, getSettings, saveSettings, getClaudeMd, saveClaudeMd, getMemory | onResourceChange |
| auth | loginGithub, loginGoogle, loginEmail, verifyEmail, logout, getStatus | — |
| marketplace | fetchSources, search, install, uninstall, getInstalled, checkUpdates | onInstallProgress, onPackagesLoaded, onUpdateAvailable |
| score | checkScorer, run, getCached | onProgress, onResult |
| showcase | generate, publish, unpublish | onPublishResult |
| analytics | track, getSummary, clear | — |

All `on*` event listeners return an unsubscribe cleanup function.

### Key Design Patterns

- **State machines**: All use `createXxxMachine()` → `{ get state, get context, send(event, payload?) }`. States are string literals, transitions are switch-case. See `src/shared/machines/terminal-process.ts` as reference.
- **Stores**: Factory functions like `createXxxStore()` returning objects with `dispatch(action)`, `getState()`, and domain-specific getters.
- **Services**: Factory functions like `createXxxManager()` returning async method objects.
- **Push events (M→R)**: Handlers use `pushToAllWindows(channel, payload)` helper with `!win.isDestroyed()` guard to broadcast events to renderer.
- **Dependency injection**: `analytics-handlers.ts` uses DI (`createAnalyticsHandlers(tracker)`); `registerAnalyticsHandlers()` creates the tracker internally.
- **Atomic writes**: Config/settings files use tmp + rename pattern to prevent corruption.
- **Path security**: File access handlers validate paths against allowed directories (e.g., `~/.claude/`, `~/.muxvo/`).

### Multi-Source Chat Architecture

Chat history reads from both Claude Code (`~/.claude/projects/`) and Codex (`~/.codex/sessions/`):

```
chat-handlers.ts → chat-multi-source.ts (aggregator)
                        ├── chat-dual-source.ts (CC reader + archive)
                        └── codex-chat-source.ts (Codex reader)
```

- Same project directory merges into one project (same `projectHash`)
- `SessionSummary.source` field (`'claude-code'` | `'codex'`) identifies origin
- Config/skills scanning also supports both `~/.claude/` and `~/.codex/` paths

### Build & Packaging

```bash
# Dev build + package (arm64 Mac)
npx electron-vite build && npx electron-builder --mac --arm64

# Dev build + package (Intel Mac)
npx electron-vite build && npx electron-builder --mac --x64

# Apple notarization (requires keychain profile)
ditto -c -k --keepParent dist/mac-arm64/Muxvo.app /tmp/Muxvo.zip
xcrun notarytool submit /tmp/Muxvo.zip --keychain-profile "muxvo-notary" --wait
xcrun stapler staple dist/mac-arm64/Muxvo.app
```

**Note**: node-pty 交叉编译不可靠。arm64 必须在 Apple Silicon 上构建，x64 必须在 Intel Mac（或 CI 的 macos-13 runner）上构建。

Config: `electron-builder.yml`. Signing credentials: see `1apple-developer-signing.md` (not in repo).

### Release Workflow (发版流程)

**发版只需两步，其余全自动：**

1. 修改 `package.json` 的 `version` 字段
2. 提交、打 tag、推送：

```bash
git add package.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

**CI 自动完成（`.github/workflows/release.yml`）：**
- 运行测试
- **并行构建 arm64 (macos-14) + x64 (macos-13) 两个架构**
- Apple 签名 + 公证（两个架构各自签名）
- 合并 `latest-mac.yml`（electron-updater 自动更新用）
- 上传到 GitHub Releases（含两个架构的 DMG + ZIP + 稳定链接）
- 自动部署两个 DMG 到官网服务器：
  - `https://muxvo.com/download/Muxvo-arm64.dmg` 始终指向最新 arm64 版
  - `https://muxvo.com/download/Muxvo-x64.dmg` 始终指向最新 Intel 版
- 官网自动检测用户 Mac 架构（WebGL renderer），提供对应下载链接

**所需 GitHub Secrets：** `SERVER_SSH_KEY`, `SERVER_HOST`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

## Key Documents

- `PRD.md` — Full product requirements (3000+ lines)
- `DEV-PLAN.md` — Technical architecture and IPC protocol spec (1300+ lines)
- `docs/Muxvo_测试_v2/` — Test documentation with 539 test cases across 8 modules
- `docs/deployment-plan.md` — Cloud deployment plan (Phase 0-5)

## Cloud Infrastructure

- **GitHub**: `muxvo` org — `muxvo/muxvo` (Public) + `muxvo/server` (Private)
- **Server**: Aliyun Hong Kong ECS, Ubuntu 24.04
- **Domains**: `muxvo.com` (web), `api.muxvo.com` (Fastify API), `admin.muxvo.com` (admin panel)
- **CI/CD**: `.github/workflows/` — `ci.yml`, `deploy-server.yml`, `deploy-web.yml`, `release.yml`

### Subproject Layout

| Directory | Stack | Purpose |
|-----------|-------|---------|
| `server/` | Fastify 5 + PostgreSQL 16 + Redis 7 | Backend API (auth, user, showcase, analytics) |
| `web/` | React 19 + Vite + Tailwind CSS v4 | Public website at muxvo.com |
| `admin/` | React 19 + Vite + Tailwind CSS | Admin panel (stub) |

### Auth Architecture

Three login methods (`AuthMethod = 'github' | 'google' | 'email'`):

```
src/modules/auth/auth-machine.ts   — State machine: LoggedOut → Authorizing → ExchangingToken → LoggedIn
src/main/services/auth/
  ├── auth-manager.ts              — Orchestrator (login flow, token refresh)
  └── backend-client.ts            — HTTP client for api.muxvo.com/auth/*
server/src/routes/auth.ts          — Backend: OAuth callbacks, JWT RS256, email verification
server/src/services/email.ts       — Email sending via Resend API
```
