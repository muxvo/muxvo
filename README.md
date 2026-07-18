# Muxvo

A native macOS terminal and AI workspace — a Swift + AppKit + Metal directly-
rendered terminal with a WKWebView panel UI.

Muxvo is a full rewrite of an earlier Electron app into a native architecture:
a Metal-rendered terminal core for fast input-to-pixel, a multi-terminal grid
workspace, permanent chat-history archiving with full-text search, file and
settings panels, and background auto-update.

## Features

- **Native terminal core** — Swift + Metal direct rendering over a real PTY,
  built on a statically-linked [libghostty](https://github.com/ghostty-org/ghostty) VT/renderer.
- **Multi-terminal workspace** — drag-to-reorder grid, focus mode, list mode
  (`⌘⇧L`), multiple windows (`⌥⌘N`), minimize-to-rail.
- **Chat history** — permanent, cross-install archive with full-text search.
- **File & settings panels** — tabbed file view, skills/MCP/hooks/plugins config.
- **Auto-update** — background download, install on next launch.

## Building

Everything goes through `scripts/app.sh` (the single build entrypoint):

```bash
scripts/app.sh build      # build the native app
scripts/app.sh run        # run it (needs `cd web && npm run dev` on port 5198)
scripts/app.sh test       # full Swift test suite
scripts/app.sh bundle     # assemble Muxvo.app (ad-hoc signed) into the build cache
scripts/app.sh install    # install to /Applications

# web panel
cd web && npm ci && npx vitest run
```

See `CLAUDE.md` for the full development guide, and `probes/VERSIONS.md` for the
pinned toolchain (ghostty / zig versions and how to build the vendored
libghostty artifacts).

## Architecture

- `app/` — the Swift package (SwiftPM). Terminal core, Metal renderer, session
  management, chat, file/settings, Sparkle auto-update.
- `web/` — the WKWebView panel UI (React + TypeScript).
- `bridge/` — the native ↔ web protocol (`protocol.core.json`) and its code
  generator (`codegen.mjs`). Both Swift and TypeScript types are generated.
- `specs/` — behavior specifications (`specs/behavior/`) driven by a spec runner;
  each spec has a 1:1 test.
- `tools/` — the spec runner and the visual-regression harness.
- `probes/` — standalone probes and benchmark hosts.

### Open core

This repository is the **open core** of Muxvo. The **orchestration engine** (the
AI task pipeline / task command center) is a separate proprietary component and
is not included here. The code in this repository builds and runs fully without
it — orchestration is wired into official builds through a thin seam
(`OrchLauncher` / `OrchGate`), which is a no-op stub in this repository. That is
the intended behavior; nothing here depends on the orchestration engine.

## License

GPL-3.0-or-later. See [`LICENSE`](LICENSE) and
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). Contributions are accepted
under a CLA — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
