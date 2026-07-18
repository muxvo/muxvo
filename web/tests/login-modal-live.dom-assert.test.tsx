// @vitest-environment jsdom
//
// LoginModalLive 状态机（右上角批 B5；login-modal.md §1/§5，legacy LoginModal.tsx 行为对齐）：
// mode 机 / 条款守卫（含取消不执行）/ 错误条中文映射+3s 自清 / 验证码 60s 冷却。
// 真 ConfigProvider+AuthProvider（假桥）；OAuth/网络全走假 sendAppRequest。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ConfigProvider } from '../src/config/ConfigContext';
import { AuthProvider } from '../src/config/AuthContext';
import { LoginModalLive } from '../src/screen/modal/LoginModalLive';
import type { BridgeApi } from '../src/bridge/client';
import type { AppRequest, AppResponse, ConfigRequest, ConfigSnapshot } from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function snapshotFixture(): ConfigSnapshot {
  return {
    startupTerminalCount: 1,
    doubleClickToFocus: false,
    dockBadgeMode: 'realtime',
    dockBadgeIntervalMin: 1,
    defaultTerminalCwd: '',
    showHiddenFiles: false,
    language: 'zh',
    theme: 'dark',
    terminalThemeName: 'dark',
    fontSize: 14,
    gridLayout: { columnRatios: [1], rowRatios: [1] },
    ftvLeftWidth: 250,
    ftvRightWidth: 280,
    archiveEnabled: true,
    tourCompleted: true,
  };
}

