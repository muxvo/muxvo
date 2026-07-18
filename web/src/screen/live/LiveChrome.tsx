/**
 * live 应用外壳（M6 批1）：仅 live 模式（bridge≠null）经 main.tsx 挂载，包住桥接线的
 * TerminalScreen，补顶部 36px 菜单栏 + 配置面板路由 overlay。截图/纯展示模式不渲染本壳
 * （main.tsx 直渲 TerminalScreen）→ golden 逐字节零差异。
 *
 * 面板路由（互斥，CONFIG_L1_09/19/20/21/25）：单一 panel state（skills|mcp|hooks|plugins|
 * settings|null）天然互斥；tab 点击 = 直接替换 state（= closeAll 再开目标），终端 tab / Esc = 关闭
 * （CONFIG_L1_15）。菜单栏复用 MenuBar 视觉件（auth=null 登录 icon、update=null 无进度环、
 * terminalCount 取 ui.state、activeTab 由面板路由推导）。
 *
 * 菜单栏挤压：复用 legacy `.app`/`.app-content` 壳（menubar.css，菜单栏 36px flex-shrink:0），
 * 终端网格自然下移 36px；TerminalScreen 的 useLayoutReport 按视口几何重报洞位，无需额外接线。
 *
 * 面板 overlay：fixed top:36px 全屏、data-hit-island（盖住终端洞 → 点击归 web，native 抠掉洞区）。
 * 面板 live 组件由 A3 经 panelRegistry 交付；未注册 → 空槽（overlay 带 data-live-panel、内容 null）。
 */

import { useEffect, useState } from 'react';
import type { FsRequest, FsResponse, TermCommandRequest, TermCommandResponse, UIAction } from '../../bridge/gen/protocol';
import type { Fixture } from '../../fixture/types';
import { TerminalScreen } from '../TerminalScreen';
import { MenuBar } from '../menubar/MenuBarScreen';
import type { AuthPayload, TabId, UpdatePayload } from '../menubar/MenuBarScreen';
import { WhatsNewModalLive } from './WhatsNewModalLive';
import { HookEnabledNoticeLive } from './HookEnabledNoticeLive';
import { LegacyMigrationNoticeLive } from './LegacyMigrationNoticeLive';
import { getLivePanel, type PanelId } from './panelRegistry';
import { clearPendingPanel, peekPendingPanel } from './panelIntent';
import { subscribeLoginOpen } from './loginIntent';
import { LiveWaitingCard } from './LiveWaitingCard';
import { LiveRestoreBanner } from './LiveRestoreBanner';
import { LiveOnboarding } from './LiveOnboarding';
import { LoginModalLive } from '../modal/LoginModalLive';
import { useAuth } from '../../config/AuthContext';
import { useConfig, useConfigApi } from '../../config/ConfigContext';
import { LOGIN_UI_ENABLED } from '../../config/features';
import '../menubar/menubar.css';
import './live-chrome.css';
// 副作用：触发 A3/A2 面板 live 组件的 registerLivePanel 注册（本文件是 A3 登记面）。
import './registerLivePanels';

/** tab → 面板身份（skills/mcp/hooks/plugins 同名；terminals/chat 无配置面板 → null）。 */
function tabToPanel(tab: TabId): PanelId | null {
  switch (tab) {
    case 'skills':
    case 'mcp':
    case 'hooks':
    case 'plugins':
      return tab;
    default:
      return null; // terminals（关全部）、chat（历史聊天，非配置面板，批1 不路由）
  }
}

/** 面板身份 → 高亮 tab（settings 齿轮不是 tab → 回落 terminals；null 亦 terminals）。 */
function panelToTab(panel: PanelId | null): TabId {
  switch (panel) {
    case 'skills':
    case 'mcp':
    case 'hooks':
    case 'plugins':
      return panel;
    default:
      return 'terminals';
  }
}

