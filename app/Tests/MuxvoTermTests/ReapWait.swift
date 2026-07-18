// 事件驱动收尸等待（M7 批6 flaky 根治）：替代 RegistryTests/TerminalServiceTests/
// UIStateProjection* 的 `pollUntil { 终态/exitInfo/账本 }` 固定截止轮询。
//
// 根因（见 CITimeoutScale.swift 头注释 + flaky 台账收尸族）：真 PTY 进程退出经 kqueue
// NOTE_EXIT → 每会话后台 waiter → registry queue 驱态机，满载下这条链的调度延迟被抬到数秒，
// 短轮询窗口（6s）在延迟清退前到期 → 满载偶红、隔离恒绿。事件本身一定会到，只是轮询太早放弃。
//
// 修法：不再轮询快照对赌墙钟截止，改为**登记事件驱动信号**（SessionRegistry.onExitReaped，于
// handleExit 收尸完在 registry queue 直接兑现，不 hop main）→ 阻塞信号量等真事件到达。backstop
// 仅作防挂底（默认 60s，远大于任何真延迟），与负载解耦：满载只是等更久，绝不早退。兑现时该会话
// 态机已到终态、exitInfo/pty-children 账本均就位，故调用方随后同步读 state(of:)/exitInfo(of:) 一致。
import Darwin
import Dispatch
import Foundation
import MuxvoKit

@testable import MuxvoTerm

/// 收尸结果线程安全信箱（handler 在 registry queue 写、等待线程读）。
private final class ReapBox: @unchecked Sendable {
    private let lock = NSLock()
    private var _value: (PTYExit, Bool)?
    func store(_ v: (PTYExit, Bool)) { lock.lock(); _value = v; lock.unlock() }
    var value: (PTYExit, Bool)? { lock.lock(); defer { lock.unlock() }; return _value }
}

extension SessionRegistry {
    /// 阻塞等某会话退出被收尸至终态（事件驱动，替代 pollUntil 收尸轮询）。返回 exitInfo
    /// （PTYExit + 是否 SIGKILL 强杀升级）；nil = backstop 超时（真事件永不到达才发生，纯防挂）。
    /// backstop 缩放沿用 muxvoCITimeoutScale（CI ×8），本机默认 60s——与负载解耦，只作防挂底。
    @discardableResult
    func awaitReaped(_ id: SessionID, backstop: TimeInterval = 60) -> (PTYExit, Bool)? {
        let box = ReapBox()
        let sem = DispatchSemaphore(value: 0)
        onExitReaped(id) { exit, forced in
            box.store((exit, forced))
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + backstop * muxvoCITimeoutScale())
        return box.value
    }

    /// 批量事件驱动等待多会话全部被收尸至终态（顺序 await 各会话）。全部命中返回 true。
    @discardableResult
    func awaitAllReaped(_ ids: [SessionID], backstop: TimeInterval = 60) -> Bool {
        ids.allSatisfy { awaitReaped($0, backstop: backstop) != nil }
    }
}
