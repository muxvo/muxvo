# Muxvo

A desktop workbench for AI CLI tools -- Claude Code, Codex, and Gemini CLI.

Muxvo provides a unified interface for managing terminal sessions, browsing chat histories, editing configurations, and discovering skills through a built-in marketplace.

<!-- Screenshots coming soon -->

## Features

- **Terminal Management** -- Create, resize, and manage multiple AI CLI terminal sessions side by side
- **Chat History Browser** -- Browse and search conversation history across Claude Code and Codex with multi-source aggregation
- **Configuration Editor** -- Edit settings and CLAUDE.md files with atomic write protection
- **Rich Text Editor** -- TipTap-based editor with Markdown support
- **Skill Marketplace** -- Discover, install, and manage skills with AI-powered scoring and showcase publishing
- **GitHub Authentication** -- OAuth-based login for marketplace and showcase features
- **Analytics Dashboard** -- Track usage across sessions and tools

## Installation

Download the latest `.dmg` from [GitHub Releases](https://github.com/anthropics/muxvo/releases) (macOS arm64).

## Development

### Prerequisites

- Node.js 20+
- npm 10+

### Setup

```bash
npm install
```

### Run in development mode

```bash
nohup npx electron-vite dev > /dev/null 2>&1 &
disown
```

### Run tests

```bash
# Run all tests (637 tests across 3 layers)
npm test

# Run tests by layer
npm run test:l1          # L1 unit/contract tests
npm run test:l2          # L2 integration/rule tests
npm run test:l3          # L3 end-to-end user journey tests

# Run a single test file
npx vitest run tests/l2/chat.test.ts
```

### Build for production

```bash
npm run build
npx electron-vite build && npx electron-builder --mac --arm64
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Electron 34 |
| UI | React 19 |
| Language | TypeScript 5.9 |
| Terminal | XTerm.js |
| Editor | TipTap |
| Testing | Vitest (3-layer architecture) |
| Build | electron-vite, electron-builder |

## Architecture

Muxvo follows the standard Electron two-process model:

```
Main Process (src/main/)          Renderer Process (src/renderer/)
  ipc/        IPC handlers          components/   UI components
  services/   Core logic            contexts/     React contexts
                                    features/     Feature stores/views
                                    hooks/        Custom React hooks
                                    stores/       State management
```

The two processes communicate exclusively through IPC channels organized into 10 domains with 60 total channels:

`terminal` | `fs` | `chat` | `config` | `app` | `auth` | `marketplace` | `score` | `showcase` | `analytics`

Each domain exposes methods and push events through a typed `window.api` surface in the renderer.

### Multi-Source Chat

Chat history aggregates from multiple AI CLI tools into a unified view:

- **Claude Code** -- reads from `~/.claude/projects/`
- **Codex** -- reads from `~/.codex/sessions/`

Sessions from the same project directory are merged automatically.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines and contribution workflow.

## License

[MIT](LICENSE)
