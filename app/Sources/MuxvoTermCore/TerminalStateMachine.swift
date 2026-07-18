// 终端会话 10 态机（纯函数 + transitionTable）。
//
// 权威 oracle：specs/behavior/terminal-session.md §2.1 转移矩阵（v1-frozen，文档即 oracle）。
// rawValue 逐字对齐 spec token（状态 PascalCase、事件 UPPER_SNAKE），使测试能直接解析该
// markdown 表比对 transitionTable——改表不改文档必红（比照 MuxvoTaskEngine 的 TaskStateMachine
// 解析 task-state-machine.md §4 的做法）。
//
// 语义：命中表则转移；未命中**静默忽略**不报错（terminal-session.md §2.1 末段，宽松语义，
// 迁移自 legacy terminal-process.ts:50-56）——与 TaskStateMachine 的「表外即 illegalTransition」
// 相反，此处是终端会话核心的有意宽松语义。

/// 10 态（terminal-session.md §2）。M3 实际驱动 7 态（Created/Starting/Running/Stopping/
/// Stopped/Disconnected/Failed）；Busy/WaitingInput 属编排层观察，M4+ 由 hook 事件驱动，
/// 状态机先建全 10 态留位。
public enum TerminalState: String, CaseIterable, Sendable, Equatable, Hashable {
    case created = "Created"
    case starting = "Starting"
    case running = "Running"
    case busy = "Busy"
    case waitingInput = "WaitingInput"
    case stopping = "Stopping"
    case stopped = "Stopped"
    case disconnected = "Disconnected"
    case failed = "Failed"
    case removed = "Removed"

    /// 可移除终态（Stopped/Disconnected/Failed）= REMOVE 事件的合法前继（§2.1 转移表出边）。
    /// 尾批 item 4：终态 tile 的关闭钮 = 移除（照 legacy dead-tile dismiss 语义）。
    public var isRemovable: Bool {
        switch self {
        case .stopped, .disconnected, .failed: return true
        default: return false
        }
    }
}

/// 14 事件（terminal-session.md §2）。
public enum TerminalEvent: String, CaseIterable, Sendable, Equatable, Hashable {
    case spawn = "SPAWN"
    case spawnSuccess = "SPAWN_SUCCESS"
    case spawnFailure = "SPAWN_FAILURE"
    case processStart = "PROCESS_START"
    case processDone = "PROCESS_DONE"
    case waitInput = "WAIT_INPUT"
    case userInput = "USER_INPUT"
    case autoResume = "AUTO_RESUME"
    case close = "CLOSE"
    case exitNormal = "EXIT_NORMAL"
    case exitAbnormal = "EXIT_ABNORMAL"
    case timeout = "TIMEOUT"
    case reconnect = "RECONNECT"
    case remove = "REMOVE"
}

/// 纯函数状态机 + 可持有当前态的轻量实例（send 宽松语义）。
public struct TerminalStateMachine: Sendable, Equatable {
    /// from × event → to（terminal-session.md §2.1 逐行迁移）。终态 Removed 无出边（空行但入表，
    /// 保证 transitionTable.keys 覆盖全 10 态）。
    public static let transitionTable: [TerminalState: [TerminalEvent: TerminalState]] = [
        .created: [.spawn: .starting],
        .starting: [.spawnSuccess: .running, .spawnFailure: .failed],
        .running: [
            .processStart: .busy,
            .waitInput: .waitingInput,
            .close: .stopping,
            .exitAbnormal: .disconnected,
        ],
        .busy: [.processDone: .running],
        .waitingInput: [.userInput: .running, .autoResume: .running],
        .stopping: [.exitNormal: .stopped, .timeout: .disconnected],
        .stopped: [.remove: .removed],
        .disconnected: [.reconnect: .starting, .remove: .removed],
        .failed: [.remove: .removed],
        .removed: [:],
    ]

    /// 纯查表：命中返回目标态，未命中返回 nil（宽松语义由调用方/send 处理）。
    public static func next(_ event: TerminalEvent, from state: TerminalState) -> TerminalState? {
        transitionTable[state]?[event]
    }

    public private(set) var state: TerminalState

    public init(state: TerminalState = .created) {
        self.state = state
    }

    /// 送入事件：命中则推进并返回 true；未命中静默保持原态返回 false（terminal-session.md §2.1）。
    @discardableResult
    public mutating func send(_ event: TerminalEvent) -> Bool {
        guard let to = Self.next(event, from: state) else { return false }
        state = to
        return true
    }
}
