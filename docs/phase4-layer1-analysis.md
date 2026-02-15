# Phase 4 Layer 1 -- Source Module Analysis

> Generated: 2026-02-15
> Scope: All `await import('@/...')` and `require('@/...')` in Layer 1 & Layer 2 TERM test files,
> plus cross-cutting L1 tests (APP/ONBOARD/PERF/ERROR) and EDITOR dependency files.
>
> Purpose: Identify every source module that must be implemented to make tests pass.

---

## Summary

| Package | Module Count |
|---------|-------------|
| `@/shared/` | 13 |
| `@/main/` | 9 |
| `@/renderer/` | 7 |
| **Total** | **29** |

---

## Package: `@/shared/`

### Module: @/shared/config/defaults

- **Imported in:** `tests/l1/term.test.ts` (line 85)
- **Expected exports:**
  - `getDefaultConfig()` => `{ window: { width: number, height: number }, font: { size: number }, theme: string, tile: { columnRatios: number[], rowRatios: number[] } }`
- **Assertions:** `config.window.width === 1400`, `config.window.height === 900`, `config.font.size === 14`, `config.theme === 'dark'`, `config.tile.columnRatios === [1,1]`, `config.tile.rowRatios === [1,1]`

---

### Module: @/shared/utils/grid-layout

- **Imported in:** `tests/l2/term-state.test.ts` (lines 34, 55), `tests/l2/term-rules.test.ts` (lines 521, 534)
- **Expected exports:**
  - `calculateGridLayout(terminalCount: number)` => `{ cols: number, rows: number, lastRowCentered?: boolean, distribution?: number[] }`
- **Assertions:** Grid algorithm: 1->1x1, 2->2x1, 3->3x1, 4->2x2, 5->3x2(upper 3 lower 2), 6->3x2, 7->3x3, 20->5x4. Uses `ceil(sqrt(n))` for column count.

---

### Module: @/shared/machines/terminal-process

- **Imported in:** `tests/l2/term-state.test.ts` (lines 99, 109, 123, 136, 149, 162, 176, 189, 204, 219, 234, 249, 264, 278, 293, 309)
- **Expected exports:**
  - `createTerminalMachine()` => state machine instance with:
    - `.state` property (string)
    - `.send(event: string)` method
- **States:** `Created`, `Starting`, `Running`, `Busy`, `WaitingInput`, `Stopping`, `Stopped`, `Disconnected`, `Failed`, `Removed`
- **Events:** `SPAWN`, `SPAWN_SUCCESS`, `SPAWN_FAILURE`, `PROCESS_START`, `PROCESS_DONE`, `WAIT_INPUT`, `USER_INPUT`, `CLOSE`, `EXIT_NORMAL`, `EXIT_ABNORMAL`, `TIMEOUT`, `RECONNECT`, `REMOVE`
- **Transitions (16):**
  - T1: `[*] -> Created` (initial)
  - T2: `Created -> Starting` (SPAWN)
  - T3: `Starting -> Running` (SPAWN_SUCCESS)
  - T4: `Starting -> Failed` (SPAWN_FAILURE)
  - T5: `Running -> Busy` (PROCESS_START)
  - T6: `Busy -> Running` (PROCESS_DONE)
  - T7: `Running -> WaitingInput` (WAIT_INPUT)
  - T8: `WaitingInput -> Running` (USER_INPUT)
  - T9: `Running -> Stopping` (CLOSE)
  - T10: `Stopping -> Stopped` (EXIT_NORMAL)
  - T11: `Stopping -> Disconnected` (TIMEOUT)
  - T12: `Running -> Disconnected` (EXIT_ABNORMAL)
  - T13: `Disconnected -> Starting` (RECONNECT)
  - T14: `Disconnected -> Removed` (REMOVE)
  - T15: `Stopped -> Removed` (REMOVE)
  - T16: `Failed -> Removed` (REMOVE)

---

### Module: @/shared/machines/view-mode

- **Imported in:** `tests/l2/term-state.test.ts` (lines 329, 337, 349, 359, 371, 387, 397, 409, 423, 439, 451)
- **Expected exports:**
  - `createViewModeMachine()` => state machine instance with:
    - `.state` property (string)
    - `.context` property: `{ focusedId?: string, enteredFrom?: string }`
    - `.send(event: string | { type: string, targetId?: string })` method
