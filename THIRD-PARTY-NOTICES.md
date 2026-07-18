# Third-Party Notices

Muxvo is licensed under GPL-3.0-or-later (see `LICENSE`). It bundles and/or
links the following third-party components, each under its own license. None of
these impose copyleft on Muxvo's own source beyond what GPL-3.0 already requires
(all are permissive: MIT / BSD / Apache-2.0).

> Maintainers: before publishing, append the **full verbatim license text** of
> each component below its entry (Apache-2.0 also requires reproducing its
> NOTICE file, if any). This file lists the components, versions, and SPDX
> identifiers; the verbatim texts are fetched from each project at publish time.

## Native (Swift / SwiftPM)

| Component | Version | License (SPDX) | Source |
|---|---|---|---|
| GRDB.swift | 7.8.0 | MIT | https://github.com/groue/GRDB.swift |
| Sparkle | 2.6.4 | MIT | https://github.com/sparkle-project/Sparkle |
| libghostty (ghostty terminal VT/renderer, statically linked `libghostty-vt.a`) | pinned (see `probes/VERSIONS.md`) | MIT | https://github.com/ghostty-org/ghostty |
| Highway (SIMD, vendored inside libghostty) | (bundled by ghostty) | Apache-2.0 | https://github.com/google/highway |

Notes:
- libghostty is statically linked; no ghostty source is copied into this
  repository (build artifacts live outside the repo, see `probes/VERSIONS.md`
  and `probes/term-probe/scripts/`).
- Highway is compiled into libghostty (C++ SIMD); its Apache-2.0 NOTICE applies
  transitively.

## Web panel (npm)

| Component | Version | License (SPDX) |
|---|---|---|
| react, react-dom | ^18.3.1 | MIT |
| @tiptap/* (core, pm, react, starter-kit, extensions) | 3.27.2 | MIT |
| tiptap-markdown | 0.9.0 | MIT |
| markdown-it | ^14.3.0 | MIT |
| mermaid | ^11.16.0 | MIT |
| driver.js | 1.4.0 | MIT |
| highlight.js | ^11.11.1 | BSD-3-Clause |
| pdfjs-dist | ^6.1.200 | Apache-2.0 |
| xlsx (SheetJS Community Edition) | ^0.18.5 | Apache-2.0 |

Build-time only (not shipped in the app bundle): vite, vitest, typescript,
jsdom, @vitejs/plugin-react, @types/* — all MIT/Apache-2.0.

## Apache-2.0 components — NOTICE

pdfjs-dist and xlsx are Apache-2.0. Their respective NOTICE files (if provided
by the upstream distribution) are reproduced here at publish time.
