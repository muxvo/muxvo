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

# Run all tests (637 tests, runs verify-coverage as pretest)
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
- `auth-handlers.ts` — GitHub OAuth (login/logout/status)
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
| auth | loginGithub, logout, getStatus | — |
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

# Apple notarization (requires keychain profile)
ditto -c -k --keepParent dist/mac-arm64/Muxvo.app /tmp/Muxvo.zip
xcrun notarytool submit /tmp/Muxvo.zip --keychain-profile "muxvo-notary" --wait
xcrun stapler staple dist/mac-arm64/Muxvo.app
```

Config: `electron-builder.yml`. Signing credentials: see `1apple-developer-signing.md` (not in repo).

## Key Documents

- `PRD.md` — Full product requirements (3000+ lines)
- `DEV-PLAN.md` — Technical architecture and IPC protocol spec (1300+ lines)
- `docs/Muxvo_测试_v2/` — Test documentation with 539 test cases across 8 modules
