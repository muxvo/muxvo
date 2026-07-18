// UIStateProjection：Registry 状态 → 中性快照（ProjectionSnapshot）的可测投影核心。
//
// 定位（批4③）：ui.state 唯一状态源的**可测半**。TerminalService（MuxvoApp 薄胶水）只做
// 「中性 DTO ↔ MuxvoBridge 类型」映射 + 装配；90% 逻辑（观察/持有 UI 态/去抖/命令路由）在此
// library target 单测。本文件**不 import MuxvoBridge**（依赖方向：MuxvoTerm 只依赖 Kit/Core/C），
// 故对外一律用中性 DTO（ProjectionSnapshot/ProjectionTerminal/TermCommandOutcome），由 MuxvoApp
// 侧映射到 UIState/TermCommandResponse。
//
// 行为规格：terminal-session.md §6.3（50ms 去抖，复用 StateDebouncer）+ §2.2（事件产生点）+
// §6.1（上限 20 拒绝文案，透传 RegistryPolicy）；桥草案 docs/m3/m3-bridge-v2-draft.md §2（term.command
// req/resp 语义/rejected 分支）+ §3（ui.action 分支）+ §3 note（editing 恒 null）+ §5（searchBar）。
//
// 并发：非 Sendable，须在**单一串行上下文**上访问（生产由 @MainActor TerminalService 驱动，
// registry 观察者 hop 到 main；测试在测试线程直驱）。时钟外部注入（nowMs 闭包），与 StateDebouncer
// 同范式——假时钟可确定性验「50ms 内抖动只出最终一条」（TERM_L1_06）。
import Foundation
import MuxvoKit
import MuxvoTermCore
import os

// MARK: - 中性 DTO（bridge-free；MuxvoApp 侧映射到 MuxvoBridge 类型）

/// 快照里的单个终端（state 用 MuxvoTermCore.TerminalState，rawValue 与桥 TerminalState 逐字对齐）。
public struct ProjectionTerminal: Equatable, Sendable {
    public let id: String
    public let state: TerminalState
    public let cwd: String
    public let customName: String?
    /// 终端是否在 alt-screen（备用屏缓冲，message-editor.md §1）。true → web 渲 RawTerminal 形态（编辑器淡出）。
    public let altScreen: Bool
    /// 终端是否已收起（term-grid.md §11）：true → web 不渲 tile/洞，改入左侧收纳边栏；PTY 照跑。
    public let minimized: Bool
    /// 收起终端的末行输出摘要（term-grid.md §11 mini 卡第三要素）：仅 minimized 时携带（payload 冻结），
    /// 由 TerminalService 心跳 1Hz 采样 currentFrame 落入（≤120 字符）。
    public let lastLine: String?

    public init(
        id: String, state: TerminalState, cwd: String, customName: String?, altScreen: Bool = false,
        minimized: Bool = false, lastLine: String? = nil
    ) {
        self.id = id
        self.state = state
        self.cwd = cwd
        self.customName = customName
        self.altScreen = altScreen
        self.minimized = minimized
        self.lastLine = lastLine
    }
}

/// 视图模式（rawValue 与桥 ViewMode 逐字对齐："Tiling"/"Focused"/"List"）。
/// List（批B，term-list-mode.md）= 左终端列表 + 右选中终端真详情；与 Tiling 经 ⌘⇧L 二态切换。
public enum ProjectionViewMode: String, Sendable, Equatable {
    case tiling = "Tiling"
    case focused = "Focused"
    case list = "List"
}

/// 可持久化终端项（尾批：config.openTerminals 写回 / 恢复用；legacy 实况 {cwd, customName?}）。
/// 会话恢复语义 = 重 spawn 新 shell 非会话续命（terminal-session.md）——只带 cwd/customName。
/// M4b【T-3】增稳定 `id`（写回=运行时 SessionID；恢复读入=旧 config 持久化 id，可 nil）作 §2/§3 会话锚点 join 键。
public struct PersistableTerminal: Equatable, Sendable {
    public let id: String?
    public let cwd: String
    public let customName: String?
    /// 收起态跨重启（term-grid.md §11）：写回=当前收起集成员；恢复读入=旧 config 缺席按 false。
    public let minimized: Bool
    public init(id: String? = nil, cwd: String, customName: String?, minimized: Bool = false) {
        self.id = id
        self.cwd = cwd
        self.customName = customName
        self.minimized = minimized
    }
}

/// ui.state 中性快照。editing/searchBar 仍是 web 本地/薄胶水态，不入 DTO；`waitingCount`（批5①
/// WaitDetector 接真）= 强信号等待终端数（静默弱信号不计，wait-detector.md §3/§6），MuxvoApp
/// 映射为 `waitingNotification`（>0 时出浮卡）。per-终端红点/badge/呼吸边框走各 `terminals[].state`
/// 的 waitingInput 叠加（含静默弱信号）。
public struct ProjectionSnapshot: Equatable, Sendable {
    public let terminals: [ProjectionTerminal]
    public let selectedId: String?
    public let focusedId: String?
    public let activeSidebarId: String?
    public let viewMode: ProjectionViewMode
    public let maxReached: Bool
    /// 强信号等待终端数（layer0/进程；静默不计）。0 = 无浮卡（wait-detector.md §3 `waitingNotification.count`）。
    public let waitingCount: Int
    /// 可见等待终端数（waitingInput 全计**含静默弱信号**，与 per-终端黄灯/红点同口径）。Dock 徽标
    /// 数据源（settings-dogfood 批，wait-detector.md §8 Dock badge 行：legacy dock-badge.ts 口径，区别于浮卡强口径）。
    /// **仅内部快照字段**——不映射进 ui.state 线上 DTO（mapSnapshot 不暴露，协议零动）。
    public let visibleWaitingCount: Int

