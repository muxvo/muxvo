# 接力文档：执行 DEV-PLAN 任务 A2 + A4

## 你是谁、你要做什么

你接手一个 Electron 桌面应用 Muxvo 的开发。前一个 session 已完成 A1（Electron 骨架），现在你要执行 **A2（node-pty 接入）** 和 **A4（CSS Grid 终端布局）**。这两个任务可以并行开发，但建议先 A2 后 A4，因为 A4 的 xterm.js 组件需要终端输出数据来验证。

---

## 当前项目状态

### 已完成

1. **TDD 全套**：609 个测试全部通过（`npm test`），覆盖 L1 契约 / L2 规则 / L3 场景
2. **A1 Electron 骨架**：主窗口 + 36px MenuBar + BottomBar + IPC Bridge
3. **77 个可复用文件**：类型定义、状态机、纯算法、常量 — 这些是真实代码，直接用
4. **77 个桩文件**：IPC handlers、服务管理器 — 当前返回硬编码数据，需要逐步替换为真实实现

### 关键约束

- **每做完一步必须 `npm test` 确认 609 测试仍然全绿**
- **用依赖注入（DI）模式替换桩代码**，测试注入 mock，生产注入真实实现
- **不要修改已有测试代码**，只修改 src/ 下的源代码

### 技术栈

- Electron 34 + React 19 + TypeScript 5.9
- 构建工具：`electron-vite`（`npm run dev` 启动开发，`npm run build` 生产构建）
- 测试：Vitest + 自定义 JSON spec 验证
- 路径别名：`@/` → `./src/`

---

## 任务 A2：node-pty 接入

### 目标

让 Muxvo 能真实创建终端进程。Renderer 调用 `window.api.terminal.create(cwd)` → Main 进程通过 node-pty 启动 PTY → 终端输出通过 IPC 推送回 Renderer。

### 步骤

#### Step 1：安装 node-pty

```bash
npm install node-pty
npm install --save-dev electron-rebuild
npx electron-rebuild   # 编译 node-pty 的 native 模块匹配 Electron ABI
```

如果 `electron-rebuild` 失败，尝试：
```bash
npx electron-rebuild -f -w node-pty
```

#### Step 2：创建 PTY 适配器（新文件）

创建 `src/main/services/terminal/pty-adapter.ts`：

```typescript
/**
 * PTY Adapter — 封装 node-pty，提供依赖注入接口
 * 测试时可替换为 mock，生产时使用真实 node-pty
 */
import * as pty from 'node-pty';

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitCode: number) => void): void;
}

export interface PtyAdapter {
  spawn(shell: string, cwd: string, cols: number, rows: number): PtyProcess;
  getDefaultShell(): string;
}

export function createRealPtyAdapter(): PtyAdapter {
  return {
    spawn(shell, cwd, cols, rows) {
      const proc = pty.spawn(shell, [], { cwd, cols, rows, name: 'xterm-256color' });
      return {
        pid: proc.pid,
        write: (data) => proc.write(data),
        resize: (c, r) => proc.resize(c, r),
        kill: () => proc.kill(),
        onData: (cb) => { proc.onData(cb); },
        onExit: (cb) => { proc.onExit(({ exitCode }) => cb(exitCode)); },
      };
    },
    getDefaultShell() {
      return process.env.SHELL || '/bin/zsh';
    },
  };
}
```

#### Step 3：替换 Terminal Manager（修改已有文件）

文件：`src/main/services/terminal/manager.ts`

当前是桩（只有 cwd 校验），需要改为真实实现。**注意**：现有测试通过 mock 调用这个文件，所以要用 DI 模式保持兼容。

