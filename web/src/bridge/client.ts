/**
 * 公开仓 overlay（编排物理剥离）：export-public.sh 时同路径覆盖私仓 web/src/bridge/client.ts。
 * =============================================================================
 * 与私仓 client.ts 的唯一差异 = 剔除编排收发（reduceOrch 投影 / OrchSnapshotState / orch.state·
 * orch.transcript 接收 / onOrchState·onTranscript 监听 / orch Gen 类型 import）。核心传输（hello 时序 /
 * 截图隔离铁律 / data.event / 版本横幅 / term·fs·config·app·chat 收发）逐位保留。
 * sendOrchCommand/sendOrchQuery 保留在 BridgeApi（松类型 unknown）——核心测试 mock 桥经 `: BridgeApi`
 * 注解带这两键（excess-property 检查），去掉会红 tsc；公开仓无人调用（orchChannel overlay stub 返空监听），
 * native 编排门控关死亦不推 orch.state → 纯 dead-transport，行为等价「编排不可用」。
 * ⚠️同步义务：私仓 client.ts 若增/改**核心**方法，须同步本 overlay；漏则导出树 tsc 红（核心屏调新方法即报
 * 「BridgeApi 无此成员」），是硬闸兜底。编排相关差异无需同步（本 overlay 刻意不含 orch 投影/接收）。
 *
 * 时序契约：先安装 window.__muxvoBridge.receive，再发 bridge.hello（native 收到 hello 即可安全 flush）。
 * 禁加 import.meta.hot.accept：本模块无 accept 边界 → 编辑触发 Vite 整页 reload → native didCommit 重置
 * 握手门 → 新页面重发 hello，恢复路径已闭环。
 */

import { PROTOCOL_VERSION } from './gen/protocol';
import type {
  AppRequest,
  AppResponse,
  ChatRequest,
  ChatResponse,
  ConfigRequest,
  ConfigResponse,
  DataEvent,
  FsRequest,
  FsResponse,
  TelemetryEvent,
  TermCommandRequest,
  TermCommandResponse,
  UIAction,
  UIState,
  UIStatePush,
} from './gen/protocol';

export interface BridgeApi {
  /** ui.action（event）：fire-and-forget，native 立即回 ok:null（§2）。union 含 M3 全部分支。 */
  sendAction(action: UIAction): void;
  /** app.telemetry（event，v35；analytics.md §4）：埋点事件 fire-and-forget，native 立即回 ok:null。 */
  sendTelemetry(event: TelemetryEvent): void;
  /**
   * term.command（request #4）：resolve 为 TermCommandResponse（含业务失败的 rejected 分支，仍是 ok:true，草案 §2）；
   * 协议层错误（UNAVAILABLE/BAD_REQUEST…，{ok:false}）→ reject。
   */
  sendTermCommand(req: TermCommandRequest): Promise<TermCommandResponse>;
  /**
   * fs.request（request #6，M6 批A 激活）：resolve 为 FsResponse（含业务失败的 rejected 分支，仍 ok:true）；
   * 协议层错误（{ok:false}）→ reject。照 sendTermCommand 逐字。
   */
  sendFsRequest(req: FsRequest): Promise<FsResponse>;
  /**
   * orch.command（编排收发，公开仓 dead-transport）：松类型保留供核心测试 mock 桥满足 BridgeApi。
   * 公开仓 orchChannel 为 stub（不调本方法），native 编排门控关死亦不启编排链。
   */
  sendOrchCommand(req: unknown): Promise<unknown>;
  /** orch.query（编排收发，公开仓 dead-transport）：同 sendOrchCommand。 */
  sendOrchQuery(req: unknown): Promise<unknown>;
  /**
   * config.request（request #M6）：配置读写（get/set/listResources/mcpServers/plugins…）。
   * 业务 rejected 分支仍 resolve（ok:true，ConfigResponse.rejected）；协议错误 {ok:false} → reject。
   */
  sendConfigRequest(req: ConfigRequest): Promise<ConfigResponse>;
  /** app.request（request #M6）：宿主能力（selectDirectory…）；同上 resolve/reject 语义。 */
  sendAppRequest(req: AppRequest): Promise<AppResponse>;
  /**
   * chat.request（request #M5）：聊天历史五 kind 只读查询（projects/sessions/session/search/export）。
   * 业务 rejected 分支仍 resolve（ok:true，ChatResponse.rejected）；协议错误 {ok:false} → reject。
   * 推送（chatSessionUpdate/chatSyncStatus）走既有 subscribeDataEvent（DataEvent union 分支，按 kind 过滤）。
   */
  sendChatRequest(req: ChatRequest): Promise<ChatResponse>;
  /**
   * data.event（nativeToWeb push）订阅：返回退订函数（configResourcesChanged 多消费者）。
   * 挂 BridgeApi（非模块级自由导出）令 ConfigContext 仅 import type → 截图静态图不含 client.ts（M6B1-WEB-1）。
   * 截图/浏览器直开无 receive → 订阅永不触发，安全无副作用（golden 零感知）。
   */
  subscribeDataEvent(handler: (event: DataEvent) => void): () => void;
  /**
   * 当前 app 版本（HelloResponse.appVersion，auto-update.md §0）：hello 回包后可得；
   * 之前/失败 → null（消费方自兜底占位）。设置面板「当前版本 v{x}」与 What's New 门用。
   */
  getAppVersion(): string | null;
}