    public init(
        terminals: [ProjectionTerminal], selectedId: String?, focusedId: String?,
        activeSidebarId: String?, viewMode: ProjectionViewMode, maxReached: Bool,
        waitingCount: Int = 0, visibleWaitingCount: Int = 0
    ) {
        self.terminals = terminals
        self.selectedId = selectedId
        self.focusedId = focusedId
        self.activeSidebarId = activeSidebarId
        self.viewMode = viewMode
        self.maxReached = maxReached
        self.waitingCount = waitingCount
        self.visibleWaitingCount = visibleWaitingCount
    }
}

/// term.command 中性结果（MuxvoApp 映射到 TermCommandResponse 的 created/closed/zoomed/rejected）。
public enum TermCommandOutcome: Equatable, Sendable {
    case created(terminalId: String, pid: Int32)
    case closed(terminalId: String)
    case zoomed(fontSize: Int)
    case rejected(reason: RejectReason, message: String)
}

/// 业务拒绝原因（rawValue 与桥 RejectCode 逐字对齐）。
public enum RejectReason: String, Sendable, Equatable {
    case maxReached
    case invalidCwd
    case notFound
    case internalError = "internal"
}

// MARK: - 投影核心

public final class UIStateProjection {
    /// zoom 字号边界与步长（桥草案 §2「zoom M3 定义即实现」；渲染侧消费已接 DOGFOOD_M3_05）。无 spec oracle，取常识值。
    public static let minFontSize = 8
    public static let maxFontSize = 32
    public static let fontStep = 1

    /// emit 间接盒：StateDebouncer.emit 在 init 时定死且不可引用未初始化的 self，故经此引用型盒
    /// 转发——盒在 init 前就位、被 emit 闭包按引用捕获，self 全部存储属性就绪后再挂真 fire。
    private final class EmitBox { var fire: () -> Void = {} }

    /// 生命周期打点（DOGFOOD_M3_09 可诊断性）：用户关闭自动移除拦截命中记一行。
    private static let lifecycleLog = Logger(subsystem: "com.muxvo", category: "lifecycle")

    private let registry: SessionRegistry
    private let homePath: String
    private let nowMs: () -> UInt64
    /// 创建会话的配置模板（生产 = 登录 shell 默认；测试注入 /bin/cat 等以得确定性 pid>0）。
    private let configTemplate: () -> TerminalSession.Config
    /// 无显式 cwd 新终端的默认落点（M6 批1，settings-modal.md 终端默认路径）：生产注入读 ConfigModel
    /// 的 defaultTerminalCwd（'' 或目录失效由 TerminalService 兜底 homePath）；nil = 回退 homePath（测试零改动）。
    private let defaultCwd: (() -> String)?
    private let emitBox = EmitBox()
    private let debouncer: StateDebouncer

    // UI 态（全部单串行上下文访问）。维序 = order；cwd/customName/state 按 SessionID 索引。
    private var order: [SessionID] = []
    private var cwds: [SessionID: String] = [:]
    private var customNames: [SessionID: String] = [:]
    private var states: [SessionID: TerminalState] = [:]
    private var selectedId: SessionID?
    private var focusedId: SessionID?
    private var activeSidebarId: SessionID?
    private var viewMode: ProjectionViewMode = .tiling
    /// WaitDetector 叠加态（批5①）：termId → 等待来源（缺席 = 不等待）。由 noteWaiting 落，
    /// buildSnapshot 叠到 terminals[].state（仅底层 running 时叠 waitingInput）+ 聚合强信号 count。
    private var waitSources: [SessionID: WaitSource] = [:]
    /// alt-screen 叠加态（message-editor.md §1）：termId → 是否在备用屏（缺席 = primary=false）。由 noteAltScreen
    /// 边沿落，buildSnapshot 读入 terminals[].altScreen。会话层已边沿去重，此处再守一次幂等。
    private var altScreens: [SessionID: Bool] = [:]
    /// 收起集（term-grid.md §11）：成员不渲 tile/洞（PTY 照跑），入左侧收纳边栏。order 保序不动——
    /// 恢复回原槽位；reorder 对收起槽位锁定（见 reorder）。
    private var minimized: Set<SessionID> = []
    /// 收起终端末行输出摘要（§11 mini 卡）：仅收起集成员有值；noteLastLine 落，恢复/移除时清。
    private var lastLines: [SessionID: String] = [:]
    /// 用户主动关闭的活会话 id（DOGFOOD_M3_09）：closeTerminal 非 removable 分支置入；退到终态时
    /// noteStateChange 拦截自动移除（一步到位，回归 legacy「进程退出 tile 即消失」）。作用域收窄到
    /// term.command close 用户路径——closeAll（关停）不经 closeTerminal，天然免疫（terminal-session.md §3.2 步骤5）。
    private var pendingUserClose: Set<SessionID> = []
    private let initialFontSize: Int
    private var _fontSize: Int