export function LiveChrome({
  fx,
  onAction,
  onTermCommand,
  onFsRequest,
  onTermRequest,
}: {
  fx: Fixture;
  onAction: (action: UIAction) => void;
  onTermCommand: (req: TermCommandRequest) => void;
  /** M6 批A：fs.request 线缆（worktree/文件树/右键菜单），透传 TerminalScreen。 */
  onFsRequest?: (req: FsRequest) => Promise<FsResponse>;
  /** M6 批A：term.command 带响应版（worktree 行点击/拖拽 insertText），透传 TerminalScreen。 */
  onTermRequest?: (req: TermCommandRequest) => Promise<TermCommandResponse>;
}): JSX.Element {
  // 挂载初值读面板意图信箱（W1）：从聊天历史点配置 tab/齿轮 → setPendingPanel + chatClose 回终端 →
  // 本壳挂载即打开对应面板（无/过期 → null 正常终端态）。初始化器只 peek（纯读，StrictMode 双调得同值，
  // 对抗 M-2）；清除放挂载 effect（幂等）——勿在初始化器里读走即清，否则 dev StrictMode 第二次得 null 吞掉意图。
  const [panel, setPanel] = useState<PanelId | null>(() => peekPendingPanel());

  useEffect(() => {
    clearPendingPanel(); // 一次性消费落定：挂载后清空信箱（双 effect 幂等；防后续真重挂误读陈旧意图）。
  }, []);

  // 菜单栏更新指示器（auto-update.md §3-§5 / menu-bar.md §4）：data.event update* 推送驱动。
  // downloading 持续可见；done/error 3s 后隐藏（legacy UpdateProgress.tsx:41/47 setVisible(false)，
  // 淡出动画由 --fade-out CSS 承担）。无桥（截图/浏览器直开）恒 null → golden 零感知。
  const api = useConfigApi();
  const [update, setUpdate] = useState<UpdatePayload | null>(null);
  useEffect(() => {
    if (!api) return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = api.subscribeDataEvent((event) => {
      switch (event.kind) {
        case 'updateDownloading':
          clearTimeout(hideTimer);
          setUpdate({
            state: 'downloading',
            percent: event.percent,
            transferred: event.transferred,
            total: event.total,
            bytesPerSecond: event.bytesPerSecond,
          });
          break;
        case 'updateDownloaded':
          clearTimeout(hideTimer);
          setUpdate({ state: 'done', version: event.version });
          hideTimer = setTimeout(() => setUpdate(null), 3000);
          break;
        case 'updateError':
          clearTimeout(hideTimer);
          setUpdate({ state: 'error' });
          hideTimer = setTimeout(() => setUpdate(null), 3000);
          break;
        default:
          break;
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(hideTimer);
    };
  }, [api]);

  const closePanel = (): void => setPanel(null);

  // —— 登录态（B5）：AuthContext 权威登录态 → MenuBar 头像/登录 icon 两态 + LoginModalLive 开合。 ——
  const configApi = useConfigApi();
  const cfg = useConfig();
  const { auth } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const loggedIn = !!auth?.loggedIn && !!auth.user;
  const authPayload: AuthPayload | null = loggedIn
    ? {
        username: auth!.user!.username,
        email: auth!.user!.email,
        provider: auth!.user!.provider,
        avatarDataUri: auth!.user!.avatarUrl ?? '',
      }
    : null;
  // 登出/过期 → 下拉收起；登录成功 → 弹窗关（LoginModalLive 自关，这里兜底）。
  useEffect(() => {
    if (!loggedIn) setDropdownOpen(false);
    else setLoginOpen(false);
  }, [loggedIn]);
  // 下拉外点关闭（legacy mousedown 监听）。
  useEffect(() => {
    if (!dropdownOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.user-dropdown')) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dropdownOpen]);
  // 聊天历史 chrome（独立树）点登录 → 信箱开弹窗。
  useEffect(() => subscribeLoginOpen(() => setLoginOpen(true)), []);

  const onTabClick = (tab: TabId): void => {
    // 历史聊天 tab（W1）→ chatOpen（native 半 setPanelMode(.chatHistory)），不动面板 state。
    if (tab === 'chat') {
      onAction({ kind: 'chatOpen' });
      return;
    }
    // 终端 tab → 关全部（CONFIG_L1_15）；配置 tab → 单 state 替换即互斥（closeAll 再开，CONFIG_L1_09/19）
    const target = tabToPanel(tab);
    setPanel(target);
  };

  // dogfood-r3 问题5：overlay 面板开合上报 native（⌘+/- 路由态；panel 是 web 本地 state，native 不可见）。
  // 卸载 cleanup 发 false；native 侧 setPanelMode 切换另有防御清空（双兜底）。
  const overlayOpen = panel != null;
  useEffect(() => {
    if (!overlayOpen) return;
    onAction({ kind: 'panelOverlayReport', source: 'panel', active: true });
    return () => onAction({ kind: 'panelOverlayReport', source: 'panel', active: false });
  }, [overlayOpen, onAction]);

  // Esc 关当前面板（CONFIG_L1_15）；bubble 相 + !defaultPrevented：面板在子级/dirty 时 capture 拦截
  // 并 stopPropagation → 本监听不触发（两级细节由 A3 面板内实现，见 panelRegistry 契约）。
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel]);

  const count = fx.terminals.length;
  const activeTab = panelToTab(panel);
  const PanelComp = panel ? getLivePanel(panel) : undefined;

  return (
    <div className="app live-chrome">
      {/* 会话恢复顶部横幅（B5 登记6）：无法恢复/熔断计数任一 >0 时出，菜单栏之上；缺席则不占位。 */}
      <LiveRestoreBanner banner={fx.restoreBanner} onAction={onAction} />
      <MenuBar
        count={count}
        activeTab={activeTab}
        auth={authPayload}
        update={update}
        dropdownOpen={dropdownOpen}
        locale={cfg?.language === 'en' ? 'en' : 'zh'}
        onTabClick={onTabClick}
        onSettingsClick={() => setPanel('settings')}
        onHelpClick={() => {
          // 问号=帮助会话（menu-bar.md §6，B3）：先关覆盖面板（legacy closeAllPanels 对齐）再发
          // helpOpen——native 一条龙：满上限静默 / 建终端自动选中 / 静默门注入 claude 读 guide.md。
          setPanel(null);
          onAction({ kind: 'helpOpen' });
        }}
        hideAuth={!LOGIN_UI_ENABLED}
        onLoginClick={() => setLoginOpen(true)}
        onUserToggle={() => setDropdownOpen((v) => !v)}
        onLogout={() => {
          // 登出（user-dropdown.md；legacy：服务尽力吊销+本地必登出——native AuthManager 保证）。
          setDropdownOpen(false);
          void configApi?.sendAppRequest({ kind: 'authLogout' }).catch(() => {});
        }}
      />
      <main className="app-content">
        <TerminalScreen fx={fx} onAction={onAction} onTermCommand={onTermCommand} onFsRequest={onFsRequest} onTermRequest={onTermRequest} />
      </main>
      {panel && (
        // fixed top:36px 全屏槽；data-hit-island 令 native 把面板区从终端穿透区抠掉（面板盖住洞）。
        // __zoom 内层（dogfood-r3 问题5）：CSS zoom 挂内层——挂 overlay 自身会把其 top:36px 一并倍乘。
        <div className="live-panel-overlay" data-hit-island="" data-live-panel={panel}>
          <div className="live-panel-overlay__zoom">
            {PanelComp ? <PanelComp onClose={closePanel} /> : null}
          </div>
        </div>
      )}
      {/* 等待浮卡（DOGFOOD_M3_18）：配置面板 tile 视图（Skills/MCP/Hooks/Plugins）激活 = legacy
          overlayActive → 显示浮卡，点正文 closePanel 回终端。settings 非 tile 视图，legacy overlayActive
          排除（WaitingInputNotification.tsx L74），故此处 panel!=='settings' 门控。 */}
      {panel && panel !== 'settings' && (
        <LiveWaitingCard fx={fx} sendAction={onAction} onSwitchToTerminals={closePanel} />
      )}
      {/* What's New（auto-update.md §7）：常驻挂载自管开合（更新后首启 2s 自动弹 + 设置面板链接手动开）。 */}
      <WhatsNewModalLive />
      {/* hook 首启自动启用一次性轻提示（wait-detector.md §7）：mount 查询即消费，show 才有 DOM。 */}
      <HookEnabledNoticeLive />
      {/* 老版聊天归档首启迁移提示（legacy-migration.md §7.2）：mount 查询即消费，迁移有命中才有 DOM。 */}
      <LegacyMigrationNoticeLive />
      {/* 首启欢迎卡 + 新手引导（右上角批 B4）：cfg.tourCompleted 门控 + 设置面板重放信箱。 */}
      <LiveOnboarding fx={fx} />
      {/* 登录弹窗（B5）：小人 icon/聊天树信箱打开；登录成功自关（LoginModalLive auth effect）。
          LOGIN_UI_ENABLED 门（features.ts）：入口已藏，此处双保险令信箱残留也开不出弹窗。 */}
      {LOGIN_UI_ENABLED && loginOpen && !loggedIn && <LoginModalLive onClose={() => setLoginOpen(false)} />}
    </div>
  );
}
