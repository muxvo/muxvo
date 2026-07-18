/**
 * 设置弹窗 live 包装（M6 批1）：不改冻结的 golden 组件 SettingsModalScreen 的 DOM 契约（视觉由
 * ConfigContext snapshot → fixture props 映射驱动），交互经**结构化事件委托**接线
 * ——SettingsModalScreen 的 DOM 是冻结 golden（结构永不变），按「section 序 + 组内 button 序」定位
 * 控件稳定可靠，无需给 golden 加 onClick。
 *
 * 控件 → 桥写入（settings-modal.md §3）：
 *  - 启动终端数 stepper ∓1 → set{startupTerminalCount}（越界钮 disabled 天然不触发）
 *  - 双击聚焦 启用|关闭 → set{doubleClickToFocus}
 *  - 终端默认路径 浏览 → app.request selectDirectory → set{defaultTerminalCwd}；清除 → set{''}
 *  - Dock 角标 off|realtime|timed → set{dockBadgeMode}；timed 子行 stepper ∓1 → set{dockBadgeIntervalMin}
 *  - 外观「主题」下拉（5 套，R1 合并）→ change 委托 set{theme 派生 + terminalThemeName}（select 类名判定）
 *  - 语言 中文|English → set{language}
 *  - ✕ / backdrop → onClose（Esc 由 LiveChrome 顶层监听，见 panelRegistry 契约）
 *
 * 检查更新状态机（auto-update.md §6，兑现 settings-modal.md §5 挂账）：
 *  idle → 点「检查更新」→ checking + updateCheck 请求 + 8s 超时兜底判「已是最新」（legacy :121-125）；
 *  updateAvailable 推送随时 → available（下载按钮，legacy :130-138 不要求 checking）；
 *  updateNotAvailable → 仅 checking 中提前判「已是最新」（偏差④）；updateError → 仅 checking 中「检查失败」；
 *  available 点「下载 v{x}」→ updateDownload 请求 + 关闭设置弹窗（legacy :140-143）；
 *  每次打开设置面板 = 本组件重挂载 → 状态天然重置 idle（legacy :130-132 对等）。
 *  「查看更新内容」链接 → whatsNewIntent 手动开 What's New（不触 lastSeenVersion）。
 *
 * golden 铁律：本组件仅经 LiveChrome（live 模式）挂载；useConfig()/useConfigApi() 为 null（截图/无桥）
 * 即返回 null，不渲染任何 DOM。SettingsModalScreen 的 golden 截图路径不经过本组件。
 */

import { useEffect, useRef, useState } from 'react';
import { track } from '../../bridge/track';
import type {
  ChangeEvent as ReactChangeEvent,
  FocusEvent as ReactFocusEvent,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useConfig, useConfigApi } from '../../config/ConfigContext';
import type { LivePanelProps } from '../live/panelRegistry';
import type { ConfigSnapshot, HookInstallState } from '../../bridge/gen/protocol';
import { openWhatsNew } from '../live/whatsNewIntent';
import { requestTourStart } from '../live/tourIntent';
import { SettingsModalScreen } from './SettingsModalScreen';

type UpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';

/** 终端等待检测行态（wait-detector.md §7 单绑定入口）：null = 不渲染（未拉到/禁装门 disabled）。 */
type HookRow = { state: Exclude<HookInstallState, 'disabled'>; reason?: string } | null;

/** ConfigSnapshot → SettingsModalScreen 的 fixture props（只映射设置弹窗消费的字段）。 */
function toFixture(
  cfg: ConfigSnapshot,
  appVersion: string,
  updateStatus: UpdateStatus,
  newVersion: string,
  hookRow: HookRow,
  hookPending: boolean
): unknown {
  const update =
    updateStatus === 'available'
      ? { version: newVersion }
      : updateStatus === 'idle'
        ? null
        : { status: updateStatus };
  return {
    locale: cfg.language === 'en' ? 'en' : 'zh',
    theme: cfg.theme,
    settings: {
      appVersion,
      config: {
        startupTerminalCount: cfg.startupTerminalCount,
        doubleClickToFocus: cfg.doubleClickToFocus,
        dockBadgeMode: cfg.dockBadgeMode,
        dockBadgeIntervalMin: cfg.dockBadgeIntervalMin,
        defaultTerminalCwd: cfg.defaultTerminalCwd,
        terminalThemeName: cfg.terminalThemeName,
      },
      update,
      // hooks 缺席/null = 行不渲染（golden 同款加性缝，wait-detector.md §7）。
      hooks: hookRow ? { ...hookRow, pending: hookPending } : null,
    },
  };
}

/** 组内 button 序（直接子 button，跳过 stepper 中间的 value span / cwd 的 path span）。 */
function buttonIndex(btn: HTMLElement): number {
  const parent = btn.parentElement;
  if (!parent) return -1;
  return [...parent.querySelectorAll(':scope > button')].indexOf(btn);
}