interface BridgePort {
  postMessage(envelope: unknown): Promise<BridgeReply>;
}

interface BridgeReply {
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

// 模块级幂等：装 receive / 发 hello 只一次（StrictMode 双 effect 安全）。
// undefined = 未初始化；null = 非 WKWebView 宿主（浏览器直开，demoFixture 照旧）。
let api: BridgeApi | null | undefined;
// onState 每次 initBridge 刷新：保证 receive 回调永远指向存活的 setFx，防僵尸闭包。
let currentOnState: ((state: UIState) => void) | null = null;

// data.event 分发（订阅集：configResourcesChanged 有多个独立消费者——ConfigProvider 重取快照 +
// 各配置面板刷新自身列表——故订阅注册表比单 var 更贴合）。模块级与 receive 幂等同源；
// receive 只在 WKWebView 宿主装配，故仅 live 模式派发。
const dataEventHandlers = new Set<(event: DataEvent) => void>();
// hello 回包留存的 app 版本（auto-update.md §0）；未回/失败 = null。
let helloAppVersion: string | null = null;

export interface InitBridgeOptions {
  onState(state: UIState): void;
}

export function initBridge(options: InitBridgeOptions): BridgeApi | null {
  currentOnState = options.onState;
  if (api !== undefined) return api;

  const port = (window as any).webkit?.messageHandlers?.muxvo as BridgePort | undefined;
  if (!port) {
    api = null;
    return api;
  }

  // 真 WKWebView 宿主标记（dogfood②修复 F1/F4）：终端透明洞的祖先链据此透明化（live-transparent.css），
  // 让下层原生 Metal surface 透出；文件按钮据此显禁用观感。?screenshot=1（本模块零执行）与浏览器直开
  //（无 webkit port，上面已 return）都到不了这里 → 不加 class → golden 截图逐字节零影响。
  document.documentElement.classList.add('muxvo-live');

  // ① 先装 receive（§3 时序契约）
  (window as any).__muxvoBridge = {
    receive(message: unknown): void {
      const m = message as
        | { v?: number; type?: string; payload?: UIStatePush | DataEvent }
        | null;
      if (!m?.type) return;
      if (m.type === 'ui.state') {
        const p = m.payload as UIStatePush | undefined;
        if (p?.kind === 'snapshot') currentOnState?.(p.state);
        return;
      }
      if (m.type === 'data.event') {
        const e = m.payload as DataEvent | undefined;
        if (e) dataEventHandlers.forEach((h) => h(e));
        return;
      }
    },
  };

  // ② 再发 hello。回包错误走结构化 {ok:false}，不 reject（§2）
  port
    .postMessage({
      v: 1,
      type: 'bridge.hello',
      payload: { protocolVersion: PROTOCOL_VERSION, webBuild: 'dev' },
    })
    .then((reply) => {
      if (!reply?.ok && reply?.error?.code === 'VERSION_MISMATCH') {
        showVersionBanner(reply.error.message);
      }
      // 留存 appVersion（auto-update.md §0）：设置面板「当前版本 v{x}」/What's New 门消费。
      if (reply?.ok) {
        const version = (reply.payload as { appVersion?: unknown } | undefined)?.appVersion;
        if (typeof version === 'string') helloAppVersion = version;
      }
    })
    .catch(() => {
      /* 传输层异常：保持静默，native 侧自有日志 */
    });

  api = {
    sendAction(action: UIAction): void {
      // event 模式 fire-and-forget：native 立即回 ok:null，web 不 await（§2）
      void port
        .postMessage({ v: 1, type: 'ui.action', payload: action })
        .catch(() => {});
    },
    sendTelemetry(event: TelemetryEvent): void {
      // event 模式 fire-and-forget（仿 sendAction）：埋点失败静默，绝不影响 UI
      void port
        .postMessage({ v: 1, type: 'app.telemetry', payload: event })
        .catch(() => {});
    },
    sendTermCommand(req: TermCommandRequest): Promise<TermCommandResponse> {
      // request 模式：WebKit replyHandler 天然关联请求-响应（§3，协议无 id 字段）
      return port
        .postMessage({ v: 1, type: 'term.command', payload: req })
        .then((reply) => {
          if (reply?.ok) return reply.payload as TermCommandResponse;
          throw new Error(reply?.error?.message ?? 'term.command 失败');
        });
    },
    sendFsRequest(req: FsRequest): Promise<FsResponse> {
      // request 模式：WebKit replyHandler 天然关联请求-响应（协议无 id 字段）
      return port
        .postMessage({ v: 1, type: 'fs.request', payload: req })
        .then((reply) => {
          if (reply?.ok) return reply.payload as FsResponse;
          throw new Error(reply?.error?.message ?? 'fs.request 失败');
        });
    },
    sendOrchCommand(req: unknown): Promise<unknown> {
      // 公开仓 dead-transport：orchChannel stub 不调用，native 编排门控关死；保留供核心测试 mock 满足 BridgeApi。
      return port
        .postMessage({ v: 1, type: 'orch.command', payload: req })
        .then((reply) => {
          if (reply?.ok) return reply.payload;
          throw new Error(reply?.error?.message ?? 'orch.command 失败');
        });
    },
    sendOrchQuery(req: unknown): Promise<unknown> {
      return port
        .postMessage({ v: 1, type: 'orch.query', payload: req })
        .then((reply) => {
          if (reply?.ok) return reply.payload;
          throw new Error(reply?.error?.message ?? 'orch.query 失败');
        });
    },
    sendConfigRequest(req: ConfigRequest): Promise<ConfigResponse> {
      return port
        .postMessage({ v: 1, type: 'config.request', payload: req })
        .then((reply) => {
          if (reply?.ok) return reply.payload as ConfigResponse;
          throw new Error(reply?.error?.message ?? 'config.request 失败');
        });
    },
    sendAppRequest(req: AppRequest): Promise<AppResponse> {
      return port
        .postMessage({ v: 1, type: 'app.request', payload: req })
        .then((reply) => {
          if (reply?.ok) return reply.payload as AppResponse;
          throw new Error(reply?.error?.message ?? 'app.request 失败');
        });
    },
    sendChatRequest(req: ChatRequest): Promise<ChatResponse> {
      return port
        .postMessage({ v: 1, type: 'chat.request', payload: req })
        .then((reply) => {
          if (reply?.ok) return reply.payload as ChatResponse;
          throw new Error(reply?.error?.message ?? 'chat.request 失败');
        });
    },
    // data.event 订阅：加入模块级派发集（receive 收 data.event 时 forEach 派发）；返回退订。
    // 挂 api 而非模块级自由导出 → ConfigContext 只 import type BridgeApi，client.ts 不入截图静态图（M6B1-WEB-1）。
    subscribeDataEvent(handler: (event: DataEvent) => void): () => void {
      dataEventHandlers.add(handler);
      return () => {
        dataEventHandlers.delete(handler);
      };
    },
    getAppVersion(): string | null {
      return helloAppVersion;
    },
  };
  return api;
}

/**
 * 已初始化的桥单例（live 模式 initBridge 后非空；截图/浏览器直开恒 null）。
 * 供深层 live 组件经**动态 import** 取 request 语义原语——动态 import 不构成截图静态图的静态边，
 * 且仅 live 分支执行，故截图隔离铁律不破（bridge-isolation 场景 A 不受影响）。
 */
export function currentBridge(): BridgeApi | null {
  return api ?? null;
}

/** 只在 VERSION_MISMATCH 才碰 DOM——视觉回归零感知（正常路径不注入任何元素） */
function showVersionBanner(message: string): void {
  if (document.getElementById('muxvo-version-banner')) return;
  const el = document.createElement('div');
  el.id = 'muxvo-version-banner';
  el.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;' +
    'padding:6px 12px;font:12px/1.4 monospace;text-align:center';
  el.textContent = `桥协议版本不匹配：${message}`;
  document.body.appendChild(el);
}
