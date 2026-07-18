/**
 * 顶部菜单栏屏（specs/behavior/menu-bar.md）+ 用户下拉屏（specs/behavior/user-dropdown.md）。
 * 纯 props 吃 fixture（base 底图 + auth/update payload），永不 mock IPC。
 * screen='user-dropdown' = menu-bar + 下拉菜单 open 终态直渲。
 * ⚠️ legacy 实况无「返回平铺」钮与语言切换器（menu-bar.md 头注），不发明 UI。
 */

import { TerminalScreen } from '../TerminalScreen';
import { baseFixture } from '../popover/base';
import './menubar.css';

export interface AuthPayload {
  username: string;
  email?: string;
  provider: string;
  avatarDataUri: string;
}

export type UpdatePayload =
  | { state: 'downloading'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { state: 'done'; version: string } // 加性（menu-bar.md §0 注记 2026-07-13）：live 接线 done 态
  | { state: 'error' };

export type TabId = 'terminals' | 'skills' | 'mcp' | 'hooks' | 'plugins' | 'chat';

/** live 壳（LiveChrome）传入的可选交互回调；golden 屏一律不传 → onClick=undefined、DOM 逐字节不变。 */
export interface MenuBarHandlers {
  onTabClick?: (tab: TabId) => void;
  onLoginClick?: () => void;
  onHelpClick?: () => void;
  onSettingsClick?: () => void;
  /** 头像下拉开合（B5；golden 不传 → 静态终态直渲不变）。 */
  onUserToggle?: () => void;
  /** 登出（B5；user-dropdown.md 登出项）。 */
  onLogout?: () => void;
}

/** 六 tab 文案（中间四个 legacy 双语言均硬编码英文，MenuBar.tsx:149-167）。
 * MAJOR-1 回修：终端/历史聊天 + icon 钮 title + 登出随 locale（legacy menu./auth. en 键逐字）；
 * locale 缺省 zh → golden/旧调用零变。 */
const MENUBAR_STR = {
  zh: { terminals: '终端', chat: '历史聊天', login: '登录', help: '帮助', settings: '设置', logout: '登出' },
  en: { terminals: 'Terminal', chat: 'Chat History', login: 'Login', help: 'Help', settings: 'Settings', logout: 'Logout' },
} as const;

function tabsFor(locale: 'zh' | 'en'): { id: TabId; label: string }[] {
  const t = MENUBAR_STR[locale];
  return [
    { id: 'terminals', label: t.terminals },
    { id: 'skills', label: 'Skills' },
    { id: 'mcp', label: 'MCP' },
    { id: 'hooks', label: 'Hooks' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'chat', label: t.chat },
  ];
}

/** legacy UpdateProgress.tsx:19-22 同款 */
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const RING_CIRCUMFERENCE = 56.55; // 2 * PI * 9

function UpdateProgress({ update }: { update: UpdatePayload }): JSX.Element {
  const downloading = update.state === 'downloading';
  const done = update.state === 'done';
  // 环 offset（legacy UpdateProgress.tsx:60-63）：downloading 按 percent；done 走满（0）；error 空环。
  const offset = downloading
    ? RING_CIRCUMFERENCE * (1 - update.percent / 100)
    : done
      ? 0
      : RING_CIRCUMFERENCE; // error
  const cls = downloading
    ? ''
    : done
      ? ' update-progress--done update-progress--fade-out'
      : ' update-progress--error update-progress--fade-out';
  return (
    <div className={`update-progress${cls}`}>
      <svg className="update-progress__ring" viewBox="0 0 24 24">
        <circle className="update-progress__ring-track" cx="12" cy="12" r="9" />
        <circle
          className="update-progress__ring-fill"
          cx="12"
          cy="12"
          r="9"
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <span className="update-progress__icon">
        {downloading ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M19 12l-7 7-7-7" />
          </svg>
        ) : done ? (
          // 绿对勾（legacy :81-84；配色 --done 规则 menubar.css）
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
      </span>

      <div className="update-progress__tooltip">
        <div className="update-progress__tooltip-title">
          {downloading ? '正在下载更新...' : done ? `v${update.version} 下载完成` : '下载失败'}
        </div>
        {downloading && (
          <>
            <div className="update-progress__tooltip-bar">
              <div className="update-progress__tooltip-bar-fill" style={{ width: `${update.percent}%` }} />
            </div>
            <div className="update-progress__tooltip-info">
              <span>
                {formatBytes(update.transferred)} / {formatBytes(update.total)}
              </span>
              <span className="update-progress__tooltip-speed">{formatBytes(update.bytesPerSecond)}/s</span>
            </div>
          </>
        )}
        {done && (
          <div className="update-progress__tooltip-info">
            <span>下次启动时自动更新</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ auth, menu }: { auth: AuthPayload; menu?: boolean }): JSX.Element {
  const cls = menu ? 'user-dropdown__menu-avatar' : 'user-dropdown__avatar';
  if (auth.avatarDataUri) {
    return <img className={cls} src={auth.avatarDataUri} alt={auth.username} />;
  }
  return (
    <span className={`${cls}-placeholder`}>
      {(auth.username || auth.email || '?')[0].toUpperCase()}
    </span>
  );
}

function UserDropdown({
  auth,
  open,
  onToggle,
  onLogout,
  logoutLabel = '登出',
}: {
  auth: AuthPayload;
  open: boolean;
  onToggle?: () => void;
  onLogout?: () => void;
  logoutLabel?: string;
}): JSX.Element {
  return (
    <div className="user-dropdown">
      <button className="user-dropdown__trigger" onClick={onToggle}>
        <Avatar auth={auth} />
      </button>
      {open && (
        <div className="user-dropdown__menu">
          <div className="user-dropdown__info">
            <Avatar auth={auth} menu />
            <div className="user-dropdown__details">
              <span className="user-dropdown__name">{auth.username || auth.email}</span>
              <span className="user-dropdown__provider">{auth.provider}</span>
            </div>
          </div>
          <div className="user-dropdown__divider" />
          <button className="user-dropdown__logout-btn" onClick={onLogout}>{logoutLabel}</button>
        </div>
      )}
    </div>
  );
}

/**
 * 纯展示菜单栏（header.menu-bar）：golden 屏（MenuBarScreen）与 live 壳（LiveChrome）共用视觉件。
 * 无 handler（golden 路径）→ onClick=undefined，DOM/类名/像素与既往逐字节一致；
 * live 传 handler → 激活 tab 路由 / 设置齿轮 / 登录 / 帮助。auth=null → 登录 icon；update=null → 无 UpdateProgress。
 */
export function MenuBar({
  count,
  activeTab,
  auth,
  update,
  dropdownOpen,
  onTabClick,
  onLoginClick,
  onHelpClick,
  onSettingsClick,
  onUserToggle,
  onLogout,
  locale = 'zh',
  hideAuth = false,
}: {
  count: number;
  activeTab: TabId;
  auth: AuthPayload | null;
  update: UpdatePayload | null;
  dropdownOpen?: boolean;
  /** MAJOR-1 回修：live 传 cfg.language；golden 不传 → zh 零变。 */
  locale?: 'zh' | 'en';
  /** 登录入口隐藏（features.ts LOGIN_UI_ENABLED）：仅 live 传；golden 不传 → false 零变。 */
  hideAuth?: boolean;
} & MenuBarHandlers): JSX.Element {
  const t = MENUBAR_STR[locale];
  const TABS = tabsFor(locale);
  return (
    <header className="menu-bar">
      <div className="menu-bar__drag-region" />

      <span className="menu-bar__title">Muxvo</span>

      <nav className="menu-bar__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`menu-bar__tab${activeTab === tab.id ? ' menu-bar__tab--active' : ''}`}
            onClick={onTabClick ? () => onTabClick(tab.id) : undefined}
          >
            {tab.label}
            {tab.id === 'terminals' && count > 0 && (
              <span className="menu-bar__badge">{count}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="menu-bar__right-group">
        {update && <UpdateProgress update={update} />}
        {!hideAuth && (auth ? (
          <UserDropdown auth={auth} open={dropdownOpen ?? false} onToggle={onUserToggle} onLogout={onLogout} logoutLabel={t.logout} />
        ) : (
          <button className="menu-bar__icon-btn" title={t.login} onClick={onLoginClick}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>
        ))}
        <button className="menu-bar__icon-btn" title={t.help} onClick={onHelpClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        <button className="menu-bar__icon-btn" title={t.settings} onClick={onSettingsClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}

export function MenuBarScreen({ fx }: { fx: any }): JSX.Element {
  const base = baseFixture(fx);
  const auth = (fx.auth ?? null) as AuthPayload | null;
  const update = (fx.update ?? null) as UpdatePayload | null;
  const activeTab: TabId = fx.menuBar?.activeTab ?? 'terminals';
  const dropdownOpen = fx.screen === 'user-dropdown';
  const count = base.terminals.length;

  return (
    <div className="app">
      <MenuBar
        count={count}
        activeTab={activeTab}
        auth={auth}
        update={update}
        dropdownOpen={dropdownOpen}
      />
      <main className="app-content">
        <TerminalScreen fx={base} />
      </main>
    </div>
  );
}