/** section 序（通用0/外观1/快捷键2/语言3/帮助4，与 isMac 无关——isMac 只增 General 内的 row）。 */
function sectionIndex(btn: HTMLElement): number {
  const modal = btn.closest('.settings-modal');
  const section = btn.closest('.settings-modal__section');
  if (!modal || !section) return -1;
  return [...modal.querySelectorAll('.settings-modal__section')].indexOf(section);
}

/** 帮助区行序（0=新手引导、1=检查更新；settings-modal.md §3-5 行结构冻结）。 */
function helpRowIndex(btn: HTMLElement): number {
  const section = btn.closest('.settings-modal__section');
  const row = btn.closest('.settings-modal__row');
  if (!section || !row) return -1;
  return [...section.querySelectorAll('.settings-modal__row')].indexOf(row);
}

export function SettingsModalLive({ onClose }: LivePanelProps): JSX.Element | null {
  const cfg = useConfig();
  const api = useConfigApi();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [newVersion, setNewVersion] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 终端等待检测行（wait-detector.md §7 单绑定入口）：mount 拉一次 hookStatus（pull-only，
  // enable 响应即带终态免推送）；disabled（禁装门分身）折算 null → 行不渲染，不广告已禁死功能。
  const [hookRow, setHookRow] = useState<HookRow>(null);
  const [hookPending, setHookPending] = useState(false);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .sendAppRequest({ kind: 'hookStatus' })
      .then((r) => {
        if (cancelled || r.kind !== 'hookStatus' || r.state === 'disabled') return;
        setHookRow({ state: r.state, reason: r.reason });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  // update* 推送订阅（auto-update.md §6）：available 开着期间随时生效；notAvailable/error 仅 checking 中。
  useEffect(() => {
    if (!api) return;
    const unsubscribe = api.subscribeDataEvent((event) => {
      switch (event.kind) {
        case 'updateAvailable':
          clearTimeout(timeoutRef.current); // 真结果到达：8s 兜底 timer 已无意义，清除免游离（对抗 MINOR-5）
          setNewVersion(event.version);
          setUpdateStatus('available');
          break;
        case 'updateNotAvailable':
          clearTimeout(timeoutRef.current);
          setUpdateStatus((prev) => (prev === 'checking' ? 'up-to-date' : prev));
          break;
        case 'updateError':
          clearTimeout(timeoutRef.current);
          setUpdateStatus((prev) => (prev === 'checking' ? 'error' : prev));
          break;
        default:
          break;
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timeoutRef.current);
    };
  }, [api]);

  if (!cfg || !api) return null; // 无桥/截图模式：不渲染（golden 安全）

  const handleCheckUpdate = (): void => {
    setUpdateStatus('checking');
    api
      .sendAppRequest({ kind: 'updateCheck' })
      .then(() => {
        // 8s 超时兜底判「已是最新」（legacy :123-125；真推送到达会提前迁移=偏差④）。
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setUpdateStatus((prev) => (prev === 'checking' ? 'up-to-date' : prev));
        }, 8000);
      })
      .catch(() => setUpdateStatus('error')); // 请求本身失败（legacy :126）
  };

  const handleDownloadUpdate = (): void => {
    void api.sendAppRequest({ kind: 'updateDownload' }).catch(() => {});
    onClose(); // 点下载关闭设置弹窗（legacy :140-143）
  };

  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    // 「查看更新内容」链接 → What's New（不触 lastSeenVersion，auto-update.md §7）。
    if (target.closest('a.settings-modal__whats-new-link')) {
      e.preventDefault();
      openWhatsNew();
      return;
    }
    // backdrop 空白处点击（非弹窗内元素）→ 关闭
    if (target.classList.contains('settings-modal__backdrop')) {
      onClose();
      return;
    }
    const btn = target.closest('button') as HTMLElement | null;
    if (!btn) return;
    if (btn.classList.contains('settings-modal__close')) {
      onClose();
      return;
    }

    const bIdx = buttonIndex(btn);

    if (btn.classList.contains('settings-modal__stepper-btn')) {
      const inInterval = !!btn.closest('.settings-modal__badge-sub-row');
      if (inInterval) {
        void api.set({ dockBadgeIntervalMin: cfg.dockBadgeIntervalMin + (bIdx === 0 ? -1 : 1) });
      } else {
        void api.set({ startupTerminalCount: cfg.startupTerminalCount + (bIdx === 0 ? -1 : 1) });
      }
      return;
    }

    if (btn.classList.contains('settings-modal__badge-toggle-btn')) {
      const mode = bIdx === 0 ? 'off' : bIdx === 1 ? 'realtime' : 'timed';
      void api.set({ dockBadgeMode: mode });
      return;
    }

    if (btn.classList.contains('settings-modal__toggle-btn')) {
      const sIdx = sectionIndex(btn);
      if (sIdx === 0) void api.set({ doubleClickToFocus: bIdx === 0 }); // 通用: 启用|关闭
      else if (sIdx === 3) void api.set({ language: bIdx === 0 ? 'zh' : 'en' }); // 语言（外观已改单下拉，无 toggle）
      return;
    }

    if (btn.classList.contains('settings-modal__hook-btn')) {
      // 终端等待检测（wait-detector.md §7）：按当前态分流——installed → hookDisable（uninstall +
      // opt-out 记档，无 sheet 直达）；其余（notInstalled/foreignBound/drift）→ hookEnable →
      // native sheet 授权确认在缝内（foreignBound 的接管语境句只活在 sheet 里，§7 用户面归一），
      // 响应即终态（取消 = 当前态原样回）。pending 防重入（按钮同时 disabled）。
      if (hookPending) return;
      setHookPending(true);
      const kind = hookRow?.state === 'installed' ? 'hookDisable' : 'hookEnable';
      void api
        .sendAppRequest({ kind })
        .then((r) => {
          if (r.kind === 'hookStatus' && r.state !== 'disabled') {
            setHookRow({ state: r.state, reason: r.reason });
          }
        })
        .catch(() => {})
        .finally(() => setHookPending(false));
      return;
    }

    if (btn.classList.contains('settings-modal__tour-btn')) {
      const sIdx = sectionIndex(btn);
      if (sIdx === 0) {
        // cwd controls: 直接 button 序 0=浏览、1=清除
        if (bIdx === 0) {
          void api
            .sendAppRequest({ kind: 'selectDirectory', defaultPath: cfg.defaultTerminalCwd || undefined })
            .then((r) => {
              if (r.kind === 'directorySelected') void api.set({ defaultTerminalCwd: r.path });
            })
            .catch(() => {});
        } else {
          void api.set({ defaultTerminalCwd: '' });
        }
        return;
      }
      if (sIdx === 4) {
        // 帮助区（auto-update.md §6 + 右上角批 B4 合成）：行0=新手引导重放（legacy
        // handleRestartTour：关面板 100ms 后 START_TOUR，跳过欢迎卡不重置 tourCompleted →
        // tourIntent 信箱，LiveOnboarding 消费）；行1=检查更新/下载（auto-update 五态）。
        if (helpRowIndex(btn) === 0) {
          onClose();
          setTimeout(() => requestTourStart(), 100);
        } else if (helpRowIndex(btn) === 1) {
          if (updateStatus === 'available') handleDownloadUpdate();
          else handleCheckUpdate();
        }
      }
      return;
    }
  };

  // 外观「主题」下拉（R1 合并）：select 非 button，走 change 事件（React onChange 冒泡到本包裹层），
  // 按 class 判定后**双字段同写** set{theme + terminalThemeName}——界面亮暗由所选值派生（选 light→
  // light，其余四套皆 dark 系配暗界面，terminal-theme.md §4 单选择器派生；跟随/粘住已废）。
  const onChange = (e: ReactChangeEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('settings-modal__select')) {
      const value = (target as HTMLSelectElement).value;
      void api.set({ theme: value === 'light' ? 'light' : 'dark', terminalThemeName: value });
      track('settings.theme_changed', { theme: value });
    }
  };

  // dock 角标「定时间隔」手输框（MAJOR-2 回修；legacy SettingsModal.tsx:255-264）：输入即剥非数字，
  // blur/Enter 提交（parseInt，<1/非法 → 回退 1）。控件 = .settings-modal__stepper-input（timed 子行唯一）。
  const commitIntervalInput = (el: HTMLInputElement): void => {
    const parsed = parseInt(el.value.replace(/\D/g, ''), 10);
    const next = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    if (next !== cfg.dockBadgeIntervalMin) void api.set({ dockBadgeIntervalMin: next });
    else el.value = String(next); // 同值不发桥，但把 '03'/'abc' 之类原样输入归一回显
  };
  const onInput = (e: ReactFormEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLInputElement;
    if (target.classList?.contains('settings-modal__stepper-input')) {
      const digits = target.value.replace(/\D/g, '');
      if (digits !== target.value) target.value = digits;
    }
  };
  const onBlur = (e: ReactFocusEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLInputElement;
    if (target.classList?.contains('settings-modal__stepper-input')) commitIntervalInput(target);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLInputElement;
    if (e.key === 'Enter' && target.classList?.contains('settings-modal__stepper-input')) {
      commitIntervalInput(target);
    }
  };

  return (
    <div
      onClick={onClick}
      onChange={onChange}
      onInput={onInput}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      data-live-settings=""
    >
      <SettingsModalScreen
        fx={toFixture(cfg, api.getAppVersion() ?? '', updateStatus, newVersion, hookRow, hookPending)}
      />
    </div>
  );
}