    /// 去抖后「该推快照」回调。生产 = TerminalService 映射 UIState → bus.pushUIState；测试收集断言。
    public var onSnapshot: ((ProjectionSnapshot) -> Void)?

    /// 终端结构/命名变化回调（尾批：user create 成功 / remove / reorder / renameSubmit 后触发）。
    /// 生产 = TerminalService 写回 config.openTerminals（维序）。restoreTerminals 期间抑制（加载非用户动作）。
    public var onTerminalsPersist: (() -> Void)?
    /// 终端从投影剔除（用户显式关闭 / 自退移除）回调（M4b §1 清条目）：生产 = TerminalService
    /// → SessionTracker.terminalRemoved 清该 termId 会话锚点（防陈旧锚点残留）。
    public var onTerminalRemoved: ((SessionID) -> Void)?
    /// restoreTerminals 期间置真 → 抑制 onTerminalsPersist（防加载时逐 entry 回写正在读的 config）。
    private var suppressPersist = false

    /// 一次 restoreTerminals 的 join 记录（M4b §3）：新 spawn termId ↔ 其来源持久化项（含稳定 id + cwd）。
    /// 生产 = TerminalService 据此把 openTerminals 与会话锚点 join、过闸、注入 resume。fallback 建的终端不入此表。
    public struct RestoreJoin: Sendable { public let newId: String; public let source: PersistableTerminal }
    public private(set) var lastRestoreJoin: [RestoreJoin] = []

    public init(
        registry: SessionRegistry,
        homePath: String,
        initialFontSize: Int = 14,
        nowMs: @escaping () -> UInt64 = { UInt64(DispatchTime.now().uptimeNanoseconds / 1_000_000) },
        configTemplate: @escaping () -> TerminalSession.Config = { TerminalSession.Config() },
        defaultCwd: (() -> String)? = nil
    ) {
        self.registry = registry
        self.homePath = homePath
        self.nowMs = nowMs
        self.configTemplate = configTemplate
        self.defaultCwd = defaultCwd
        self.initialFontSize = initialFontSize
        self._fontSize = initialFontSize
        // 单一去抖器驱动「整快照该推与否」：immediate 态（终态/Stopping）立即 emit，其余 50ms 去抖。
        // emit 忽略入参 state（仅作触发），一律读当前聚合态重建快照（terminal-session.md §6.3）。
        self.debouncer = StateDebouncer(emit: { [emitBox] _ in emitBox.fire() })
        // 存储属性已全部就位 → 可安全引用 self（弱引用防环）。
        emitBox.fire = { [weak self] in self?.emitSnapshot() }
    }

    public var fontSize: Int { _fontSize }

    // MARK: term.command 路由（→ 中性 outcome）

    /// create{cwd?}：cwd 缺省 = homePath；显式 cwd 校验目录有效（否则 rejected.invalidCwd）；
    /// **满员两级**（multi-window.md §3，先窗后全局）：本窗 order 满 20 → rejected.maxReached（冻结文案
    /// `maxReachedMessage`，TERM_L2_83 oracle）；本窗未满但全局池满 40 → registry 层拒（`globalMaxReachedMessage`）。
    /// 成功入维序 + 选中 + 立即推快照。
    public func createTerminal(cwd: String?) -> TermCommandOutcome {
        // 每窗 20 先拦（projection 层，§3.1）：本窗可见+收起终端数已满 → 冻结文案（保单窗第 21 个仍出冻结文案）。
        guard RegistryPolicy.canCreatePerWindow(currentCount: order.count) else {
            return .rejected(reason: .maxReached, message: RegistryPolicy.maxReachedMessage)
        }
        let resolved: String
        if let cwd, !cwd.isEmpty {
            let expanded = (cwd as NSString).expandingTildeInPath
            guard Self.isValidDirectory(expanded) else {
                return .rejected(reason: .invalidCwd, message: "目录不存在或不可用：\(cwd)")
            }
            resolved = expanded
        } else {
            // 无显式 cwd：走注入的默认落点（M6 批1，已由 TerminalService 校验兜底）；nil → homePath。
            resolved = defaultCwd?() ?? homePath
        }
        var config = configTemplate()
        config.cwd = resolved
        switch registry.create(config: config) {
        case let .failure(.maxReached(message)):
            return .rejected(reason: .maxReached, message: message)
        case let .failure(.spawnFailed(detail)):
            return .rejected(reason: .internalError, message: detail)
        case let .success(id):
            order.append(id)
            cwds[id] = resolved
            states[id] = registry.state(of: id) ?? .running
            selectedId = id
            let pid = registry.session(for: id)?.pid ?? 0
            emitSnapshot() // 结构变化立即推（新建终端即时可见）
            notifyPersist() // 维序写回 config.openTerminals（restore 期抑制）
            return .created(terminalId: id.raw, pid: pid)
        }
    }