改造思路：
```typescript
import type { PtyAdapter, PtyProcess } from './pty-adapter';

interface ManagedTerminal {
  id: string;
  process: PtyProcess;
  cwd: string;
  state: string;
}

export function createTerminalManager(deps?: { pty?: PtyAdapter }) {
  const terminals = new Map<string, ManagedTerminal>();
  const ptyAdapter = deps?.pty;  // 生产时传入真实适配器，测试时为 undefined

  function spawn(options: { cwd: string }) {
    if (!isValidCwd(options.cwd)) {
      return { success: false, state: 'Failed', message: '...' };
    }

    // 如果有真实 PTY 适配器，创建真实进程
    if (ptyAdapter) {
      const shell = ptyAdapter.getDefaultShell();
      const proc = ptyAdapter.spawn(shell, options.cwd, 80, 24);
      const id = `term-${proc.pid}`;
      terminals.set(id, { id, process: proc, cwd: options.cwd, state: 'Running' });
      return { success: true, state: 'Running', id, pid: proc.pid };
    }

    // 无适配器时返回桩数据（保持测试兼容）
    return { success: true, state: 'Running' };
  }

  // ... write, resize, close, list 等方法类似处理

  return { spawn, /* ... */ };
}
```

#### Step 4：替换 IPC Handlers（修改已有文件）

文件：`src/main/ipc/terminal-handlers.ts`

当前是 9 行桩代码。改为真实注册 IPC handlers：

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { TerminalCreateRequest } from '@/shared/types/terminal.types';

export function registerTerminalHandlers(manager: ReturnType<typeof createTerminalManager>) {
  ipcMain.handle(IPC_CHANNELS.TERMINAL.CREATE, async (_event, req: TerminalCreateRequest) => {
    const result = manager.spawn({ cwd: req.cwd });
    return { success: result.success, data: { id: result.id, pid: result.pid } };
  });

  // terminal:write — 单向，用 ipcMain.on
  ipcMain.on(IPC_CHANNELS.TERMINAL.WRITE, (_event, req) => {
    manager.write(req.id, req.data);
  });

  // terminal:resize
  ipcMain.on(IPC_CHANNELS.TERMINAL.RESIZE, (_event, req) => {
    manager.resize(req.id, req.cols, req.rows);
  });

  // terminal:close
  ipcMain.handle(IPC_CHANNELS.TERMINAL.CLOSE, async (_event, req) => {
    return manager.close(req.id, req.force);
  });

  // terminal:list
  ipcMain.handle(IPC_CHANNELS.TERMINAL.LIST, async () => {
    return { success: true, data: manager.list() };
  });
}
```

#### Step 5：在 Main 入口注册

修改 `src/main/index.ts`，在 `app.whenReady()` 里注册 handlers：

```typescript
import { createTerminalManager } from './services/terminal/manager';
import { createRealPtyAdapter } from './services/terminal/pty-adapter';
import { registerTerminalHandlers } from './ipc/terminal-handlers';

app.whenReady().then(() => {
  const ptyAdapter = createRealPtyAdapter();
  const terminalManager = createTerminalManager({ pty: ptyAdapter });
  registerTerminalHandlers(terminalManager);

  createWindow();
  // ...
});
```

#### Step 6：终端输出推送到 Renderer

在 terminal manager 的 spawn 方法里，监听 PTY 输出并通过 IPC 推送：

```typescript
proc.onData((data) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send(IPC_CHANNELS.TERMINAL.OUTPUT, { id, data });
  }
});

proc.onExit((code) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send(IPC_CHANNELS.TERMINAL.EXIT, { id, code });
  }
});
```

#### Step 7：验证

```bash
npm test                    # 609 应该仍然全绿
npm run build               # electron-vite build 应该成功
npm run dev                 # 启动开发模式，打开 DevTools 手动测试：
                            # 在 Console 输入 window.api.terminal.create('/tmp')
                            # 应该返回 { success: true, data: { id: '...', pid: ... } }
