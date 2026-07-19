# Changelog

Data source for the What's New modal (Keep a Changelog format; auto-update.md §7),
bundled into `Contents/Resources/`, one file per locale (zh/en).

## [2.0.0] - 2026-07-19

### Revamped
- Complete revamp: fully rewritten from Electron to native macOS (Swift + Metal) — faster rendering, snappier input, much lower memory use
- Multi-terminal grid revamp: drag to reorder, focused mode, multi-window (⌥⌘N)
- New list mode (⌘⇧L): browse and switch terminals as a list
- Revamped file viewing: tabbed file views, much cleaner to read
- Minimize any terminal: tuck it into the side rail, restore anytime without breaking the session
- Permanent chat history archive with full-text search; old-version chats migrate automatically
- Automatic updates and memory monitoring

## [0.1.0] - 2026-07-13

### Added
- Brand-new Swift + Metal terminal core with much faster input-to-pixel latency
- Multi-terminal grid: drag to reorder, focused mode, list mode (⌘⇧L), multi-window (⌥⌘N)
- Permanent chat history archive with full-text search, preserved across installs
- Automatic software updates: background download, install on next launch

### Changed
- Rewritten from Electron to a native macOS architecture with a much smaller memory footprint