    /// 自定义 config 建终端（M4b' 指挥台，T6）：PTY 根 = 调用方指定的 executablePath（claude）而非 login
    /// shell。复用 configTemplate 的 theme 继承 + 全套簿记（order/cwds/states/selected/emitSnapshot/persist），
    /// 令指挥台终端**与普通终端同现于 grid**、字号/主题一致。`customize` 叠加 executablePath/argv/cwd/onExit。
    /// 返回 .created(terminalId, pid)——pid = PTY 根进程（claude）。
    public func createTerminal(customize: (inout TerminalSession.Config) -> Void) -> TermCommandOutcome {
        // 每窗 20 先拦（§3.1；指挥台/自定义终端同占本窗名额——入 order 有可见 tile）。
        guard RegistryPolicy.canCreatePerWindow(currentCount: order.count) else {
            return .rejected(reason: .maxReached, message: RegistryPolicy.maxReachedMessage)
        }
        var config = configTemplate()
        customize(&config)
        let resolved = config.cwd ?? defaultCwd?() ?? homePath
        config.cwd = resolved
        switch registry.create(config: config) {
        case let .failure(.maxReached(message)):
            return .rejected(reason: .maxReached, message: message)
        case let .failure(.spawnFailed(detail)):
            return .rejected(reason: .internalError, message: detail)
        case let .success(id):
            order.append(id)
            cwds[id] = resolved
            states[id] = registry.state(of: id) ?? .running
            selectedId = id
            let pid = registry.session(for: id)?.pid ?? 0
            emitSnapshot() // 结构变化立即推（新建终端即时可见）
            notifyPersist() // 维序写回 config.openTerminals（restore 期抑制）
            return .created(terminalId: id.raw, pid: pid)
        }
    }

    /// close{terminalId}：未知 id → rejected.notFound。
    /// - 活会话（含 Stopping）→ registry 优雅关闭（CLOSE→Stopping 立即）；终态由观察者经 noteStateChange 落快照。
    /// - 已终态（Stopped/Disconnected/Failed）tile 的关闭 = **移除**（尾批 item 4，照 legacy dead-tile
    ///   dismiss）：REMOVE→registry 剔 entry + 本投影剔维序/各态 → 快照剔除 → surface 随 layoutReport 缺席自动 detach。
    public func closeTerminal(terminalId: String) -> TermCommandOutcome {
        let id = SessionID(raw: terminalId)
        guard order.contains(id) else {
            return .rejected(reason: .notFound, message: "终端不存在：\(terminalId)")
        }
        let current = states[id] ?? registry.state(of: id) ?? .running
        if current.isRemovable {
            registry.remove(id)
            dropTerminal(id)
            emitSnapshot()   // 结构变化立即推（tile 消失）
            notifyPersist()  // 维序写回 config.openTerminals（尾批 item 1）
            return .closed(terminalId: terminalId)
        }
        // 活会话（含 Stopping）用户主动关闭：登记 pendingUserClose，退到终态时自动移除（一步到位，
        // DOGFOOD_M3_09，§3.2 步骤5）。Set 幂等：Stopping 期二次 close 不重复副作用（T4）。
        pendingUserClose.insert(id)
        registry.close(id)
        return .closed(terminalId: terminalId)
    }

    /// 从投影剔除某终端（维序 + cwd/customName/state/waitSource + 选中/焦点/侧栏引用）。
    /// 焦点被剔 → 回平铺（legacy REMOVE_TERMINAL reducer：viewMode Focused→Tiling）。
    /// order 中 id 之后首个非收起 id（List 态选中顺延共用：close 剔除与收起，term-list-mode.md；
    /// 批B 对抗 MINOR-2 抽共用）。无候选 = nil（详情空态）。
    private func visibleSuccessor(after id: SessionID) -> SessionID? {
        guard let idx = order.firstIndex(of: id) else { return nil }
        return order[(idx + 1)...].first { !minimized.contains($0) }
    }

    private func dropTerminal(_ id: SessionID) {
        // List 态选中项被移除 → 选中顺延 order 中该项之后首个非收起 id（无则 nil）；须在 order 剔除**前**
        // 算出后继（term-list-mode.md「关闭选中顺延」）。非 List 态 listSuccessor 恒 nil → 沿现状清空选中。
        let listSuccessor: SessionID? =
            (viewMode == .list && selectedId == id) ? visibleSuccessor(after: id) : nil
        order.removeAll { $0 == id }
        cwds.removeValue(forKey: id)
        customNames.removeValue(forKey: id)
        states.removeValue(forKey: id)
        waitSources.removeValue(forKey: id)
        altScreens.removeValue(forKey: id)
        minimized.remove(id)
        lastLines.removeValue(forKey: id)
        if selectedId == id { selectedId = listSuccessor }
        if focusedId == id { focusedId = nil; viewMode = .tiling }
        if activeSidebarId == id { activeSidebarId = nil }
        pendingUserClose.remove(id) // 移除后清登记（DOGFOOD_M3_09；自退 REMOVE 路径 no-op）
        onTerminalRemoved?(id) // M4b §1：清该 termId 会话锚点（用户关终端 / 自退移除）
    }

    /// zoom：全局字号 ±/reset（桥草案 §2）。字号不入 ui.state 快照 → 不推；渲染消费由 TerminalService.applyZoom
    /// 经 onFontSizeChanged 广播到 surface（DOGFOOD_M3_05），持久化到 config.terminal.fontSize（legacy zoom 持久化对应）。
    public func zoom(_ action: ZoomDirection) -> TermCommandOutcome {
        switch action {
        case .in: _fontSize = min(Self.maxFontSize, _fontSize + Self.fontStep)
        case .out: _fontSize = max(Self.minFontSize, _fontSize - Self.fontStep)
        case .reset: _fontSize = initialFontSize
        }
        return .zoomed(fontSize: _fontSize)
    }

