# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Muxvo is an Electron desktop workbench for AI CLI tools (Claude Code, Codex, Gemini CLI). It provides terminal management, chat history browsing, config editing, a rich editor, and a V2 Skill marketplace with AI scoring and showcase publishing.

## Commands

```bash
# Run all tests (609 tests, runs verify-coverage as pretest)
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
├── services/   ← Core logic     ├── features/     ← Feature stores/views
                                  ├── stores/       ← State management
                                  └── utils/        ← UI utilities
```

Communication is exclusively through IPC channels organized by domain: `terminal:*`, `chat:*`, `fs:*`, `config:*`, `marketplace:*`, `score:*`, `showcase:*`.

### Source Code Layout

- **`src/shared/`** — Cross-process code: types (14 files), state machines, utility functions, error definitions, constants
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

### Key Design Patterns

- **State machines**: All use `createXxxMachine()` → `{ get state, get context, send(event, payload?) }`. States are string literals, transitions are switch-case. See `src/shared/machines/terminal-process.ts` as reference.
- **Stores**: Factory functions like `createXxxStore()` returning objects with `dispatch(action)`, `getState()`, and domain-specific getters.
- **Services**: Factory functions like `createXxxManager()` returning async method objects.

## Key Documents

- `PRD.md` — Full product requirements (3000+ lines)
- `DEV-PLAN.md` — Technical architecture and IPC protocol spec (1300+ lines)
- `docs/Muxvo_测试_v2/` — Test documentation with 539 test cases across 8 modules