- **States:** `Tiling`, `Focused`, `FilePanel`, `TempView`
- **Events:** `DOUBLE_CLICK_TILE`, `ESC`, `CLICK_BACK_TO_TILING`, `CLICK_SIDEBAR_TILE`, `CLICK_FILE_BUTTON`, `CLICK_FILE`
- **Transitions (11):**
  - V1: `[*] -> Tiling` (initial)
  - V2: `Tiling -> Focused` (DOUBLE_CLICK_TILE)
  - V3: `Focused -> Tiling` (ESC)
  - V4: `Focused -> Tiling` (CLICK_BACK_TO_TILING)
  - V5: `Focused -> Focused` (CLICK_SIDEBAR_TILE, updates focusedId)
  - V6: `Tiling -> FilePanel` (CLICK_FILE_BUTTON)
  - V7: `Focused -> FilePanel` (CLICK_FILE_BUTTON)
  - V8: `FilePanel -> Tiling` (ESC, when enteredFrom=Tiling)
  - V9: `FilePanel -> Focused` (ESC, when enteredFrom=Focused)
  - V10: `FilePanel -> TempView` (CLICK_FILE)
  - V11: `TempView -> Tiling` (ESC)

---

### Module: @/shared/utils/esc-handler

- **Imported in:** `tests/l2/term-state.test.ts` (lines 469, 477, 485, 493, 501, 509, 517, 525), `tests/l2/term-rules.test.ts` (line 573)
- **Expected exports:**
  - `handleEscPress(context: EscContext)` => `{ action: string, priority: number, intercepted?: boolean }`
- **Context shape:** `{ securityDialogOpen?, folderSelectorOpen?, skillBrowserOpen?, tempViewOpen?, filePanelOpen?, viewMode?: string, terminalFocused?: boolean }`
- **Priority rules (7 levels):**
  1. `securityDialogOpen=true` => `{ action: 'closeSecurityDialog', priority: 1 }`
  2. `folderSelectorOpen=true` => `{ action: 'closeFolderSelector', priority: 2 }`
  3. `skillBrowserOpen=true` => `{ action: 'closeSkillBrowser', priority: 3 }`
  4. `tempViewOpen=true` => `{ action: 'closeTempView', priority: 4 }`
  5. `filePanelOpen=true` => `{ action: 'closeFilePanel', priority: 5 }`
  6. `viewMode='Focused' && !terminalFocused` => `{ action: 'exitFocusMode', priority: 6 }`
  7. `viewMode='Tiling'` => `{ action: 'noop', priority: 7 }`
  - Special: `terminalFocused=true` => `{ action: 'passthrough', intercepted: false }` (bypasses all priorities)

---

### Module: @/shared/machines/terminal-naming

- **Imported in:** `tests/l2/term-rules.test.ts` (lines 123, 133, 143, 155, 168, 181, 192, 207, 227)
- **Expected exports:**
  - `createNamingMachine()` => state machine instance with:
    - `.state` property (string)
    - `.context` property: `{ displayText: string, placeholder: string, originalValue: string, editValue: string }`
    - `.send(event)` method
- **States:** `DisplayEmpty`, `Editing`, `DisplayNamed`
- **Events:** `CLICK_PLACEHOLDER`, `ENTER` (with value), `BLUR` (with value), `ESC`, `CLICK_NAME`
- **Transitions (9):**
  - N1: `[*] -> DisplayEmpty` (initial, displayText='', placeholder='命名...')
  - N2: `DisplayEmpty -> Editing` (CLICK_PLACEHOLDER)
  - N3: `Editing -> DisplayNamed` (ENTER with non-empty value)
  - N4: `Editing -> DisplayNamed` (BLUR with non-empty value)
  - N5: `Editing -> DisplayEmpty` (ENTER with empty value)
  - N6: `Editing -> DisplayEmpty` (BLUR with empty value)
  - N7: `Editing -> DisplayEmpty` (ESC, when originalValue is empty)
  - N8: `Editing -> DisplayNamed` (ESC, when originalValue is non-empty, restores original)
  - N9: `DisplayNamed -> Editing` (CLICK_NAME, pre-fills editValue)

---

### Module: @/shared/utils/terminal-grouping