    public enum ZoomDirection: Sendable, Equatable { case `in`, out, reset }

    // MARK: registry 状态观察接线（生产由 registry.addObserver 驱动，测试直驱）

    /// registry 去抖后的状态变化落投影：更新该会话态 + 经去抖决定推送时机
    /// （immediate 态立即推、其余 50ms 去抖，TERM_L1_06/07）。未知 id（已移除）忽略。
    public func noteStateChange(_ id: SessionID, _ state: TerminalState) {
        guard order.contains(id) else { return }
        // 用户主动关闭 → 终态自动移除（一步到位；观察态与移除**合并单帧**，不闪死 tile，§3.2 步骤5/§6.3）。
        // 自发退出（未经 close 命令）不在 pendingUserClose → 不命中 → 照常保留死 tile（TERM_L1_07 口径不变）。
        if pendingUserClose.contains(id), state.isRemovable {
            Self.lifecycleLog.info(
                "user-close 自动移除 id=\(id.raw, privacy: .public) state=\(state.rawValue, privacy: .public)")
            registry.remove(id)   // registry 剔 entry（幂等；已剔返回 false 亦安全）
            dropTerminal(id)      // 剔维序/各态/选中焦点侧栏 + 末尾清 pendingUserClose
            emitSnapshot()        // 更新态 + 移除合并单帧（不先推死 tile 再推移除）
            notifyPersist()       // 维序写回 config.openTerminals（剔除已关终端）
            return
        }
        states[id] = state
        debouncer.record(state, nowMs: nowMs())
    }

    /// cwd 追踪落投影（OSC 7/轮询更新，terminal-session.md §5）。cwd 期望已归一（普通路径）。
    public func noteCwdChange(_ id: SessionID, _ cwd: String) {
        guard order.contains(id), !cwd.isEmpty, cwds[id] != cwd else { return }
        cwds[id] = cwd
        emitSnapshot()
    }

    /// cwd 轮询接线（terminal-session.md §5 主路径）：读各会话 vt 侧 OSC7 追踪的 cwd（原始
    /// `file://host/path`），归一为普通路径，变化则批量更新 + 单次推快照。生产由 TerminalService
    /// 心跳按 §5 的 1s 量级节流调用（读的是缓存 cwd，非 lsof/pgrep 昂贵探测——前台进程兜底轮询
    /// 属会话层 §5 路径②，本服务批不涉）。
    public func refreshCwds() {
        var changed = false
        for id in order {
            guard let raw = registry.session(for: id)?.cwd,
                  let path = Self.normalizeCwd(raw), cwds[id] != path else { continue }
            cwds[id] = path
            changed = true
        }
        if changed { emitSnapshot() }
    }

    /// 去抖时钟推进：暂存态静默满 50ms 则推最终一条。生产由 TerminalService 心跳驱动，测试用假时钟直调。
    public func flush() {
        debouncer.flush(nowMs: nowMs())
    }

    // MARK: ui.action 路由（UI 态变化一律立即推——非抖动，用户驱动）

    /// tileClick：平铺态选中该 tile。wait-detector §3「tileClick 隐含 acknowledge」批5 接 detector，本批留接缝。
    public func selectTile(_ terminalId: String) {
        let id = SessionID(raw: terminalId)
        guard order.contains(id) else { return }
        selectedId = id
        emitSnapshot()
    }

    /// sidebarSelect：Focused 模式激活某 sidebar 预览（term-grid.md §2）。
    public func selectSidebar(_ terminalId: String) {
        let id = SessionID(raw: terminalId)
        guard order.contains(id) else { return }
        activeSidebarId = id
        emitSnapshot()
    }

    /// maximizeTile：进 Focused，focusedId=该 tile。
    /// 防御（term-grid.md §11 TG_MIN_maximize_unminimizes）：目标已收起 → 先恢复再聚焦（native 端唯一入口收口）。
    public func maximizeTile(_ terminalId: String) {
        let id = SessionID(raw: terminalId)
        guard order.contains(id) else { return }
        if minimized.contains(id) {
            minimized.remove(id)
            lastLines.removeValue(forKey: id)
            notifyPersist() // 收起集变化写回（§11 持久化）
        }
        viewMode = .focused
        focusedId = id
        activeSidebarId = id
        emitSnapshot()
    }

    /// restoreTiling：回平铺（清 focused/activeSidebar）。List 亦经此恒回 .tiling（不记忆来路——
    /// term-list-mode.md 冻结此简单语义：List 详情最大化进 Focused 后「回到平铺」直落 Tiling）。
    public func restoreTiling() {
        viewMode = .tiling
        focusedId = nil
        activeSidebarId = nil
        emitSnapshot()
    }

