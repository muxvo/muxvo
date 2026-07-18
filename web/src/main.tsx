/**
 * 入口：--screenshot-mode（?screenshot=1）暴露 window.__loadFixture 契约，
 * 供 muxvo/tools/visual-diff 截图（契约见其 fixtures/_CONTRACT.md）。
 * 浏览器直开（无桥宿主）时加载内置演示 fixture 方便人工预览；WKWebView 宿主内初始空渲，
 * 等桥首帧 ui.state（假数据绝不示人——启动期弹窗阻塞过首帧推送，演示终端曾挂整个弹窗期）。
 *
 * 截图契约隔离（铁律，bridge-v1.md §3）：?screenshot=1 时 bridge 路径一行不执行——
 * bridge/client 仅经下方 !screenshotMode 分支动态 import，无静态 import 副作用。
 * （ConfigContext 只 `import type { BridgeApi }`、subscribeDataEvent 挂 BridgeApi，故「TermGrid→ConfigContext」
 *   配置链不构成到 client.ts 的静态值边——M6B1-WEB-1 修，令本不变量重为真。）
 */

import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { Fixture } from './fixture/types';
import type { BridgeApi } from './bridge/client'; // type-only：类型擦除，零运行时引用
import { TerminalScreen } from './screen/TerminalScreen';
// 编排通道（开源前置重构第 4 步）：编排面板状态/取数/渲染整段收进 orchChannel（main 对编排零感知）；
// 公开仓 overlay 用返 null 的 stub 覆盖 orchChannel → 本文件零 patch、编排面板永不渲染。
import { useOrchChannel } from './bridge/orchChannel';
import { SCREEN_READY_SELECTOR, SCREEN_REGISTRY } from './screen/registry';
import { demoFixture } from './fixture/demo';
import './styles/theme.css';
import './styles/term-grid.css';
import './styles/live-transparent.css';
import './styles/panel-zoom.css'; // dogfood-r3 问题5：规则全挂 .muxvo-live 前缀，截图路径零像素影响

// live 子树（菜单栏 + 配置面板 + ConfigProvider）经 lazy 载入 → 独立 chunk，令本模块静态图不含
// bridge/client 运行时引用（截图契约隔离铁律，bridge-v1.md §3）。仅 bridge≠null 分支渲染，故不入截图路径。
const LiveRoot = lazy(() => import('./screen/live/LiveRoot').then((m) => ({ default: m.LiveRoot })));

// chat-history live chrome（M5 批4 → M5-R1 批3 W1 顶部 tab 栏保留）：同经 lazy 独立 chunk（bridge/client
// 运行时引用不入 main 静态图，截图契约隔离铁律）。仅 bridge≠null && panelMode==='chatHistory' 分支渲染。
// Chrome = MenuBar（activeTab='chat'）+ ChatHistoryLive + 等待浮卡（LiveWaitingCard 语义收进壳内）。
const ChatHistoryChrome = lazy(() =>
  import('./screen/chat/live/ChatHistoryChrome').then((m) => ({ default: m.ChatHistoryChrome })),
);

const params = new URLSearchParams(location.search);
const screenshotMode = params.get('screenshot') === '1';
// WKWebView 宿主检测：纯属性嗅探（判式与 bridge/client.ts initBridge 的 port 取用同源），
// 零 bridge import——截图契约隔离铁律（上方头注释）不受扰。
const bridgeHosted = !!(window as any).webkit?.messageHandlers?.muxvo;

/** 问题3b 保活容器隐藏态样式（不用 display:none → 保浏览态/scrollTop/布局树；配 inert + aria-hidden 断交互）。 */
const HIDDEN_KEEPALIVE_STYLE: CSSProperties = { visibility: 'hidden', pointerEvents: 'none' };

if (screenshotMode) {
  // 截图确定性：禁动画/过渡/光标
  const style = document.createElement('style');
  style.textContent =
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.head.appendChild(style);
}