- **Imported in:** `tests/l2/term-rules.test.ts` (lines 341, 360, 379)
- **Expected exports:**
  - `createTerminalGroupManager()` => manager instance with:
    - `.addTerminal({ id: string, cwd: string })` => position info
    - `.updateCwd(id: string, newCwd: string)` => void
    - `.getOrder()` => `string[]` (ordered terminal IDs)
- **Behavior:** Terminals with the same `cwd` are grouped adjacent. `cd` triggers auto-regrouping. Unique cwd terminals are appended to end.

---

### Module: @/shared/utils/terminal-manager

- **Imported in:** `tests/l2/term-rules.test.ts` (line 402)
- **Expected exports:**
  - `createTerminalManager()` => manager instance with:
    - `.create({ cwd: string })` => `{ success: boolean, error?: string }`
    - `.count` property (number)
    - `.canCreateNew` property (boolean)
- **Behavior:** Maximum 20 terminals. 21st creation returns `{ success: false, error: '已达最大终端数' }`.

---

### Module: @/shared/utils/buffer-manager

- **Imported in:** `tests/l2/term-rules.test.ts` (lines 421, 428, 437)
- **Expected exports:**
  - `getBufferLimit(visibility: 'visible' | 'hidden')` => `number` (10000 for visible, 1000 for hidden)
  - `createBufferManager({ initialLines: number })` => manager instance with:
    - `.setVisibility(v: 'visible' | 'hidden')` => void
    - `.lineCount` property (number)
    - `.maxLines` property (number)
- **Behavior:** Buffer shrink from visible->hidden is irreversible (lines lost). When returning to visible, maxLines restores to 10000 but lineCount does not increase.

---

### Module: @/shared/errors/app-error

- **Imported in:** `tests/l1/cross.test.ts` (line 292)
- **Expected exports:**
  - `createAppError(code: string, message: string, details?: Record<string, unknown>)` => `{ code: string, message: string, details?: Record<string, unknown> }`
- **Assertions:** `code === 'SPAWN_FAILED'`, `message === 'Process failed to start'`, `details === { pid: 1234 }`

---

### Module: @/shared/errors/error-codes

- **Imported in:** `tests/l1/cross.test.ts` (line 321)
- **Expected exports:**
  - `ErrorCodes` object with properties: `SPAWN_FAILED`, `FILE_READ_ERROR`, `NETWORK_ERROR`, `INSTALL_FAILED`, `SCORE_FAILED`, `AUTH_FAILED`, `PUBLISH_BLOCKED`

---

### Module: @/shared/errors/error-categories

- **Imported in:** `tests/l1/cross.test.ts` (line 335)
- **Expected exports:**
  - `ErrorCategories` object with:
    - `.autoRecoverable: string[]` containing: `'download retry'`, `'JSONL skip'`, `'file locked skip'`, `'partial source fallback'`
    - `.userActionRequired: string[]` containing: `'process crash'`, `'file read fail'`, `'network offline'`, `'permission error'`
    - `.blocking: string[]` containing: `'API key detected'`, `'sensitive file detected'`, `'integrity check failed'`

---

### Module: @/shared/machines/rich-editor

- **Imported in:** `tests/l2/editor.test.ts` (lines 36, 46, 57, 78, 89, 111, 125, 591)
- **Expected exports:**
  - `createEditorMachine()` => state machine instance with:
    - `.state` property (string)
    - `.context` property: `{ content: string, attachedImages: Array<{ path: string }> }`
    - `.send(event)` method
- **States:** `Idle`, `Composing`, `ImageAttaching`, `Sending`
- **Events:** `INPUT_START`, `INPUT_CONTINUE` (with text), `PASTE_IMAGE` (with imageData), `IMAGE_SAVED` (with tempPath), `SUBMIT`, `SEND_COMPLETE`, `REMOVE_IMAGE` (with imagePath)
- **Transitions (7):**
  - E1: `[*] -> Idle`
  - E2: `Idle -> Composing` (INPUT_START)
  - E3: `Composing -> Composing` (INPUT_CONTINUE, appends text)
  - E4: `Composing -> ImageAttaching` (PASTE_IMAGE)
  - E5: `ImageAttaching -> Composing` (IMAGE_SAVED, adds thumbnail)
  - E6: `Composing -> Sending` (SUBMIT)
  - E7: `Sending -> Idle` (SEND_COMPLETE, clears content and images)

---

### Module: @/shared/machines/editor-mode