    /// toggleListMode（term-list-mode.md，菜单「显示 → 列表模式」⌘⇧L）：List↔Tiling 二态切换。
    /// - 进 List：清 focusedId/activeSidebarId（List 无 Focused 语义）；selectedId 走缺省链
    ///   `selectedId ?? focusedId ?? 首个非收起 id`（缺省选中链，保证详情有终端可渲，除非全空/全收起）。
    /// - 已在 List → 回 .tiling（selectedId 保持——切回平铺后仍高亮该 tile）。
    /// - 其他态（Focused）进 List 同「进 List」分支（focusedId 入缺省链后即清）。
    public func toggleListMode() {
        if viewMode == .list {
            viewMode = .tiling
        } else {
            let seed = selectedId ?? focusedId ?? order.first { !minimized.contains($0) }
            viewMode = .list
            focusedId = nil
            activeSidebarId = nil
            selectedId = seed
        }
        emitSnapshot()
    }

    /// minimizeTile：收起该 tile 入左侧收纳边栏（term-grid.md §11）。order 保序不动（恢复回原槽）；
    /// PTY 照跑（web 撤洞 → surface detach 既有语义）。收起 focused 主格 = 先回平铺再收起（与
    /// dropTerminal 对焦点处理同型，TG_MIN_minimize_focused_exits_focus）；收起选中项：Tiling/Focused
    /// 清 selectedId；List 态顺延 order 下一个非收起 id（与 close 对称，防详情空悬——批B 对抗 MINOR-2）。
    /// 已收起/未知 id 幂等 no-op（不重复 emit/persist）。
    public func minimizeTile(_ terminalId: String) {
        let id = SessionID(raw: terminalId)
        guard order.contains(id), !minimized.contains(id) else { return }
        if focusedId == id {
            viewMode = .tiling
            focusedId = nil
            activeSidebarId = nil
        } else if activeSidebarId == id {
            // Focused 中收起 sidebar 预览终端：预览高亮回落主格（防悬空指向收起项）。
            activeSidebarId = focusedId
        }
        minimized.insert(id)
        if selectedId == id {
            // List 态：详情不空悬，顺延维序下一个非收起项（无候选=nil 空态）。Tiling/Focused 保持清空语义。
            selectedId = viewMode == .list ? visibleSuccessor(after: id) : nil
        }
        emitSnapshot()
        notifyPersist() // 收起态跨重启（§11）
    }

    /// restoreTile：恢复收起终端回网格原槽位并选中（§11「恢复即选中」；wait acknowledge 由
    /// TerminalService.impliedWaitAcknowledgeTarget 与 tileClick 同型处理）。非收起/未知 id no-op。
    public func restoreTile(_ terminalId: String) {
        let id = SessionID(raw: terminalId)
        guard order.contains(id), minimized.contains(id) else { return }
        minimized.remove(id)
        lastLines.removeValue(forKey: id)
        selectedId = id
        emitSnapshot()
        notifyPersist()
    }

    /// restoreAllMinimized：清空收起集（§11 边栏底部「全部恢复」）。空集 no-op；不改选中/焦点。
    public func restoreAllMinimized() {
        guard !minimized.isEmpty else { return }
        minimized.removeAll()
        lastLines.removeAll()
        emitSnapshot()
        notifyPersist()
    }

    /// renameSubmit：空串=清除自定义名，否则设置（term-grid.md §4.4 编辑三态是 web 本地，仅提交过桥）。
    /// 等值早退：值未变不重推不写盘（反向同步路径 setTitle 等值重放时免冗余 snapshot/persist）。
    public func renameSubmit(_ terminalId: String, name: String) {
        let id = SessionID(raw: terminalId)
        guard order.contains(id) else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let newValue = trimmed.isEmpty ? nil : trimmed
        guard customNames[id] != newValue else { return }
        customNames[id] = newValue
        emitSnapshot()
        notifyPersist() // customName 写回 config.openTerminals（尾批 item 3）
    }

    /// reorder：拖拽重排最终顺序（桥草案 §3.2 方案 B）。只重排已知 id，未知 id 忽略、缺席可见 id 保留原相对序末尾。
    /// 收起槽位锁定（term-grid.md §11 TG_MIN_reorder_preserves_minimized_slots）：web 只对可见 tile 发重排，
    /// 收起终端不在 newOrder——旧实现会把它们甩到末尾破坏「恢复回原槽」；改为可见子序列置换、收起 id 钉原槽。
    /// 无收起时与旧实现逐位等价（既有拖拽用例不动）。
    public func reorder(_ newOrder: [String]) {
        let known = Set(order.map(\.raw))
        // 可见置换流：filtered newOrder（去重、剔收起）+ 未提及的可见旧 id 按原相对序垫底。
        var stream: [SessionID] = []
        for raw in newOrder where known.contains(raw) {
            let id = SessionID(raw: raw)
            if !minimized.contains(id), !stream.contains(id) { stream.append(id) }
        }
        for id in order where !minimized.contains(id) && !stream.contains(id) { stream.append(id) }
        // 逐槽重建：收起槽原位保留，可见槽按流填充（流长恒等于可见槽数）。
        var next: [SessionID] = []
        var iterator = stream.makeIterator()
        for id in order {
            if minimized.contains(id) {
                next.append(id)
            } else if let visible = iterator.next() {
                next.append(visible)
            }
        }
        guard next != order else { return }
        order = next
        emitSnapshot()
        notifyPersist() // 维序写回 config.openTerminals（尾批 item 1）
    }

