/**
 * Electron API Mock 工具
 *
 * 模拟 Electron 的 BrowserWindow、app 等 API。
 * 当源代码就绪后，可替换为 electron-mock 或 spectron。
 */

// --- BrowserWindow Mock ---

export interface MockBrowserWindowOptions {
  width?: number;
  height?: number;
  title?: string;
  show?: boolean;
}

export class MockBrowserWindow {
  id: number;
  width: number;
  height: number;
  title: string;
  isVisible: boolean;
  isFocused: boolean;
  isDestroyed: boolean;

  private static nextId = 1;

  constructor(options: MockBrowserWindowOptions = {}) {
    this.id = MockBrowserWindow.nextId++;
    this.width = options.width ?? 1400;
    this.height = options.height ?? 900;
    this.title = options.title ?? 'Muxvo';
    this.isVisible = options.show ?? true;
    this.isFocused = false;
    this.isDestroyed = false;
  }

  setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }): void {
    if (bounds.width) this.width = bounds.width;
    if (bounds.height) this.height = bounds.height;
  }

  getBounds() {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  focus(): void {
    this.isFocused = true;
  }

  blur(): void {
    this.isFocused = false;
  }

  close(): void {
    this.isDestroyed = true;
    this.isVisible = false;
  }

  show(): void {
    this.isVisible = true;
  }

  hide(): void {
    this.isVisible = false;
  }

  static resetIdCounter(): void {
    MockBrowserWindow.nextId = 1;
  }
}

// --- App Lifecycle Mock ---

export type AppState = 'not-started' | 'launching' | 'restoring' | 'running' | 'saving' | 'closing';

export class MockApp {
  state: AppState = 'not-started';
  private windows: MockBrowserWindow[] = [];

  async launch(): Promise<void> {
    this.state = 'launching';
    // Simulate restore check
    this.state = 'restoring';
    this.state = 'running';
  }

  createWindow(options?: MockBrowserWindowOptions): MockBrowserWindow {
    const win = new MockBrowserWindow(options);
    this.windows.push(win);
    return win;
  }

  getWindows(): MockBrowserWindow[] {
    return this.windows.filter((w) => !w.isDestroyed);
  }

  async quit(): Promise<void> {
    this.state = 'saving';
    this.windows.forEach((w) => w.close());
    this.state = 'closing';
  }

  reset(): void {
    this.state = 'not-started';
    this.windows = [];
    MockBrowserWindow.resetIdCounter();
  }
}