- **Imported in:** `tests/l2/editor.test.ts` (lines 146, 158, 170, 183)
- **Expected exports:**
  - `createEditorModeMachine()` => state machine instance with:
    - `.state` property (string)
    - `.send(event)` method
- **States:** `RichEditor`, `RawTerminal`
- **Events:** `ASB_SIGNAL` (with signal string), `TOGGLE_MODE`
- **Transitions (4):**
  - M1: `RichEditor -> RawTerminal` (ASB_SIGNAL with `\x1b[?1049h`)
  - M2: `RawTerminal -> RichEditor` (ASB_SIGNAL with `\x1b[?1049l`)
  - M3: `RichEditor -> RawTerminal` (TOGGLE_MODE)
  - M4: `RawTerminal -> RichEditor` (TOGGLE_MODE)

---

## Package: `@/main/`

### Module: @/main/ipc/terminal-handlers

- **Imported in:** `tests/l1/term.test.ts` (line 71)
- **Expected exports:**
  - `terminalHandlers` object with:
    - `.create` (function) -- handler for `terminal:create` IPC channel

---

### Module: @/main/services/app/config

- **Imported in:** `tests/l1/cross.test.ts` (lines 61, 91)
- **Expected exports:**
  - `getAppConfig()` => `Promise<{ window: object, openTerminals: array, gridLayout: object, theme: string, fontSize: number, ftvLeftWidth: number, ftvRightWidth: number }>`
  - `saveAppConfig(config: object)` => `Promise<{ success: boolean }>`

---

### Module: @/main/services/app/preferences

- **Imported in:** `tests/l1/cross.test.ts` (lines 114, 136)
- **Expected exports:**
  - `getPreferences()` => `Promise<{ preferences: { theme: string, fontSize: number, locale: string } }>`
  - `savePreferences(prefs: object)` => `Promise<{ success: boolean }>`

---

### Module: @/main/services/onboard/status

- **Imported in:** `tests/l1/cross.test.ts` (line 177)
- **Expected exports:**
  - `getOnboardingStatus()` => `Promise<{ steps: Array<{ id, title, content, action }>, currentStep: number, completed: boolean }>`

---

### Module: @/main/services/onboard/cli-detection

- **Imported in:** `tests/l1/cross.test.ts` (line 203)
- **Expected exports:**
  - `detectCliTools()` => `Promise<{ detectedTools: Array<{ name: string, path: string, version?: string }>, scannedTools: string[] }>`
- **Behavior:** Scans PATH for `claude`, `codex`, `gemini`.

---

### Module: @/main/services/perf/metrics

- **Imported in:** `tests/l1/cross.test.ts` (line 239)
- **Expected exports:**
  - `getPerformanceMetrics()` => `Promise<{ memoryUsageMB: number, terminalCount: number, bufferLines: { focused: number, background: number[] } }>`

---

### Module: @/main/services/perf/memory-monitor

- **Imported in:** `tests/l1/cross.test.ts` (line 277, via `require`)
- **Expected exports:**
  - `createMemoryMonitor({ thresholdMB: number })` => monitor instance with:
    - `.getThreshold()` => `number`
    - `.checkMemory` (function)
- **Behavior:** Threshold default 2048 MB. Emits `app:memory-warning` push event when exceeded.

---

### Module: @/main/ipc/text-forward

- **Imported in:** `tests/l1/editor.test.ts` (lines 28, 42, 57)
- **Expected exports:**
  - `forwardTextToPty({ text: string, foregroundProcess: string })` => `string`
- **Behavior:**
  - Single line: appends `\r`
  - Multi-line + Claude Code foreground: uses `\x1b\r` separator between lines, `\r` terminator
  - Multi-line + bash foreground: uses `\n` separator, `\n` terminator

---

### Module: @/main/ipc/image-handler

- **Imported in:** `tests/l1/editor.test.ts` (lines 74, 88)
- **Expected exports:**
  - `writeTempImage({ imageData: Uint8Array, format: string })` => `Promise<{ filePath: string }>` (path matches `/tmp/muxvo-images/{uuid}.png`)
  - `writeClipboardImage({ imageData: Uint8Array, foregroundProcess: string })` => `Promise<{ action: string, keySent: string }>` (when CC foreground: action='clipboard_paste', keySent='\x16')

---

### Module: @/main/services/temp-file-manager

