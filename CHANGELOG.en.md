# Changelog

Data source for the What's New modal (Keep a Changelog format; auto-update.md §7),
bundled into `Contents/Resources/`, one file per locale (zh/en).

## [2.0.0] - 2026-07-19

### Added
- Brand-new Swift + Metal native terminal core: faster rendering, snappier input-to-pixel, much lower memory use
- Multi-terminal grid: drag to reorder, focused mode, list mode (⌘⇧L), multi-window (⌥⌘N)
- Permanent chat history archive with full-text search, preserved across installs
- Automatic updates: background download, install on next launch, What's New on upgrade
- Memory monitoring: a gentle heads-up when usage runs high

### Changed
- Fully rewritten from Electron to a native macOS architecture — big performance and memory gains
- Chat history from the old version migrates automatically on first launch

## [0.1.0] - 2026-07-13

### Added
- Brand-new Swift + Metal terminal core with much faster input-to-pixel latency
- Multi-terminal grid: drag to reorder, focused mode, list mode (⌘⇧L), multi-window (⌥⌘N)
- Permanent chat history archive with full-text search, preserved across installs
- Automatic software updates: background download, install on next launch

### Changed
- Rewritten from Electron to a native macOS architecture with a much smaller memory footprint