    /// WaitDetector 结论落投影（批5①，wait-detector.md §3）：`source` 非空 = 该终端等待（.layer0/
    /// .silence），nil = 清回运行。生产由 WaitDetectorHub.onConclusion（edge-triggered、已去重）hop
    /// main 调；显式 acknowledge / tileClick / 用户输入 reset 均经 hub→core→onConclusion 回流至此。
    /// 经共享去抖器（waitingInput/running 均非终态 → 50ms 去抖，WD_debounce_50ms）；无变化不记。
    public func noteWaiting(_ id: SessionID, _ source: WaitSource?) {
        guard order.contains(id) else { return } // 已移除终端忽略（poll 剪除后残包）
        let prev = waitSources[id]
        guard prev != source else { return }
        if let source { waitSources[id] = source } else { waitSources.removeValue(forKey: id) }
        // hook 彩排取证锚点（socket 收包→此处→50ms 去抖→deliver 推 UI）。
        Self.lifecycleLog.notice(
            "wait 结论落投影 id=\(id.raw, privacy: .public) source=\(source.map { String(describing: $0) } ?? "clear", privacy: .public)")
        // 触发整快照重建（emit 忽略入参，读当前 waitSources）；waitingInput/running 非终态 → 去抖。
        debouncer.record(source == nil ? .running : .waitingInput, nowMs: nowMs())
    }

    /// alt-screen 边沿落投影（message-editor.md §1/§8）：会话层 vt ACTIVE_SCREEN 翻转 → TerminalService
    /// hop main 调此。`isAlt` = 是否在备用屏。形态切换是程序驱动的边沿事件（rare），立即推（非去抖），
    /// web 据 ui.state.altScreen 切 RichEditor/RawTerminal。已移除终端忽略（防悬空）；无变化不推（幂等守）。
    public func noteAltScreen(_ id: SessionID, _ isAlt: Bool) {
        guard order.contains(id) else { return }
        let prev = altScreens[id] ?? false
        guard prev != isAlt else { return }
        if isAlt { altScreens[id] = true } else { altScreens.removeValue(forKey: id) }
        emitSnapshot()
    }

    /// 收起终端末行摘要落投影（term-grid.md §11）：TerminalService 心跳 1Hz 采样 currentFrame 调此
    /// （已截 ≤120 字符）。门控：仅收起集成员接受（非收起终端不携带 lastLine，payload 冻结）、变化才记。
    /// 非用户驱动 → 经共享去抖器合帧（同 tick 多终端更新收敛单次推送；.running 非 immediate → 50ms 去抖）。
    public func noteLastLine(_ id: SessionID, _ line: String) {
        guard minimized.contains(id), lastLines[id] != line else { return }
        lastLines[id] = line
        debouncer.record(states[id] ?? .running, nowMs: nowMs())
    }

    // MARK: 装配辅助（TerminalService 用）

    /// 起始建 N 个终端于 homePath（AppDelegate 启动装配经此，替代旧的裸 registry.create 循环）。
    @discardableResult
    public func startupCreate(count: Int) -> [String] {
        var ids: [String] = []
        for _ in 0..<max(0, count) {
            if case let .created(terminalId, _) = createTerminal(cwd: nil) { ids.append(terminalId) }
        }
        return ids
    }