- **Imported in:** `tests/l2/editor.test.ts` (lines 692, 717, 743)
- **Expected exports:**
  - `createTempFileManager()` => manager instance with:
    - `.registerFile(terminalId: string, filePath: string, opts?: { createdAt: number })` => void
    - `.cleanupTerminal(terminalId: string)` => `Promise<{ deletedCount: number, deletedPaths: string[], skippedReason?: string }>`
    - `.cleanupExpired(now: number)` => `Promise<{ deletedCount: number, deletedPaths: string[], keptCount: number }>`
    - `.getFilesForTerminal(terminalId: string)` => array
    - `.markTerminalActive(terminalId: string)` => void
- **Behavior:** 24h auto-cleanup. Active terminals are protected from cleanup.

---

## Package: `@/renderer/`

### Module: @/renderer/components/tile/tile-styles

- **Imported in:** `tests/l1/term.test.ts` (lines 128, 134)
- **Expected exports:**
  - `getTileStyle(state: string)` => `{ border: string, opacity: number }`
- **Assertions:** Default state: `border === 'var(--border)'`, `opacity === 1`

---

### Module: @/renderer/components/tile/tile-naming

- **Imported in:** `tests/l1/term.test.ts` (line 141)
- **Expected exports:**
  - `getNamePlaceholder()` => `{ text: string, style: string }`
- **Assertions:** `text === '命名...'`, `style` contains `'italic'`

---

### Module: @/renderer/stores/terminal-process-ui-map

- **Imported in:** `tests/l2/term-state.test.ts` (line 77)
- **Expected exports:**
  - `getTerminalProcessUI(state: string)` => `{ statusDotColor: string, statusDotAnimation: string, inputEnabled: boolean, inputPlaceholder?: string, inputHasOptions?: boolean }`

---

### Module: @/renderer/components/tile/tile-interaction-styles

- **Imported in:** `tests/l2/term-state.test.ts` (line 551)
- **Expected exports:**
  - `getTileInteractionStyle(state: string)` => `{ border: string, opacity: number, transform: string, extra?: unknown }`

---

### Module: @/renderer/stores/focus-mode

- **Imported in:** `tests/l2/term-rules.test.ts` (lines 28, 46, 63, 81, 100, 465, 482, 549)
- **Expected exports:**
  - `createFocusModeManager(opts: { terminals: string[], viewMode: string, gridLayout?: object })` => manager instance with:
    - `.viewMode` property (string)
    - `.focusedTerminal` property (string)
    - `.selectedTerminal` property (string)
    - `.layout.mainWidthPercent` property (number, ~75)
    - `.sidebarTerminals` property (string[])
    - `.sidebarVisibleCount` property (number, max 3)
    - `.sidebarScrollable` property (boolean)
    - `.gridLayout` property (object, restored on exit)
    - `.doubleClick(terminalId: string)` => enters Focused mode
    - `.singleClick(terminalId: string)` => selects terminal (amber border), stays Tiling
    - `.clickSidebar(terminalId: string)` => switches focused target
    - `.handleEsc({ terminalFocused: boolean })` => exits Focused mode to Tiling

---

### Module: @/renderer/stores/grid-resize

- **Imported in:** `tests/l2/term-rules.test.ts` (lines 249, 269, 288, 308, 318, 501)
- **Expected exports:**
  - `createGridResizeManager(opts: { cols: number, rows: number, columnRatios?: number[], rowRatios?: number[], viewMode?: string })` => manager instance with:
    - `.columnRatios` property (number[])
    - `.rowRatios` property (number[])
    - `.cursor` property (string)
    - `.persistedRatios` property (number[])
    - `.startColResize(index: number, event: { clientX: number })` => `boolean`
    - `.moveResize(event: { clientX?: number, clientY?: number })` => void
    - `.endResize()` => void
    - `.startRowResize(index: number, event: { clientY: number })` => void
    - `.doubleClickColGap(index: number)` => void (resets to equal split)
    - `.doubleClickRowGap(index: number)` => void (resets to equal split)
- **Behavior:** No resize allowed in Focused mode (`startColResize` returns false). Double-click gap resets ratios. Ratios are persisted after endResize.

---

### Module: @/renderer/stores/drag-manager

