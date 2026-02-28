# Muxvo

[![Website](https://img.shields.io/badge/Website-muxvo.com-orange.svg)](https://muxvo.com)
[![CI](https://github.com/muxvo/muxvo/actions/workflows/ci.yml/badge.svg)](https://github.com/muxvo/muxvo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Download](https://img.shields.io/badge/Download-macOS_arm64-blue.svg)](https://muxvo.com/download/Muxvo-arm64.dmg)

Desktop workbench for AI CLI tools — Claude Code, Codex, and Gemini CLI.

Using AI CLI tools in the terminal means constant window switching, lost chat history, and scattered configs. Muxvo puts everything in one place so you can focus on building.

**[muxvo.com](https://muxvo.com)**

![Muxvo Screenshot](screenshot.jpg)

## Why Muxvo?

**Chat history disappears** — Claude Code auto-deletes conversations after 30 days. Muxvo saves them locally forever. Find any past conversation and resume it with one click.

**Too many windows** — Running multiple CC sessions means endless ⌘Tab. Muxvo tiles all terminals on one screen — see everything at a glance.

**Focused mode** — Maximize one terminal while the rest stay in a sidebar. Big screen for code, small screen for progress.

**Configs are scattered** — Skills, MCP servers, CLAUDE.md files are spread across directories. Muxvo auto-scans and shows them all in one panel.

**Not just Claude Code** — Codex and Gemini CLI sessions, skills, and chat histories all managed in the same interface.

## Features

- **Multi-Terminal Tiling** — Create, resize, and tile multiple AI CLI sessions side by side
- **Permanent Chat History** — Browse and search conversations across Claude Code and Codex, saved locally forever
- **Focused Mode** — Maximize one terminal with sidebar thumbnails for quick switching
- **Skill & MCP Viewer** — Auto-scan and browse all locally installed Skills and MCP servers
- **Multi-Tool Support** — Unified interface for Claude Code, Codex, and Gemini CLI

## Download

**[muxvo.com/download/Muxvo-arm64.dmg](https://muxvo.com/download/Muxvo-arm64.dmg)** (macOS arm64)

Or from [GitHub Releases](https://github.com/muxvo/muxvo/releases).

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
npx electron-vite dev
```

### Run tests

```bash
# All tests (3-layer architecture)
npm test

# By layer
npm run test:l1          # L1 unit/contract tests
npm run test:l2          # L2 integration/rule tests
npm run test:l3          # L3 end-to-end user journey tests
```

### Build for production

```bash
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
| Testing | Vitest |
| Build | electron-vite, electron-builder |

## Architecture

```
Main Process (src/main/)          Renderer Process (src/renderer/)
  ipc/        IPC handlers          components/   UI components
  services/   Core logic            contexts/     React contexts
                                    features/     Feature stores/views
                                    hooks/        Custom React hooks
                                    stores/       State management
```

IPC channels organized into 10 domains: `terminal` · `fs` · `chat` · `config` · `app` · `auth` · `marketplace` · `score` · `showcase` · `analytics`

## Feedback

Questions, suggestions, or bug reports: **drl330330@gmail.com**

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

[MIT](LICENSE)
