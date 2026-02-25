# Contributing to Muxvo

Thank you for your interest in contributing to Muxvo. This guide covers everything you need to get started.

## Development Environment

**Requirements:**

- Node.js 20 or later
- npm
- macOS (required -- Electron + node-pty native modules depend on macOS build tooling)

## Quick Start

```bash
git clone https://github.com/muxvo/muxvo.git
cd muxvo
npm install
nohup npx electron-vite dev > /dev/null 2>&1 & disown
```

The `nohup` + `disown` pattern ensures the Electron dev process keeps running if you close your terminal.

## Running Tests

Muxvo uses a 3-layer test architecture with 637 tests total.

```bash
# Run all tests (includes spec coverage verification as pretest)
npm test

# Run tests by layer
npm run test:l1          # L1: IPC contracts, default values, data shapes
npm run test:l2          # L2: State machines, business rules, boundaries
npm run test:l3          # L3: Multi-step user journeys, cross-module flows

# Run a single test file
npx vitest run tests/l2/chat.test.ts

# Run tests matching a pattern
npx vitest run -t "TERM_L1_01"

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Verify JSON spec <-> test code 1:1 match
npm run verify:coverage

# Type check
npx tsc --noEmit
```

**Test layers explained:**

| Layer | Directory | Purpose | Style |
|-------|-----------|---------|-------|
| L1 | `tests/l1/` | IPC contracts, default values, data shapes | JSON-driven via `test.each` from spec files |
| L2 | `tests/l2/` | State machines, business rules, boundaries | Mixed: JSON-driven + hand-written |
| L3 | `tests/l3/` | Multi-step user journeys, cross-module flows | Hand-written, imports from `src/modules/` |

L1 and L2 use JSON spec files in `tests/specs/`. The verification script `tests/scripts/verify-coverage.ts` ensures every spec ID has a corresponding test function.

## Code Style

- **TypeScript strict mode** is enabled across the project.
- **Path aliases**: Use `@/*` to reference `src/*` (e.g., `import { foo } from '@/shared/utils'`). The alias `@tests/*` maps to `tests/*`.
- **Factory function pattern**: Follow the `createXxxManager()` / `createXxxStore()` / `createXxxMachine()` naming convention for services, stores, and state machines.
- **IPC handlers**: Follow the two-function pattern -- a `createXxxHandlers()` factory that returns handler methods, and a `registerXxxHandlers()` function that wires them to `ipcMain.handle`.
- **State machines**: Use simple class pattern with `{ get state, get context, send(event, payload?) }`. No XState.
- **Atomic writes**: Config and settings files must use the tmp + rename pattern to prevent corruption.

## Project Architecture

Muxvo is an Electron application with a clear process boundary:

```
Main Process (src/main/)          Renderer Process (src/renderer/)
  ipc/        -- IPC handlers       components/   -- UI components
  services/   -- Core logic          contexts/     -- React contexts
                                     features/     -- Feature stores/views
                                     hooks/        -- Custom React hooks
                                     stores/       -- State management
                                     styles/       -- Global styles
                                     utils/        -- UI utilities
```

All communication between Main and Renderer goes through IPC channels, organized by 10 domains: `terminal`, `fs`, `chat`, `config`, `app`, `auth`, `marketplace`, `score`, `showcase`, `analytics`. See `src/shared/constants/channels.ts` for the full channel list.

Other key directories:

- `src/shared/` -- Cross-process types, state machines, utilities, constants
- `src/modules/` -- 15 domain modules (higher-level orchestrators)

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. Make your changes, following the code style above.
3. **Ensure all tests pass**: Run `npm test` (this also runs `verify:coverage` as a pretest step).
4. **Run type checking**: `npx tsc --noEmit` should produce no errors.
5. Submit a pull request against `main` with a clear description of what changed and why.
6. Wait for code review. Address any feedback and push updates to your branch.

Keep PRs focused. One feature or fix per PR is preferred over large, multi-concern changes.

## Issue Guidelines

**Bug reports** should include:

- A clear description of the problem
- Steps to reproduce
- Expected behavior vs. actual behavior
- macOS version and Node.js version

**Feature requests** should include:

- The use case: what problem are you trying to solve?
- A proposed solution (if you have one)
- Any alternatives you considered

## Code of Conduct

We are committed to a welcoming and inclusive community. All participants are expected to:

- Be respectful and considerate in all interactions
- Welcome newcomers and help them get started
- Accept constructive criticism gracefully
- Focus on what is best for the project and community
- Refrain from harassment, discrimination, or personal attacks

Maintainers may remove, edit, or reject contributions that do not align with these principles.