function makeBridge(
  onApp: (req: AppRequest) => AppResponse | Promise<AppResponse>,
): { bridge: BridgeApi; appReqs: AppRequest[] } {
  const appReqs: AppRequest[] = [];
  const bridge: BridgeApi = {
    sendAction: vi.fn(),
    sendTelemetry: vi.fn(),
    sendTermCommand: vi.fn(),
    sendOrchCommand: vi.fn(),
    sendOrchQuery: vi.fn(),
    sendFsRequest: vi.fn(),
    subscribeDataEvent: vi.fn(() => () => {}),
    getAppVersion: vi.fn(() => null),
    sendChatRequest: vi.fn(),
    sendConfigRequest: vi.fn((req: ConfigRequest) => {
      if (req.kind === 'get') return Promise.resolve({ kind: 'snapshot' as const, config: snapshotFixture() });
      return Promise.resolve({ kind: 'rejected' as const, code: 'X', message: 'X' });
    }),
    sendAppRequest: vi.fn((req: AppRequest) => {
      appReqs.push(req);
      // authStatus（AuthProvider 挂载拉取）默认未登录
      if (req.kind === 'authStatus') {
        return Promise.resolve({ kind: 'authState' as const, auth: { loggedIn: false } });
      }
      return Promise.resolve(onApp(req));
    }),
  };
  return { bridge, appReqs };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const onClose = vi.fn();

async function mount(bridge: BridgeApi): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(ConfigProvider, {
        bridge,
        children: createElement(AuthProvider, {
          bridge,
          children: createElement(LoginModalLive, { onClose }),
        }),
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function click(sel: string): Promise<void> {
  const el = container!.querySelector(sel);
  if (!el) throw new Error(`无元素 ${sel}`);
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function clickLink(text: string): Promise<void> {
  const el = [...container!.querySelectorAll('.login-modal__link')].find((b) =>
    b.textContent?.includes(text),
  );
  if (!el) throw new Error(`无链接 ${text}`);
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function agreeTermsInto(mode: 'email' | 'github'): Promise<void> {
  await click(`.login-modal__oauth-btn--${mode === 'email' ? 'email' : 'github'}`);
  await click('.login-modal__terms-confirm-agree');
}

function setInput(sel: string, value: string): Promise<void> {
  const el = container!.querySelector(sel) as HTMLInputElement;
  return act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const title = (): string => container!.querySelector('.login-modal__title')?.textContent ?? '';

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  onClose.mockClear();
});

describe('LoginModalLive 状态机（B5）', () => {
  test('AUTH_UI_mode_machine：buttons→login→register→buttons；forgot back→login（legacy back 规则）', async () => {
    const { bridge } = makeBridge(() => ({ kind: 'authAck' }));
    await mount(bridge);
    expect(title()).toBe('Muxvo 登录');

    await agreeTermsInto('email'); // 邮箱入口过条款守卫 → login
    expect(title()).toBe('登录');
    await clickLink('创建账号');
    expect(title()).toBe('创建账号');
    await click('.login-modal__back-btn'); // register back → buttons
    expect(title()).toBe('Muxvo 登录');

    // 重进 login → forgot → back 回 login（非 buttons）
    await click('.login-modal__oauth-btn--email'); // agreed 已置，不再弹守卫
    expect(title()).toBe('登录');
    await clickLink('忘记密码');
    expect(title()).toBe('重置密码');
    await click('.login-modal__back-btn');
    expect(title()).toBe('登录');
  });

  test('AUTH_UI_terms_guard：未同意先弹二层；取消不执行；同意并继续执行挂起动作（OAuth 发起）', async () => {
    const { bridge, appReqs } = makeBridge(() => ({ kind: 'authAck' }));
    await mount(bridge);

    await click('.login-modal__oauth-btn--github');
    expect(container!.querySelector('.login-modal__terms-confirm'), '守卫二层弹出').not.toBeNull();
    expect(appReqs.filter((r) => r.kind === 'authLoginOAuth'), '未同意不发请求').toHaveLength(0);

    await click('.login-modal__terms-confirm-cancel');
    expect(container!.querySelector('.login-modal__terms-confirm'), '取消关二层').toBeNull();
    expect(appReqs.filter((r) => r.kind === 'authLoginOAuth'), '取消不执行挂起动作').toHaveLength(0);

    await click('.login-modal__oauth-btn--github');
    await click('.login-modal__terms-confirm-agree');
    expect(appReqs.filter((r) => r.kind === 'authLoginOAuth')).toEqual([
      { kind: 'authLoginOAuth', provider: 'github' },
    ]);
  });

  test('AUTH_UI_error_autoclear：rejected → 稳定码映射中文错误条 → 3s 自清（legacy CLEAR_ERROR）', async () => {
    const { bridge } = makeBridge(() => ({
      kind: 'rejected',
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    }));
    await mount(bridge);
    await agreeTermsInto('email');
    await setInput('input[type="email"]', 'a@b.co');
    await setInput('input[type="password"]', 'wrongpass');
    // 自清定时器须挂在假时钟上 → 提交前切 fake（mount/表单期用真时钟）。
    vi.useFakeTimers();
    try {
      await click('.login-modal__login-btn');
      const bar = container!.querySelector('.login-modal__error-bar');
      expect(bar?.textContent, '稳定码 → 中文').toBe('邮箱或密码错误');
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(container!.querySelector('.login-modal__error-bar'), '3s 自清').toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('AUTH_UI_locale_en：cfg.language=en → 标题/按钮全英文（MAJOR-1 回修，legacy en.ts 逐字）', async () => {
    const { bridge } = makeBridge(() => ({ kind: 'authAck' }));
    // 英文快照：覆盖 makeBridge 的 get 响应
    (bridge.sendConfigRequest as ReturnType<typeof vi.fn>).mockImplementation((req: ConfigRequest) => {
      if (req.kind === 'get') {
        return Promise.resolve({
          kind: 'snapshot' as const,
          config: { ...snapshotFixture(), language: 'en' },
        });
      }
      return Promise.resolve({ kind: 'rejected' as const, code: 'X', message: 'X' });
    });
    await mount(bridge);
    expect(title()).toBe('Login to Muxvo');
    const github = container!.querySelector('.login-modal__oauth-btn--github');
    expect(github?.textContent).toContain('Continue with GitHub');
    await agreeTermsInto('email');
    expect(title()).toBe('Login');
  });

  test('错误条手动 ✕ 即清（MINOR-1 回修，legacy dismiss 钮）', async () => {
    const { bridge } = makeBridge(() => ({
      kind: 'rejected',
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'bad',
    }));
    await mount(bridge);
    await agreeTermsInto('email');
    await setInput('input[type="email"]', 'a@b.co');
    await setInput('input[type="password"]', 'x');
    await click('.login-modal__login-btn');
    expect(container!.querySelector('.login-modal__error-bar')).not.toBeNull();
    await click('.login-modal__error-dismiss');
    expect(container!.querySelector('.login-modal__error-bar'), '✕ 即清不等 3s').toBeNull();
  });

  test('AUTH_UI_cooldown：发送验证码 → authAck → 60s 冷却（钮 disabled 显示 60s → 递减）', async () => {
    const { bridge, appReqs } = makeBridge(() => ({ kind: 'authAck' }));
    await mount(bridge);
    await agreeTermsInto('email');
    await clickLink('创建账号');
    await setInput('input[type="email"]', 'a@b.co');
    // 冷却定时器须挂在假时钟上 → 发送前切 fake。
    vi.useFakeTimers();
    try {
      await click('.login-modal__send-code-btn');
      expect(appReqs.filter((r) => r.kind === 'authSendEmailCode')).toEqual([
        { kind: 'authSendEmailCode', email: 'a@b.co', purpose: 'register' },
      ]);
      const btn = (): HTMLButtonElement =>
        container!.querySelector('.login-modal__send-code-btn') as HTMLButtonElement;
      expect(btn().disabled, '冷却中 disabled').toBe(true);
      expect(btn().textContent).toBe('60s');
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(btn().textContent, '每秒递减').toBe('59s');
    } finally {
      vi.useRealTimers();
    }
  });
});
