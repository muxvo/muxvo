/**
 * chat-history live chrome（M5-R1 批3 W1，用户拍板：进聊天历史后顶部 tab 栏保留）：MenuBar（activeTab='chat'）
 * + ChatHistoryLive（`.chat-history-overlay` 本就 fixed top:36px，正好嵌 36px 菜单栏之下）+ 等待浮卡。
 *
 * tab 路由（本壳 onTabClick）：
 *  - 终端 tab → chatClose（native 半 setPanelMode(.terminal) → 回终端 chrome）
 *  - 历史聊天 tab → no-op（已在此）
 *  - 配置 tab（skills/mcp/hooks/plugins）/ 齿轮 settings → 面板意图信箱：setPendingPanel + chatClose；
 *    回终端后 LiveChrome 挂载即 consumePendingPanel 打开对应面板（跨 lazy chunk 单例，见 panelIntent.ts）。
 *
 * 仅 main.tsx 的 `bridge && panelMode==='chatHistory'` 分支经 React.lazy 挂载（截图/浏览器直开到不了这里）——
 * 本模块与 ChatHistoryLive 同处 chat lazy chunk，不入 main 静态图（截图契约隔离铁律）。
 */

import { memo, useEffect, useState } from 'react';
import type { BridgeApi } from '../../../bridge/client';
import type { Fixture } from '../../../fixture/types';
import { ConfigProvider } from '../../../config/ConfigContext';
import { AuthProvider, useAuth } from '../../../config/AuthContext';
import { useConfig } from '../../../config/ConfigContext';
import { MenuBar } from '../../menubar/MenuBarScreen';
import type { AuthPayload, TabId } from '../../menubar/MenuBarScreen';
import type { PanelId } from '../../live/panelRegistry';
import { setPendingPanel } from '../../live/panelIntent';
import { requestLoginOpen } from '../../live/loginIntent';
import { LOGIN_UI_ENABLED } from '../../../config/features';
import { LiveWaitingCard } from '../../live/LiveWaitingCard';
import { chatCloseAction } from './actions';
import { ChatHistoryLive } from './ChatHistoryLive';
import '../../menubar/menubar.css';

/** 配置 tab → 面板身份（与 LiveChrome.tabToPanel 同映射；terminals/chat 无配置面板 → null）。 */
function tabToPanel(tab: TabId): PanelId | null {
  switch (tab) {
    case 'skills':
    case 'mcp':
    case 'hooks':
    case 'plugins':
      return tab;
    default:
      return null;
  }
}

/**
 * `active`（问题3b 保活）：容器隐藏时 false——透传 ChatHistoryLive 门控 Esc/清瞬态。默认 true 兼容旧直挂调用方。
 */
function ChatHistoryChromeImpl({
  fx,
  bridge,
  active = true,
}: {
  fx: Fixture;
  bridge: BridgeApi;
  active?: boolean;
}): JSX.Element {
  return (
    // ConfigProvider（R7.3 归档开关）：ChatHistoryLive 经 useConfig/useConfigApi 读 archiveEnabled + 发 PrefsPatch。
    // AuthProvider（B5）：Body 内 useAuth 读登录态（provider 须在消费方之上，故拆 Body 层）。
    // 与 LiveRoot 同款 live-only 挂载；bridge≠null 恒真，golden 路径到不了此 chrome。
    <ConfigProvider bridge={bridge}>
      <AuthProvider bridge={bridge}>
        <ChatHistoryChromeBody fx={fx} bridge={bridge} active={active} />
      </AuthProvider>
    </ConfigProvider>
  );
}

function ChatHistoryChromeBody({
  fx,
  bridge,
  active,
}: {
  fx: Fixture;
  bridge: BridgeApi;
  active: boolean;
}): JSX.Element {
  const onTabClick = (tab: TabId): void => {
    if (tab === 'chat') return; // 已在聊天历史：no-op
    if (tab === 'terminals') {
      bridge.sendAction(chatCloseAction()); // 回终端态
      return;
    }
    // 配置 tab：先投面板意图信箱，再 chatClose 回终端 → LiveChrome 挂载消费信箱开面板。
    const target = tabToPanel(tab);
    if (target) setPendingPanel(target);
    bridge.sendAction(chatCloseAction());
  };

  const onSettingsClick = (): void => {
    // 齿轮 settings 非 tab，但同走信箱：回终端后 LiveChrome 开 settings 面板。
    setPendingPanel('settings');
    bridge.sendAction(chatCloseAction());
  };

  const onHelpClick = (): void => {
    // 问号=帮助会话（menu-bar.md §6，B3）：legacy 全局可用——聊天视图里点也生效。先 chatClose
    // 回终端态（legacy closeAllPanels 对齐），再 helpOpen（native 建终端+选中+注入 claude 读 guide）。
    bridge.sendAction(chatCloseAction());
    bridge.sendAction({ kind: 'helpOpen' });
  };

  // —— 登录态（B5；legacy MenuBar 全局一致——聊天视图同显头像/登录 icon）。 ——
  const cfg = useConfig();
  const { auth } = useAuth();
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
  useEffect(() => {
    if (!loggedIn) setDropdownOpen(false);
  }, [loggedIn]);
  useEffect(() => {
    if (!dropdownOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.user-dropdown')) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dropdownOpen]);
  const onLoginClick = (): void => {
    // 登录弹窗宿主在 LiveChrome（终端树）：投信箱 + chatClose 回终端后打开（tour 信箱同族）。
    requestLoginOpen();
    bridge.sendAction(chatCloseAction());
  };

  return (
    <div className="app live-chrome">
      <MenuBar
        count={fx.terminals.length}
        activeTab="chat"
        auth={authPayload}
        update={null}
        dropdownOpen={dropdownOpen}
        locale={cfg?.language === 'en' ? 'en' : 'zh'}
        hideAuth={!LOGIN_UI_ENABLED}
        onTabClick={onTabClick}
        onSettingsClick={onSettingsClick}
        onHelpClick={onHelpClick}
        onLoginClick={onLoginClick}
        onUserToggle={() => setDropdownOpen((v) => !v)}
        onLogout={() => {
          setDropdownOpen(false);
          void bridge.sendAppRequest({ kind: 'authLogout' }).catch(() => {});
        }}
      />
      <ChatHistoryLive fx={fx} bridge={bridge} active={active} />
      {/* 等待浮卡（DOGFOOD_M3_18）：聊天历史 = 非终端 tile 视图，显示浮卡，点正文经 chatClose 回终端。 */}
      <LiveWaitingCard
        fx={fx}
        sendAction={(action) => bridge.sendAction(action)}
        onSwitchToTerminals={() => bridge.sendAction(chatCloseAction())}
      />
    </div>
  );
}

/**
 * 保活跳渲（问题3b）：双隐藏（前后都 active=false）时跳过 FixtureHost 每推重渲——隐藏面板无需跟拍 fx；
 * active 翻转（显↔隐）必重渲（切可见性 + 触发 ChatHistoryLive 的 active effect）。可见期照常跟拍。
 */
export const ChatHistoryChrome = memo(
  ChatHistoryChromeImpl,
  (prev, next) => !prev.active && !next.active,
);