- **Imported in:** `tests/l2/term-rules.test.ts` (lines 589, 604)
- **Expected exports:**
  - `createDragManager(opts: { order: string[] })` => manager instance with:
    - `.order` property (string[])
    - `.startDrag(terminalId: string)` => void
    - `.dropBefore(targetId: string)` => void
    - `.cancel()` => void (restores original order)

---

## Package: `@/shared/utils/` (EDITOR dependency modules)

### Module: @/shared/utils/editor-key-handler

- **Imported in:** `tests/l2/editor.test.ts` (lines 202, 219, 237, 255, 274, 293, 308, 328)
- **Expected exports:**
  - `handleEditorKey(opts: { key: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, editorMode: string, editorState: string, currentContent?: string })` => `{ action: string, ptySignal?: string, clearEditor?: boolean, editorHandled?: boolean, char?: string, preserveContent?: boolean }`
- **Key rules:**
  - `Ctrl+C` => `{ action: 'passthrough', ptySignal: '\x03', clearEditor: false }`
  - `Ctrl+Z` => `{ action: 'passthrough', ptySignal: '\x1a', clearEditor: false }`
  - `Ctrl+D` => `{ action: 'passthrough', ptySignal: '\x04', editorHandled: false }`
  - `Enter` (no modifiers) => `{ action: 'submit', editorHandled: true }`
  - `Cmd+Enter` => `{ action: 'submit', editorHandled: true }`
  - `Shift+Enter` => `{ action: 'newline', editorHandled: true }`
  - Normal char => `{ action: 'input', editorHandled: true, char: 'a' }`
  - `Ctrl+C` with content => `{ action: 'passthrough', clearEditor: false, preserveContent: true }`

---

### Module: @/shared/utils/text-forwarder

- **Imported in:** `tests/l2/editor.test.ts` (lines 353, 367, 384, 400, 417, 432, 448, 465)
- **Expected exports:**
  - `buildTextPayload(opts: { foreground: string, text: string })` => `{ payload?: string, shouldSend?: boolean }`
- **Protocol rules:**
  - Claude Code single line: `text + '\r'`
  - Claude Code multi-line: lines joined by `'\x1b\r'`, terminated by `'\r'`
  - Shell (bash/zsh/fish) single line: `text + '\n'`
  - Shell multi-line: `text + '\n'` (newlines preserved)
  - Empty text: `{ shouldSend: false, payload: undefined }`
  - Special chars: no escaping, pass through verbatim

---

### Module: @/shared/utils/image-sender

- **Imported in:** `tests/l2/editor.test.ts` (lines 488, 505, 522, 538, 554, 571)
- **Expected exports:**
  - `buildImagePayload(opts: { foreground: string, imagePath: string, clipboardAvailable?: boolean })` => `Promise<{ strategy: string, clipboardWrite?: boolean, ptyPayload?: string, textPayload?: string }>`
  - `validateImage(opts: { format: string, size: number })` => `{ valid: boolean, error?: string, errorType?: string, supportedFormats?: string[] }`
- **Strategy rules:**
  - Claude Code + clipboard available: `{ strategy: 'clipboard', clipboardWrite: true, ptyPayload: '\x16' }`
  - Claude Code + clipboard unavailable: `{ strategy: 'filepath', textPayload: path }`
  - Gemini/bash: `{ strategy: 'filepath', textPayload: path }`
  - Image > 5MB: `{ valid: false, errorType: 'oversize', error: contains '5MB' }`
  - Invalid format (BMP): `{ valid: false, errorType: 'invalid_format', supportedFormats: ['PNG','JPG','GIF'] }`

---

### Module: @/shared/utils/auto-mode-detector

- **Imported in:** `tests/l2/editor.test.ts` (lines 622, 638, 655, 674)
- **Expected exports:**
  - `createAutoModeDetector()` => detector instance with:
    - `.onTerminalOutput(data: string)` => `{ modeSwitch: boolean, targetMode?: string, trigger?: string }`
    - `.onForegroundProcessChange(processName: string)` => `{ modeSwitch: boolean, targetMode?: string, trigger?: string }`
- **Behavior:**
  - `\x1b[?1049h` (ASB enter) => `{ modeSwitch: true, targetMode: 'RawTerminal', trigger: 'asb_enter' }`
  - `\x1b[?1049l` (ASB exit) => `{ modeSwitch: true, targetMode: 'RichEditor', trigger: 'asb_exit' }`
  - Process `htop` (TUI match) => `{ modeSwitch: true, targetMode: 'RawTerminal', trigger: 'process_name' }`
  - Process `claude` (no ASB) => `{ modeSwitch: false }`