```

### 已有可复用文件

| 文件 | 内容 | 用途 |
|------|------|------|
| `src/shared/types/terminal.types.ts` | 所有终端域类型（10 状态枚举、Request/Response 接口） | 直接 import 使用 |
| `src/shared/constants/channels.ts` | `IPC_CHANNELS.TERMINAL.*`（10 个 channel 名） | IPC 注册时用 |
| `src/shared/machines/terminal-process.ts` | 10 状态 FSM (`createTerminalMachine()`) | 管理终端生命周期 |
| `src/renderer/stores/terminal-process-ui-map.ts` | 状态→UI 映射（颜色、动画、输入状态） | Renderer 侧渲染状态指示器 |
| `src/preload/index.ts` | `window.api.terminal.*` 已定义好全部 7 个方法 + 3 个事件监听 | Renderer 直接调用 |

---

## 任务 A4：CSS Grid 终端布局

### 目标

多个终端以 CSS Grid 自动排列在内容区。支持 1~20 个终端的动态行列计算，最后一行居中。

### 步骤

#### Step 1：安装 xterm.js

```bash
npm install xterm @xterm/addon-fit @xterm/addon-webgl
npm install --save-dev @types/xterm   # 如果需要
```

#### Step 2：创建 XTermRenderer 组件（新文件）

创建 `src/renderer/components/terminal/XTermRenderer.tsx`：

```tsx
/**
 * XTermRenderer — 单个 xterm.js 终端实例的 React 封装
 */
import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

interface Props {
  terminalId: string;
}

export function XTermRenderer({ terminalId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    // 终端输入 → 发送到 Main 进程
    term.onData((data) => {
      window.api.terminal.write(terminalId, data);
    });

    // 接收终端输出
    const unsubOutput = window.api.terminal.onOutput((event) => {
      if (event.id === terminalId) {
        term.write(event.data);
      }
    });

    // resize 监听
    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    term.onResize(({ cols, rows }) => {
      window.api.terminal.resize(terminalId, cols, rows);
    });

    return () => {
      unsubOutput();
      observer.disconnect();
      term.dispose();
    };
  }, [terminalId]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
```

#### Step 3：创建 TerminalTile 组件（新文件）

创建 `src/renderer/components/terminal/TerminalTile.tsx`：

```tsx
/**
 * TerminalTile — 单个终端的 Tile 容器
 * 包含状态指示器 + xterm 渲染区
 */
import { XTermRenderer } from './XTermRenderer';
import { getTerminalProcessUI } from '@/renderer/stores/terminal-process-ui-map';

interface Props {
  id: string;
  state: string;
}

export function TerminalTile({ id, state }: Props): JSX.Element {
  const ui = getTerminalProcessUI(state);

  return (
    <div className="terminal-tile">
      <div className="terminal-tile-header">
        <span
          className="status-dot"
          style={{ backgroundColor: ui.statusDotColor }}
        />
        <span className="terminal-tile-id">{id}</span>
      </div>
      <div className="terminal-tile-body">
        <XTermRenderer terminalId={id} />
      </div>
    </div>
  );
}
```

#### Step 4：创建 TerminalGrid 组件（新文件）

创建 `src/renderer/components/terminal/TerminalGrid.tsx`：

```tsx
/**
 * TerminalGrid — CSS Grid 容器，自动排列多个终端
 * 使用已有的 calculateGridLayout 算法
 */
import { calculateGridLayout } from '@/shared/utils/grid-layout';
import { TerminalTile } from './TerminalTile';

interface TerminalInfo {
  id: string;
  state: string;
}

interface Props {
  terminals: TerminalInfo[];
}

export function TerminalGrid({ terminals }: Props): JSX.Element {
  const { cols, rows } = calculateGridLayout(terminals.length);

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap: '2px',
    width: '100%',
    height: '100%',
    background: '#000',
  };

  return (
    <div style={gridStyle}>
      {terminals.map((t) => (
        <TerminalTile key={t.id} id={t.id} state={t.state} />
      ))}
    </div>
  );
}
```

#### Step 5：集成到 App.tsx

修改 `src/renderer/App.tsx`，在 `<main>` 区域挂载 TerminalGrid：

```tsx
import { useState, useEffect } from 'react';
import { TerminalGrid } from './components/terminal/TerminalGrid';

// 在 App 组件里：
const [terminals, setTerminals] = useState<Array<{ id: string; state: string }>>([]);

