# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-03-11

### Added

- What's New modal showing release highlights on first launch after update
- Default working directory setting for new terminals (configurable in Settings)
- Help button (opens a terminal with AI assistant guided by Muxvo documentation)
- Auto-binding between terminals and Chat sessions
- Independent column width adjustment per row in terminal grid
- File tree auto-expand and scroll to currently opened file
- Terminal folder button context menu (Open in Finder)

### Changed

- Reduced update reminder frequency with improved notification wording
- New Worktree no longer auto-named; existing Worktree preserves branch name
- Removed misleading Dock badge notification permission dialog

### Fixed

- Onboarding step 3 blocked when named terminals already exist
- Terminal working directory reset on startup
- Chat history naming mismatch (added session name retry mechanism)
- bindkey command appearing in input box when resuming chat
- Worktree popover not auto-naming terminal with branch name
- Worktree project sessions not found during search
- Dock badge not clearing after clicking terminal (default changed to real-time mode)
- Focus mode sidebar terminal showing bindkey garbage
- Terminal menu button obscured by nav bar in multi-row focused layout
- Enhanced terminal resize safeguards

## [0.4.0] - 2026-03-09

### Added

- Git Worktree management (detect repo, list, create, remove, rename)
- Workspace manager modal (save current terminal layout, restore, rename workspaces)
- PDF file preview (fixed app freeze when opening PDFs)
- Excel / spreadsheet file preview and editing
- Dock badge notifications (show count when terminals are waiting for input, with real-time / timed modes)
- Terminal keyboard shortcuts (⌘T new terminal, ⌘← / ⌘→ jump to line start/end)
- Project-level custom title

### Fixed

- Chat history detail page showing no content
- Incorrect user interrupt message type detection
- Terminal custom name not syncing to chat history
- Home/End key binding timing during terminal initialization
- Dock badge permission dialog appearing repeatedly
- Non-ASCII characters in terminal process paths displaying incorrectly

## [0.3.0] - 2026-03-02

### Added

- Terminal custom naming (click title bar to rename)
- App close confirmation dialog (prompts when active terminals exist)
- First-launch welcome page + feature tour guide
- Interface zoom setting (adjustable in Settings)
- File/folder context menu (Open in Finder, etc.)
- Focus mode sidebar (view other terminals while one is focused)
- Double-click to focus toggle setting
- Performance monitoring logs (writes to ~/.muxvo/logs/perf.log on anomalies)
- Glyph diagnostic logs (for troubleshooting CJK text rendering issues)
- File temp view panel width persistence

### Changed

- Terminal grid layout rewrite with improved multi-terminal arrangement
- Focus mode interaction improvements (back-to-tiling button, sidebar scrolling)
- Unified font sizes across all panels

### Fixed

- Terminal layout transition flickering
- White screen in dev mode (port release timing)
- Unstable terminal scroll position restoration

## [0.2.0] - 2026-02-27

### Added

- Auto-update system (download progress, smart reminders, version skip)
- User authentication (GitHub OAuth, Google OAuth, email verification code, email/password login & registration)
- Terms of Service and Privacy Policy confirmation flow
- MCP panel collapsible groups
- Enhanced chat history search (title match / content match sections, precise counting)
- Global zoom feature
- Terminal waiting-for-input notification component
- Terminal bell and OSC notification detection
- Codex session resume support
- Terminal scroll position persistence and auto-restore

### Changed

- Unified font configuration system (global CSS variables)
- Search highlight implementation optimization
- Update reminder improvements (max 2 prompts per version, 3-day re-reminder)

### Fixed

- macOS auto-update failing due to missing ZIP package
- SIGABRT crash on update restart (replaced quitAndInstall with app.quit)
- Inaccurate scroll positioning when switching search results
- Terminal tile border flickering

## [0.1.0] - 2026-02-25

### Added

- Terminal grid management for multiple AI CLI sessions (Claude Code, Codex, Gemini CLI)
- Chat history browser with multi-source aggregation (Claude Code and Codex)
- Configuration editor with atomic write protection for settings and CLAUDE.md files
- Rich text editor with TipTap and Markdown support
- User authentication (GitHub OAuth, Google OAuth)
- File viewer with directory watching and clipboard image support