---

## Package: `@/renderer/` (EDITOR dependency modules)

### Module: @/renderer/components/editor/editor-config

- **Imported in:** `tests/l1/editor.test.ts` (lines 115, 123, 135)
- **Expected exports:**
  - `getEditorDefaults()` => `{ mode: string, sendKey: { send: string[], newline: string }, technology: string }`
- **Assertions:**
  - `mode === 'RichEditor'`
  - `sendKey.send` contains `['Enter', 'Cmd+Enter']`
  - `sendKey.newline === 'Shift+Enter'`
  - `technology === 'contenteditable div'`

---

### Module: @/renderer/stores/editor-mode-ui-map

- **Imported in:** `tests/l2/editor.test.ts` (lines 770, 789, 804)
- **Expected exports:**
  - `getEditorModeUI(mode: string, opts?: { hasAttachedImages?: boolean })` => `{ richEditorVisible: boolean, keyboardTarget: string, passthroughKeys?: string[], xtermKeyboardAttached: boolean, thumbnailVisible?: boolean, removeButtonVisible?: boolean }`
- **State mapping:**
  - `RichEditor` => `{ richEditorVisible: true, keyboardTarget: 'richEditor', passthroughKeys: ['Ctrl+C','Ctrl+Z','Ctrl+D'], xtermKeyboardAttached: false }`
  - `RawTerminal` => `{ richEditorVisible: false, keyboardTarget: 'xterm', xtermKeyboardAttached: true }`
  - `RichEditor` + images => adds `{ thumbnailVisible: true, removeButtonVisible: true }`

---

## Cross-Reference: Spec JSON Files Used

| Spec File | Used By |
|-----------|---------|
| `tests/specs/l1/term.spec.json` | `tests/l1/term.test.ts` |
| `tests/specs/l2/grid-layout.spec.json` | `tests/l2/term-state.test.ts` |
| `tests/specs/l2/state-ui-map.spec.json` | `tests/l2/term-state.test.ts` |
| `tests/specs/l1/cross.spec.json` | `tests/l1/cross.test.ts` |
| `tests/specs/l1/editor.spec.json` | `tests/l1/editor.test.ts` |

---

## Implementation Priority for Layer 1

### Tier 1 -- Shared foundations (no renderer/main dependency)
1. `@/shared/config/defaults`
2. `@/shared/errors/app-error`
3. `@/shared/errors/error-codes`
4. `@/shared/errors/error-categories`
5. `@/shared/utils/grid-layout`
6. `@/shared/utils/esc-handler`
7. `@/shared/utils/buffer-manager`
8. `@/shared/utils/terminal-manager`
9. `@/shared/utils/terminal-grouping`

### Tier 2 -- State machines (shared, pure logic)
10. `@/shared/machines/terminal-process`
11. `@/shared/machines/view-mode`
12. `@/shared/machines/terminal-naming`
13. `@/shared/machines/rich-editor`
14. `@/shared/machines/editor-mode`

### Tier 3 -- Shared utils (EDITOR dependencies)
15. `@/shared/utils/editor-key-handler`
16. `@/shared/utils/text-forwarder`
17. `@/shared/utils/image-sender`
18. `@/shared/utils/auto-mode-detector`

### Tier 4 -- Main process services
19. `@/main/ipc/terminal-handlers`
20. `@/main/ipc/text-forward`
21. `@/main/ipc/image-handler`
22. `@/main/services/app/config`
23. `@/main/services/app/preferences`
24. `@/main/services/onboard/status`
25. `@/main/services/onboard/cli-detection`
26. `@/main/services/perf/metrics`
27. `@/main/services/perf/memory-monitor`
28. `@/main/services/temp-file-manager`

### Tier 5 -- Renderer stores and components
29. `@/renderer/components/tile/tile-styles`
30. `@/renderer/components/tile/tile-naming`
31. `@/renderer/components/tile/tile-interaction-styles`
32. `@/renderer/components/editor/editor-config`
33. `@/renderer/stores/terminal-process-ui-map`
34. `@/renderer/stores/focus-mode`
35. `@/renderer/stores/grid-resize`
36. `@/renderer/stores/drag-manager`
37. `@/renderer/stores/editor-mode-ui-map`