// 初始化时获取终端列表（如果有持久化的）
useEffect(() => {
  window.api.terminal.list().then((result) => {
    if (result.success) setTerminals(result.data);
  });
}, []);
```

#### Step 6：在 BottomBar 添加新建终端按钮

修改 `src/renderer/components/layout/BottomBar.tsx`，添加 "+" 按钮，调用 `window.api.terminal.create()`。

#### Step 7：验证

```bash
npm test                    # 609 仍全绿
npm run build               # 构建成功
npm run dev                 # 启动后点击 "+" 按钮，应该看到真实终端
                            # 输入 ls、pwd 等命令，应该有输出
                            # 再点 "+" 创建第二个，Grid 应自动变成 2 列
```

### 已有可复用文件

| 文件 | 内容 | 用途 |
|------|------|------|
| `src/shared/utils/grid-layout.ts` | `calculateGridLayout(count)` → `{ cols, rows, lastRowCentered, distribution }` | Grid 行列计算 |
| `src/renderer/stores/grid-resize.ts` | `createGridResizeManager()` — 边框拖拽调整列宽/行高比例 | 可选：后续 A7 拖拽调整时用 |
| `src/renderer/stores/terminal-process-ui-map.ts` | `getTerminalProcessUI(state)` → 颜色/动画/输入状态 | Tile 状态指示器 |
| `src/renderer/components/tile/tile-styles.ts` | Tile 样式配置 | 可参考 |

---

## 重要文件速查

| 文件 | 说明 |
|------|------|
| `DEV-PLAN.md` | 完整技术架构文档（1358 行），A2/A4 的详细规格在 §9 功能 A |
| `CLAUDE.md` | 项目指南（命令、架构、测试体系） |
| `src/shared/constants/channels.ts` | 全部 IPC channel 常量（10 域 60+ channel） |
| `src/shared/types/terminal.types.ts` | 终端域全部类型定义 |
| `src/main/index.ts` | Electron 主入口（A2 需要在这里注册 IPC handlers） |
| `src/preload/index.ts` | contextBridge（`window.api.terminal.*` 已全部定义好） |
| `src/renderer/App.tsx` | 根组件（A4 需要在这里挂载 TerminalGrid） |
| `electron.vite.config.ts` | 构建配置 |

---

## DI 模式示范

这是本项目替换桩代码的核心模式，**每个需要真实 I/O 的模块都用这个模式**：

```typescript
// 1. 定义适配器接口
export interface XxxAdapter {
  doSomething(input: string): Promise<Result>;
}

// 2. 工厂函数接受可选的 deps 参数
export function createXxxManager(deps?: { adapter?: XxxAdapter }) {
  return {
    async process(input: string) {
      if (deps?.adapter) {
        // 真实路径：生产环境
        return deps.adapter.doSomething(input);
      }
      // 桩路径：测试环境（保持原有行为）
      return { success: true };
    },
  };
}

// 3. 生产环境：注入真实适配器
const manager = createXxxManager({ adapter: createRealXxxAdapter() });

// 4. 测试环境：不传 deps 或传 mock — 原有 609 测试不受影响
const manager = createXxxManager();
```

---

## 完成标准

- [ ] `npm install node-pty && npx electron-rebuild` 成功
- [ ] `npm install xterm @xterm/addon-fit @xterm/addon-webgl` 成功
- [ ] `npm test` → 609 passed
- [ ] `npm run build` → 构建成功
- [ ] `npm run dev` → 能创建真实终端、输入命令有输出
- [ ] 创建多个终端时 Grid 自动排列
- [ ] 关闭终端时从 Grid 移除

---

## 注意事项

1. **不要修改 `tests/` 目录下的任何文件**
2. **不要修改 `vitest.config.ts`**
3. **修改已有文件时小心保持导出签名兼容**，否则测试会断
4. node-pty 在 macOS 上需要 Xcode Command Line Tools，确保 `xcode-select --install` 已执行
5. xterm.js 的 CSS 文件 `xterm/css/xterm.css` 需要在 Vite 配置中正确处理（electron-vite 默认支持）
6. DEV-PLAN 里 A2 估时 2 天、A4 估时 2 天
