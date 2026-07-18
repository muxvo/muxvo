// @vitest-environment jsdom
//
// B5 登记6（terminal-session-restore.md §4 顶部横幅 form 半）：会话恢复顶部横幅 web 渲染。
// 两类计数任一 >0 出条、文案与 native durable log 口径一致、× 关闭发 dismissRestoreBanner；
// 计数全 0 / 缺席不渲染（截图/纯展示 golden 零差异）。
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LiveRestoreBanner } from '../src/screen/live/LiveRestoreBanner';
import type { RestoreBanner, UIAction } from '../src/bridge/gen/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(banner: RestoreBanner | null, onAction: (a: UIAction) => void): Promise<void> {
  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(createElement(LiveRestoreBanner, { banner, onAction }));
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = '';
});

beforeEach(() => {
  container = null;
  root = null;
});

describe('会话恢复顶部横幅（B5 登记6）', () => {
  test('无法恢复计数 >0：出条 + 文案与 native durable log 口径一致', async () => {
    await render({ cannotRestoreCount: 2, crashLoopPausedCount: 0 }, vi.fn());
    const bar = container!.querySelector('[data-restore-banner]');
    expect(bar, '横幅应渲染').toBeTruthy();
    expect(container!.querySelector('.live-restore-banner__text')!.textContent).toBe(
      '2 个会话无法在本机恢复',
    );
  });

  test('熔断暂停计数 >0：文案与 native crashLoopBody 口径一致', async () => {
    await render({ cannotRestoreCount: 0, crashLoopPausedCount: 3 }, vi.fn());
    expect(container!.querySelector('.live-restore-banner__text')!.textContent).toBe(
      '3 个会话反复崩溃，已暂停自动恢复，可手动重开',
    );
  });

  test('两类计数皆 >0：两条文案以「；」相接', async () => {
    await render({ cannotRestoreCount: 1, crashLoopPausedCount: 2 }, vi.fn());
    expect(container!.querySelector('.live-restore-banner__text')!.textContent).toBe(
      '1 个会话无法在本机恢复；2 个会话反复崩溃，已暂停自动恢复，可手动重开',
    );
  });

  test('× 关闭 → 发 dismissRestoreBanner 动作', async () => {
    const onAction = vi.fn();
    await render({ cannotRestoreCount: 1, crashLoopPausedCount: 0 }, onAction);
    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('.live-restore-banner__dismiss')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledWith({ kind: 'dismissRestoreBanner' });
  });

  test('缺席 / 计数全 0 → 不渲染（golden 零差异）', async () => {
    const onAction = vi.fn();
    await render(null, onAction);
    expect(container!.querySelector('[data-restore-banner]'), '缺席不渲染').toBeNull();
    await render({ cannotRestoreCount: 0, crashLoopPausedCount: 0 }, onAction);
    expect(container!.querySelector('[data-restore-banner]'), '计数全 0 不渲染').toBeNull();
  });
});
