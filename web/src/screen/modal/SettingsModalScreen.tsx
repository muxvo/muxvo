/**
 * 设置弹窗屏（specs/behavior/settings-modal.md）：420px 居中 modal，五 section
 * （通用/外观/快捷键/语言/帮助）。纯 props 吃 fixture（settings payload），永不 mock IPC。
 * update 非 null：帮助区在 80vh 折叠线下，fonts.ready 后滚到底并打 data-fx-scrolled
 * （与 golden 侧驱动器对称，_CONTRACT.md settings 滚动约定）。
 */

import { useEffect, useRef } from 'react';
import '../../styles/surfaces.css';
import './modals.css';

interface SettingsConfig {
  startupTerminalCount?: number;
  doubleClickToFocus?: boolean;
  dockBadgeMode?: 'off' | 'realtime' | 'timed';
  dockBadgeIntervalMin?: number;
  defaultTerminalCwd?: string;
  terminalThemeName?: string;
}

interface SettingsPayload {
  appVersion: string;
  config: SettingsConfig;
  /** 加性扩展（settings-modal.md §0 注记 2026-07-13）：live 三态 status 变体；fixture 屏
   *  仍只传 null/{version} → 现有 golden DOM 零动。文案=auto-update.md §10 表（legacy :381-394）。 */
  update: { version: string } | { status: 'checking' | 'up-to-date' | 'error' } | null;
  /** 加性扩展（wait-detector.md §7 单绑定入口，2026-07-16）：终端等待检测行；缺席/null =
   *  行不渲染——golden fixture 不传 hooks → 现有 4 张 set-* golden DOM 零动（update 三态同款先例）。
   *  disabled（禁装门分身）由 Live 层折算 null，不进本屏。 */
  hooks?: {
    state: 'installed' | 'notInstalled' | 'drift' | 'foreignBound';
    reason?: string;
    pending?: boolean;
  } | null;
}

/** 屏级文案表（spec §5：legacy locales/{zh,en}.ts settings.* + SettingsModal.tsx:363-396 直写三元） */
const STR = {
  zh: {
    title: '设置',
    general: '通用',
    startupTerminals: '启动终端数量',
    startupTerminalsDesc: '每次打开 Muxvo 自动创建的终端数量',
    doubleClickFocus: '双击聚焦',
    doubleClickFocusDesc: '双击终端切换到全屏聚焦模式',
    enabled: '启用',
    disabled: '关闭',
    defaultTerminalCwd: '终端默认路径',
    defaultTerminalCwdDesc: '新建终端时使用的初始工作目录',
    defaultTerminalCwdPlaceholder: '默认为用户主目录',
    browse: '浏览',
    clear: '清除',
    dockBadge: 'Dock 角标通知',
    dockBadgeDesc: '终端等待输入时在 Dock 图标上显示数字角标',
    dockBadgeOff: '关闭',
    dockBadgeRealtime: '实时',
    dockBadgeTimed: '定时',
    dockBadgeInterval: '检查间隔',
    dockBadgeIntervalUnit: '分钟',
    waitDetect: '终端等待检测',
    waitDetectDescOff: '检测终端何时在等你回复，并及时提醒你',
    waitDetectDescOn: '已启用',
    waitDetectDescDrift: '配置需要升级',
    waitDetectBtnEnable: '启用',
    waitDetectBtnDisable: '停用',
    waitDetectBtnReenable: '重新启用',
    waitDetectPending: '等待确认…',
    appearance: '外观',
    theme: '主题',
    themeLight: '亮色',
    themeDark: '暗色',
    shortcuts: '快捷键',
    shortcutNewTerminal: '新建终端',
    shortcutLineStart: '跳转行首',
    shortcutLineEnd: '跳转行尾',
    zoom: '缩放',
    language: '语言',
    lang: '界面语言',
    langZh: '中文',
    langEn: 'English',
    help: '帮助',
    restartTour: '新手引导',
    restartTourDesc: '再次查看新手引导教程',
    checkUpdateLabel: '检查更新',
    currentVersion: '当前版本',
    whatsNewLink: '查看更新内容',
    checkBtn: '检查更新',
    downloadBtn: '下载',
    checkingText: '检查中...',
    upToDateText: '已是最新版本',
    checkFailedText: '检查失败',
  },
  en: {
    title: 'Settings',
    general: 'General',
    startupTerminals: 'Startup Terminals',
    startupTerminalsDesc: 'Number of terminals to create when Muxvo starts',
    doubleClickFocus: 'Double-click Focus',
    doubleClickFocusDesc: 'Double-click a terminal to enter focused mode',
    enabled: 'On',
    disabled: 'Off',
    defaultTerminalCwd: 'Default Terminal Directory',
    defaultTerminalCwdDesc: 'Initial working directory for new terminals',
    defaultTerminalCwdPlaceholder: 'Defaults to home directory',
    browse: 'Browse',
    clear: 'Clear',
    dockBadge: 'Dock Badge',
    dockBadgeDesc: 'Show badge count on dock icon when terminals are waiting for input',
    dockBadgeOff: 'Off',
    dockBadgeRealtime: 'Real-time',
    dockBadgeTimed: 'Timed',
    dockBadgeInterval: 'Interval',
    dockBadgeIntervalUnit: 'min',
    waitDetect: 'Terminal Wait Detection',
    waitDetectDescOff: 'Detect when a terminal is waiting for your reply and remind you',
    waitDetectDescOn: 'Enabled',
    waitDetectDescDrift: 'Configuration needs upgrade',
    waitDetectBtnEnable: 'Enable',
    waitDetectBtnDisable: 'Disable',
    waitDetectBtnReenable: 'Re-enable',
    waitDetectPending: 'Awaiting confirmation…',
    appearance: 'Appearance',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    shortcuts: 'Shortcuts',
    shortcutNewTerminal: 'New Terminal',
    shortcutLineStart: 'Jump to Line Start',
    shortcutLineEnd: 'Jump to Line End',
    zoom: 'Zoom',
    language: 'Language',
    lang: 'Interface Language',
    langZh: '中文',
    langEn: 'English',
    help: 'Help',
    restartTour: 'Beginner Guide',
    restartTourDesc: 'View the beginner guide again',
    checkUpdateLabel: 'Check for Updates',
    currentVersion: 'Current version',
    whatsNewLink: "What's New",
    checkBtn: 'Check',
    downloadBtn: 'Download',
    checkingText: 'Checking...',
    upToDateText: 'Up to date',
    checkFailedText: 'Check failed',
  },
} as const;