    /// 会话恢复（尾批 item 1/3）：逐 config.openTerminals entry 重 spawn 新 shell 于其 cwd、带出
    /// customName（legacy 语义 = 新 shell 非续命）。空 entries 或全部创建失败 → 回退建 fallbackCount 个
    /// 于 homePath（首启/坏配置不至无终端）。坏 cwd 该 entry 回退 homePath（不因单条坏 cwd 丢终端）。
    /// 加载非用户动作 → 全程抑制 onTerminalsPersist（不回写正在读的 config）。
    @discardableResult
    public func restoreTerminals(_ entries: [PersistableTerminal], fallbackCount: Int) -> [String] {
        lastRestoreJoin = []
        guard !entries.isEmpty else { return startupCreate(count: fallbackCount) }
        suppressPersist = true
        defer { suppressPersist = false }
        var ids: [String] = []
        var join: [RestoreJoin] = []
        var anyMinimized = false
        for entry in entries {
            // 坏 cwd → nil（createTerminal 回退 homePath），保证不因坏 cwd 拒建整条（TSR_bad_cwd_falls_back）。
            let expanded = (entry.cwd as NSString).expandingTildeInPath
            let cwd: String? = Self.isValidDirectory(expanded) ? entry.cwd : nil
            guard case let .created(terminalId, _) = createTerminal(cwd: cwd) else { continue }
            if let name = entry.customName, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                renameSubmit(terminalId, name: name)
            }
            // 收起态跨重启（term-grid.md §11 TG_MIN_persist_roundtrip）：恢复即收起（不建洞；
            // 尺寸门由 TerminalService.ensureBackgroundSized 主格尺寸拷贝兜底，防 80×24 注入烧写）。
            if entry.minimized {
                minimized.insert(SessionID(raw: terminalId))
                anyMinimized = true
            }
            ids.append(terminalId)
            // M4b §3：记 join（新 termId ↔ 来源持久化项，含稳定 id + cwd）供恢复层 join 会话锚点。
            join.append(RestoreJoin(newId: terminalId, source: entry))
        }
        guard !ids.isEmpty else { return startupCreate(count: fallbackCount) }
        if anyMinimized {
            // createTerminal 逐条选中末位；末位若恢复为收起态则选中回落首个可见项（收起项不可为 selected）。
            if let sel = selectedId, minimized.contains(sel) {
                selectedId = order.first { !minimized.contains($0) }
            }
            emitSnapshot() // 收起标志在最后一次 create 的 emit 之后落定 → 终帧补推一次
        }
        lastRestoreJoin = join
        return ids
    }

    /// 维序的可持久化终端项（config.openTerminals 写回用；含终态 tile——下次启动重 spawn 新 shell）。
    /// M4b【T-3】：id = 运行时 SessionID（落盘作会话锚点 join 键，terminal-session-restore.md §2/§3）。
    public var persistableTerminals: [PersistableTerminal] {
        order.map {
            PersistableTerminal(
                id: $0.raw, cwd: cwds[$0] ?? homePath, customName: customNames[$0],
                minimized: minimized.contains($0))
        }
    }

    /// 当前快照（不经去抖，装配后首推 / 冷路径用）。
    public func snapshot() -> ProjectionSnapshot { buildSnapshot() }

    /// 维序活体终端 id（WaitDetector poll 用，wait-detector.md §6）：TerminalService 逐 id 取
    /// session.pid/lastOutputMs 组 LiveTerminal 喂 hub.poll。已关终端由 registry.session 侧过滤。
    public var liveTerminalIds: [String] { order.map(\.raw) }

    /// 收起终端 id（维序；term-grid.md §11）：TerminalService 心跳末行采样 + 后台尺寸门用。
    public var minimizedTerminalIds: [String] { order.filter { minimized.contains($0) }.map(\.raw) }

    /// 可见（未收起）终端 id（维序）：后台尺寸门的拷贝源候选（§11.4）。
    public var visibleTerminalIds: [String] { order.filter { !minimized.contains($0) }.map(\.raw) }

    /// List 态后台终端 id（term-list-mode.md 尺寸门泛化）：仅 viewMode==.list 时 = order 中**非选中、非收起**
    /// 的终端（其详情不渲、无洞、无 layoutReport → hasReceivedResize=false，切换/resume 注入前需先有真实
    /// 尺寸）；非 List 态恒空。与 minimizedTerminalIds 无交集（此处剔收起），二者并集 = 后台尺寸门目标集。
    public var listBackgroundTerminalIds: [String] {
        guard viewMode == .list else { return [] }
        return order.filter { !minimized.contains($0) && $0 != selectedId }.map(\.raw)
    }

    // MARK: 私有

    private func emitSnapshot() {
        onSnapshot?(buildSnapshot())
    }

    /// 结构/命名变化后回写 config.openTerminals（restore 加载期抑制）。
    private func notifyPersist() {
        guard !suppressPersist else { return }
        onTerminalsPersist?()
    }

    private func buildSnapshot() -> ProjectionSnapshot {
        var strongWaiting = 0
        var visibleWaiting = 0
        let terminals = order.map { id -> ProjectionTerminal in
            let base = states[id] ?? (registry.state(of: id) ?? .running)
            // WaitDetector 叠加（§2/§3）：仅底层 Running 才叠 waitingInput（态机 WAIT_INPUT 仅 Running
            // 出边；Stopping/终态不显等待——退出/关闭由进程源接管，防悬红）。强信号计入浮卡 count（§6）；
            // waitingInput 全体（含静默）计入 Dock 徽标口径（wait-detector.md §8，settings-dogfood 批）。
            var state = base
            if let source = waitSources[id], base == .running {
                state = .waitingInput
                visibleWaiting += 1
                if source.isStrong { strongWaiting += 1 }
            }
            let isMin = minimized.contains(id)
            return ProjectionTerminal(
                id: id.raw, state: state, cwd: cwds[id] ?? homePath, customName: customNames[id],
                altScreen: altScreens[id] ?? false,
                minimized: isMin, lastLine: isMin ? lastLines[id] : nil)
        }
        return ProjectionSnapshot(
            terminals: terminals,
            selectedId: selectedId?.raw,
            focusedId: focusedId?.raw,
            activeSidebarId: activeSidebarId?.raw,
            viewMode: viewMode,
            // maxReached = 本窗满 20 ∨ 全局满 40（multi-window.md §3.2）：任一成立即置真 → 本窗 FAB/菜单
            // 「新建终端」置灰（按窗独立判：A 窗满而 B 窗空则只 A 置灰，除非全局已 40 则全窗置灰）。
            maxReached: RegistryPolicy.perWindowMaxReached(currentCount: order.count) || registry.maxReached,
            waitingCount: strongWaiting,
            visibleWaitingCount: visibleWaiting
        )
    }

    private static func isValidDirectory(_ path: String) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue
    }

    /// OSC7 原始 cwd 归一：`file://host/path` → 解码后的 `/path`（URL.path 自带百分号解码）；
    /// 已是普通绝对路径原样返回；空/非法返回 nil（不落脏值）。legacy 走正则刮屏（manager.ts:271-288），
    /// 本实现走结构化 URL 解析（vt 的 PWD_CHANGED 结构化通道，§5 主路径）。
    static func normalizeCwd(_ raw: String) -> String? {
        guard !raw.isEmpty else { return nil }
        if raw.hasPrefix("file://") {
            if let url = URL(string: raw), !url.path.isEmpty { return url.path }
            return nil
        }
        return raw.hasPrefix("/") ? raw : nil
    }
}