function FixtureHost(): JSX.Element | null {
  // 桥宿主内初始 null（等首帧 ui.state，if (!fx) 空渲兜底）；仅浏览器直开渲演示 fixture。
  const [fx, setFx] = useState<Fixture | null>(screenshotMode || bridgeHosted ? null : demoFixture);
  const [bridge, setBridge] = useState<BridgeApi | null>(null);
  // 编排通道：编排面板状态/取数/渲染整段封装（bridge 传入 → 取数闭包恒指当前存活桥）。main 只 spread
  // bridgeListeners 进 initBridge、在 taskCenter 分支调 renderPanel，不识任何 orch 类型（可被 stub 整体替换）。
  const orchChannel = useOrchChannel(bridge);
  // 问题3b 聊天历史面板保活：首次进入后常驻挂载（chatEverOpenedRef 懒挂载闸），隐藏时仅切可见性。
  const chatEverOpenedRef = useRef(false);
  const chatKeepaliveRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const w = window as any;
    w.__loadFixture = (data: Fixture) => {
      w.__fixtureReady = false;
      document.documentElement.setAttribute('data-theme', data.theme);
      setFx(data);
      // 浮层/modal 屏：等目标终态元素就位才置 ready（registry 登记选择器，与 golden 侧对称；
      // B2 起条目可为函数——按 fixture 内容取终态选择器）
      const readyEntry = SCREEN_READY_SELECTOR[data.screen ?? ''];
      const readySelector = typeof readyEntry === 'function' ? readyEntry(data) : readyEntry;
      document.fonts.ready.then(() => {
        const arm = () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              w.__fixtureReady = true;
            });
          });
        };
        if (!readySelector) {
          arm();
          return;
        }
        const poll = () => {
          if (document.querySelector(readySelector)) arm();
          else requestAnimationFrame(poll);
        };
        poll();
      });
    };
    w.__fixturePageUp = true;
  }, []);

  useEffect(() => {
    if (screenshotMode) return; // 铁律闸门：截图模式 bridge 零执行
    void import('./bridge/client').then(({ initBridge }) => {
      const api = initBridge({
        onState: (state) => {
          document.documentElement.setAttribute('data-theme', state.theme);
          // dogfood-r3 问题5：面板缩放因子 → CSS 变量（panel-zoom.css 的 .muxvo-live 规则消费；
          // 字段 ==1.0 时 native 省略 → 回落 1）。仅桥路径执行，截图契约零触碰。
          document.documentElement.style.setProperty('--panel-zoom', String(state.panelZoom ?? 1));
          setFx(state as Fixture); // snapshot 完全覆盖（含 demoFixture 初始态）
        },
        // 编排监听（onOrchState/onTranscript）由 orchChannel 提供；main 无脑 spread，不识 orch 类型。
        ...orchChannel.bridgeListeners,
      });
      if (api) setBridge(api);
    });
  }, []);

  // 问题3b：聊天历史是否当前可见 + 是否曾开过（懒挂载闸）。fx 未就绪/无桥/截图路径恒 false（container 永不挂）。
  const chatOpen = !!bridge && !!fx && (fx as { panelMode?: string }).panelMode === 'chatHistory';
  if (chatOpen) chatEverOpenedRef.current = true;
  const chatEverOpened = chatEverOpenedRef.current;

  // 保活容器 inert 同步（隐藏期断 Tab 焦点 + AT 树）：DOM property 直设，绕开 React 18 对 inert 属性转发的版本差异。
  useEffect(() => {
    const el = chatKeepaliveRef.current;
    if (el) el.inert = !chatOpen;
  }, [chatOpen]);

  if (!fx) return null;

  // 问题3b 保活容器：聊天历史首次进入后常驻挂载，隐藏时仅切可见性（不卸载 → 选中/滚动/展开等浏览态全保持）。
  // 无桥/截图路径 chatEverOpened 恒 false（chatOpen 永不为真）→ chatContainer=null，静态图零介入。
  const chatContainer =
    chatEverOpened && bridge ? (
      <div
        key="chat-keepalive"
        ref={chatKeepaliveRef}
        className="chat-keepalive"
        style={chatOpen ? undefined : HIDDEN_KEEPALIVE_STYLE}
        aria-hidden={chatOpen ? undefined : true}
      >
        <Suspense fallback={null}>
          <ChatHistoryChrome fx={fx} bridge={bridge} active={chatOpen} />
        </Suspense>
      </div>
    ) : null;

  // 主视图（chatOpen 时不渲 → 与既有「聊天可见时 LiveRoot 卸载」一致，chat 容器即主视图）。
  let primary: JSX.Element | null;
  if (chatOpen) {
    primary = null;
  } else if (bridge && (fx as any).panelMode === 'taskCenter') {
    // live 面板模式切屏（§1）：native 经 ui.state.panelMode 通知；taskCenter 时渲染任务中心。
    // 编排面板整段收进 orchChannel（数据/取数/渲染全在其内）；main 只判 panelMode 委托渲染，不识 orch 类型。
    primary = orchChannel.renderPanel(fx);
  } else {
    // M2 多屏路由：terminal-grid 直连（保留 onAction 桥线缆，桥推送恒为该屏）；
    // 其余屏查注册表，未登记即 console.error + 空渲染（截图必红，防静默空图假绿）
    const screenId = fx.screen ?? 'terminal-grid';
    if (screenId === 'terminal-grid') {
      // live 模式（桥）：挂 live 壳（菜单栏 + 配置面板 overlay + ConfigProvider），经 lazy 独立 chunk。
      // 稳定 key 防每推重挂丢失本地交互态（关闭确认/重命名/面板路由）。
      primary = bridge ? (
        <Suspense fallback={null}>
          <LiveRoot key="terminal-grid-live" fx={fx} bridge={bridge} />
        </Suspense>
      ) : (
        // 截图/浏览器直开：纯屏直渲，key=fx.id 每 fixture 干净重挂（golden 逐字节不变）。
        <TerminalScreen fx={fx} key={fx.id} />
      );
    } else {
      const Screen = SCREEN_REGISTRY[screenId];
      if (!Screen) {
        console.error(`[fixture] 未注册的屏: ${screenId}（web/src/screen/registry.ts）`);
        primary = null;
      } else {
        primary = <Screen fx={fx} key={fx.id} />;
      }
    }
  }

  // 主视图 + 保活 chat 容器并列（Fragment 位置稳定：primary 在前、chatContainer 在后且 key 恒定；
  // chatOpen 翻转只切 primary 有无与容器可见性，chat 容器不卸载 → 浏览态全保持）。
  return (
    <>
      {primary}
      {chatContainer}
    </>
  );
}

document.documentElement.setAttribute('data-theme', 'dark');

const root = document.getElementById('root');
if (root) {
  if (screenshotMode) {
    // 截图模式不用 StrictMode：避免双渲染干扰 ready 时序
    createRoot(root).render(<FixtureHost />);
  } else {
    createRoot(root).render(
      <StrictMode>
        <FixtureHost />
      </StrictMode>,
    );
  }
}