/** 齿轮图标（legacy SettingsModal.tsx:152-155 同款 path） */
function GearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ToggleGroup({ items }: { items: { label: string; active: boolean }[] }): JSX.Element {
  return (
    <div className="settings-modal__toggle-group">
      {items.map((it) => (
        <button
          key={it.label}
          className={`settings-modal__toggle-btn${it.active ? ' settings-modal__toggle-btn--active' : ''}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsModalScreen({ fx }: { fx: any }): JSX.Element {
  const t = STR[(fx.locale as 'zh' | 'en') ?? 'zh'];
  const settings: SettingsPayload = fx.settings ?? { appVersion: '', config: {}, update: null };
  const cfg = settings.config ?? {};
  const count = cfg.startupTerminalCount ?? 1;
  const dblClick = cfg.doubleClickToFocus === true;
  const badgeMode = cfg.dockBadgeMode ?? 'realtime';
  const interval = cfg.dockBadgeIntervalMin ?? 1;
  const cwd = cfg.defaultTerminalCwd ?? '';
  // ☆M6 主题批：终端配色下拉当前值（缺省 dark，terminal-theme.md §1；未知名由渲染端 select 落空——
  // native 侧 resolveTheme 回退 dark 是权威，此处仅显示）。5 选项键序 = terminal-theme.md §1。
  const termThemeName = cfg.terminalThemeName ?? 'dark';
  const termThemeOptions: Array<{ value: string; label: string }> = [
    { value: 'dark', label: t.themeDark },
    { value: 'light', label: t.themeLight },
    { value: 'monokai', label: 'Monokai' },
    { value: 'dracula', label: 'Dracula' },
    { value: 'solarized-dark', label: 'Solarized Dark' },
  ];
  // legacy 同款平台条件（SettingsModal.tsx:112）：dock 角标行仅 macOS 渲染
  const isMac = navigator.platform.startsWith('Mac');
  const modalRef = useRef<HTMLDivElement>(null);

  // update 态：滚到底让帮助区入画（golden 侧驱动器对称动作）
  useEffect(() => {
    if (!settings.update) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled || !modalRef.current) return;
      modalRef.current.scrollTop = modalRef.current.scrollHeight;
      modalRef.current.setAttribute('data-fx-scrolled', '');
    });
    return () => {
      cancelled = true;
    };
    // fixture 整屏以 key 重挂，单次执行即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="settings-modal__backdrop">
      <div className="settings-modal" ref={modalRef}>
        <div className="settings-modal__header">
          <div className="settings-modal__title">
            <GearIcon />
            {t.title}
          </div>
          <button className="settings-modal__close">{'✕'}</button>
        </div>

        <div className="settings-modal__body">
          {/* 通用 */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t.general}</div>
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{t.startupTerminals}</div>
                <div className="settings-modal__desc">{t.startupTerminalsDesc}</div>
              </div>
              <div className="settings-modal__stepper">
                <button className="settings-modal__stepper-btn" disabled={count <= 1}>
                  {'−'}
                </button>
                <span className="settings-modal__stepper-value">{count}</span>
                <button className="settings-modal__stepper-btn" disabled={count >= 20}>
                  {'+'}
                </button>
              </div>
            </div>
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{t.doubleClickFocus}</div>
                <div className="settings-modal__desc">{t.doubleClickFocusDesc}</div>
              </div>
              <ToggleGroup
                items={[
                  { label: t.enabled, active: dblClick },
                  { label: t.disabled, active: !dblClick },
                ]}
              />
            </div>
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{t.defaultTerminalCwd}</div>
                <div className="settings-modal__desc">{t.defaultTerminalCwdDesc}</div>
              </div>
              <div className="settings-modal__cwd-controls">
                <span className="settings-modal__cwd-path" title={cwd || undefined}>
                  {cwd || t.defaultTerminalCwdPlaceholder}
                </span>
                <button className="settings-modal__tour-btn">{t.browse}</button>
                {cwd && <button className="settings-modal__tour-btn">{t.clear}</button>}
              </div>
            </div>
            {isMac && (
              <>
                <div className="settings-modal__row">
                  <div>
                    <div className="settings-modal__label">{t.dockBadge}</div>
                    <div className="settings-modal__desc">{t.dockBadgeDesc}</div>
                  </div>
                  <div className="settings-modal__badge-toggle">
                    {(
                      [
                        ['off', t.dockBadgeOff],
                        ['realtime', t.dockBadgeRealtime],
                        ['timed', t.dockBadgeTimed],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`settings-modal__badge-toggle-btn${badgeMode === mode ? ' settings-modal__badge-toggle-btn--active' : ''}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {badgeMode === 'timed' && (
                  <div className="settings-modal__badge-sub-row">
                    <div className="settings-modal__badge-sub-label">{t.dockBadgeInterval}</div>
                    <div className="settings-modal__badge-sub-controls">
                      <div className="settings-modal__stepper">
                        <button className="settings-modal__stepper-btn" disabled={interval <= 1}>
                          {'−'}
                        </button>
                        {/* MAJOR-2 回修：defaultValue+key（外部值变即重挂同步显示；本地敲键不冻结）
                            ——渲染出的 value 属性与原 readOnly 版逐字节同值；提交接线在 Live 层
                            （blur/Enter，legacy SettingsModal.tsx:255-264 语义）。 */}
                        <input
                          key={String(interval)}
                          className="settings-modal__stepper-input"
                          type="text"
                          inputMode="numeric"
                          defaultValue={String(interval)}
                          size={Math.max(1, String(interval).length)}
                        />
                        <button className="settings-modal__stepper-btn">{'+'}</button>
                      </div>
                      <span className="settings-modal__badge-sub-unit">{t.dockBadgeIntervalUnit}</span>
                    </div>
                  </div>
                )}
              </>
            )}
            {/* 终端等待检测行（wait-detector.md §7 单绑定入口，2026-07-16；§7 用户面归一，
                2026-07-17 产品口径）：hooks 缺席/null = 不渲染 → golden fixture 不传 hooks，
                4 张 set-* golden DOM 零动（update 三态先例）。
                foreignBound 渲染与 notInstalled **完全同构**（多实例概念不出用户可见面，用户
                裁决 2026-07-17）——接管语义只活在点「启用」后的 native 授权 sheet 语境句里。
                installed = 「已启用」+「停用」钮（opt-out）。
                按钮独立类 __hook-btn：避开 Live 委托 tour-btn 分支的 section/button 序算术。 */}
            {settings.hooks && (
              <div className="settings-modal__row">
                <div>
                  <div className="settings-modal__label">{t.waitDetect}</div>
                  <div className="settings-modal__desc">
                    {settings.hooks.state === 'installed'
                      ? t.waitDetectDescOn
                      : settings.hooks.state === 'drift'
                        ? settings.hooks.reason
                          ? `${t.waitDetectDescDrift} — ${settings.hooks.reason}`
                          : t.waitDetectDescDrift
                        : t.waitDetectDescOff}
                  </div>
                </div>
                <button
                  className="settings-modal__hook-btn"
                  disabled={settings.hooks.pending === true}
                >
                  {settings.hooks.pending
                    ? t.waitDetectPending
                    : settings.hooks.state === 'installed'
                      ? t.waitDetectBtnDisable
                      : settings.hooks.state === 'drift'
                        ? t.waitDetectBtnReenable
                        : t.waitDetectBtnEnable}
                </button>
              </div>
            )}
          </div>

          {/* 外观 */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t.appearance}</div>
            {/* ★ 用户裁决 2026-07-07（R1 合并，取代前「主题 toggle + 终端配色下拉」两行裁决）：
                外观区合成单行「主题」5 选下拉——界面亮暗由所选值派生（选亮色→light，其余四套皆
                dark 系配暗界面，terminal-theme.md §4 单选择器派生）。当前值绑 terminalThemeName。
                onChange 空实现避 controlled 警告；真实变更由 SettingsModalLive 顶层 onChange 委托
                （select 类名判定）→ set{theme+terminalThemeName} 双字段同写。截图/无桥态即静态显值。 */}
            <div className="settings-modal__row">
              <div className="settings-modal__label">{t.theme}</div>
              <select
                className="settings-modal__select"
                value={termThemeName}
                onChange={() => undefined}
              >
                {termThemeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 快捷键 */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t.shortcuts}</div>
            <div className="settings-modal__shortcut-list">
              <div className="settings-modal__shortcut-item">
                <span className="settings-modal__shortcut-label">{t.shortcutNewTerminal}</span>
                <kbd className="settings-modal__kbd">⌘T</kbd>
              </div>
              <div className="settings-modal__shortcut-item">
                <span className="settings-modal__shortcut-label">{t.shortcutLineStart}</span>
                <kbd className="settings-modal__kbd">⌘←</kbd>
              </div>
              <div className="settings-modal__shortcut-item">
                <span className="settings-modal__shortcut-label">{t.shortcutLineEnd}</span>
                <kbd className="settings-modal__kbd">⌘→</kbd>
              </div>
              <div className="settings-modal__shortcut-item">
                <span className="settings-modal__shortcut-label">{t.zoom}</span>
                <div className="settings-modal__kbd-group">
                  <kbd className="settings-modal__kbd">⌘+</kbd>
                  <kbd className="settings-modal__kbd">⌘-</kbd>
                  <kbd className="settings-modal__kbd">⌘0</kbd>
                </div>
              </div>
            </div>
          </div>

          {/* 语言 */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t.language}</div>
            <div className="settings-modal__row">
              <div className="settings-modal__label">{t.lang}</div>
              <ToggleGroup
                items={[
                  { label: t.langZh, active: (fx.locale ?? 'zh') === 'zh' },
                  { label: t.langEn, active: fx.locale === 'en' },
                ]}
              />
            </div>
          </div>

          {/* 帮助 */}
          <div className="settings-modal__section">
            <div className="settings-modal__section-title">{t.help}</div>
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{t.restartTour}</div>
                <div className="settings-modal__desc">{t.restartTourDesc}</div>
              </div>
              <button className="settings-modal__tour-btn">{t.restartTour}</button>
            </div>
            <div className="settings-modal__row">
              <div>
                <div className="settings-modal__label">{t.checkUpdateLabel}</div>
                <div className="settings-modal__desc">
                  {t.currentVersion} v{settings.appVersion}{' '}
                  <a href="#" className="settings-modal__whats-new-link">
                    {t.whatsNewLink}
                  </a>
                </div>
              </div>
              {settings.update && 'status' in settings.update ? (
                // live 三态（settings-modal.md §3-5 :381-394 复刻；fixture 屏不传 status → 分支不进 golden）
                settings.update.status === 'checking' ? (
                  <span className="settings-modal__desc">{t.checkingText}</span>
                ) : settings.update.status === 'up-to-date' ? (
                  <span className="settings-modal__desc">{t.upToDateText}</span>
                ) : (
                  <span className="settings-modal__desc" style={{ color: '#ff5f57' }}>
                    {t.checkFailedText}
                  </span>
                )
              ) : settings.update ? (
                <button className="settings-modal__tour-btn">
                  {t.downloadBtn} v{settings.update.version}
                </button>
              ) : (
                <button className="settings-modal__tour-btn">{t.checkBtn}</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
