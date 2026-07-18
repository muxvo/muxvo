# Contributing to Muxvo

Thanks for your interest in contributing! Muxvo is free software under
GPL-3.0-or-later, and we welcome bug reports, fixes, and improvements.

## Contributor License Agreement (CLA)

Before we can merge your first pull request, you'll be asked to sign our
Contributor License Agreement. This is automated via **[cla-assistant](https://cla-assistant.io/)**:
open a PR and a bot will comment with a one-click sign-in link.

The CLA lets the Muxvo project hold the full copyright to the combined work,
which is what allows us to ship the official build that combines this open-core
with our proprietary orchestration engine. Your contributions remain available
to everyone under GPL-3.0. (This is the same model Zed uses.)

## What's in this repository (and what isn't)

This repository is the **open core** of Muxvo: the native terminal (PTY + Metal
renderer), the multi-terminal workspace, chat history, the file/settings panels,
and the automatic updater.

The **orchestration engine** (the AI task pipeline / "task command center") is a
proprietary component and is **not** part of this repository. The code here
builds and runs fully without it — orchestration is wired in only in official
builds. You will see a thin seam (`OrchLauncher`, `OrchGate`) where it plugs in;
in this repository that seam is a no-op stub, which is the intended behavior.

## Development

Prerequisites and build/test commands live in `CLAUDE.md` and `scripts/app.sh`:

```bash
scripts/app.sh build      # build the native app
scripts/app.sh test       # run the Swift test suite
cd web && npm ci && npx vitest run   # web panel tests
node bridge/codegen.mjs --check      # verify the bridge protocol is in sync
```

Please run these before opening a PR. New behavior should come with a spec in
`specs/behavior/` and a matching test (spec ↔ test 1:1).

## Reporting bugs

Open an issue with steps to reproduce, your macOS version, and any relevant
output from the terminal. For security-sensitive reports, please contact the
maintainers privately rather than filing a public issue.
