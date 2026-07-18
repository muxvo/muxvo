// WaitDetectorHub：等待检测协调器（wait-detector.md §3 层合成 + §6 兜底轮询）。
//
// M3 唯一 WaitEventBus 订阅者（§0）：消费硬事件流（socket 三 hook + userInput reset + acknowledge
// + processExit），逐 termId 路由到 WaitDetectorCore，edge-triggered 时经 onConclusion 驱动投影。
// M4a 编排引擎作**第二订阅者**读同一 bus（本 hub 不独占）。
//
// 静默兜底（§6）：不走 bus——静默是依赖 detector 自身状态（lastActivity/hasSeenLayer0）的派生弱
// 信号，由 poll(1s) 直查/驱 core（setForegroundNonShell + recordActivity(session.lastOutputMs)
// + evaluateSilence）。WaitEventKind.silence 保留在冻结枚举供 replay/直投，生产由 poll 驱动。
//
// 并发：core 状态收敛到单串行 hubQueue（bus 投递、poll、reset/ack 全 hop 到此）；onConclusion
// 由调用方决定线程（真壳 hop main 落投影）。故 hub 自身 Sendable-安全，不触 @MainActor 类型。
import Dispatch
import Foundation
import MuxvoKit

public final class WaitDetectorHub: @unchecked Sendable {
    /// poll 所需的活体终端信息（真壳由 SessionRegistry 提供；shellPid 供前台探测，lastOutputMs 供静默计时）。
    public struct LiveTerminal: Sendable, Equatable {
        public let termId: String
        public let shellPid: Int32
        public let lastOutputMs: UInt64
        public init(termId: String, shellPid: Int32, lastOutputMs: UInt64) {
            self.termId = termId
            self.shellPid = shellPid
            self.lastOutputMs = lastOutputMs
        }
    }

    private let hubQueue = DispatchQueue(label: "muxvo.wait.hub")
    private let bus: WaitEventBus
    /// edge 时的结论出口：source 非空=等待（.layer0/.silence），nil=running/清。真壳接 projection.noteWaiting。
    private let onConclusion: @Sendable (SessionID, WaitSource?) -> Void
    /// 前台非 shell 探测（默认真探测；测试注入假探测）。
    private let foregroundProbe: @Sendable (Int32) -> Bool

    // hubQueue 限定态。
    private var cores: [String: WaitDetectorCore] = [:]
    private var lastEmitted: [String: WaitConclusion] = [:]
    private var busToken: WaitEventBus.Token?

    public init(
        bus: WaitEventBus,
        onConclusion: @escaping @Sendable (SessionID, WaitSource?) -> Void,
        foregroundProbe: @escaping @Sendable (Int32) -> Bool = { ForegroundProbe.isNonShellForeground(shellPid: $0) }
    ) {
        self.bus = bus
        self.onConclusion = onConclusion
        self.foregroundProbe = foregroundProbe
        // M3 唯一订阅者：硬事件在 hubQueue 上收，与 poll/ack 同串行上下文。
        busToken = bus.subscribe(deliverOn: hubQueue) { [weak self] event in
            self?.handleEventOnQueue(event)
        }
    }

    deinit { if let t = busToken { bus.unsubscribe(t) } }

    // MARK: 硬事件入口（经 bus 流入，供 M4a 同源；本 hub 亦提供直投便捷法）

    /// 用户输入 reset（PTY 写入路径，§3）：发 .userInput 上 bus（M4a 同源）→ 本 hub 订阅路由到 core。
    public func noteUserInput(termId: String, ts: UInt64 = WaitClock.nowMs()) {
        bus.publish(WaitEvent(termId: termId, event: .userInput, ts: ts))
    }

    /// acknowledge（tileClick / acknowledgeWaiting，§3）：发 .acknowledge 上 bus → 清红。
    public func acknowledge(termId: String, ts: UInt64 = WaitClock.nowMs()) {
        bus.publish(WaitEvent(termId: termId, event: .acknowledge, ts: ts))
    }

    /// 前台进程退出（§6）：发 .processExit 上 bus → 清静默弱信号。
    public func noteProcessExit(termId: String, ts: UInt64 = WaitClock.nowMs()) {
        bus.publish(WaitEvent(termId: termId, event: .processExit, ts: ts))
    }

    // MARK: 静默/前台轮询（1s，真壳心跳驱动；§6）

    /// 逐活体终端：折入其 PTY 输出活动（lastOutputMs）+ 前台非 shell 门控 + 静默评估；edge 则驱动。
    /// 顺带剪除已消失终端的 core（活体表外）。nowMs 默认真 epoch ms（测试传假时钟）。
    public func poll(live: [LiveTerminal], nowMs: UInt64 = WaitClock.nowMs()) {
        hubQueue.sync {
            let liveIds = Set(live.map(\.termId))
            for term in live {
                let core = coreOnQueue(term.termId, startMs: nowMs)
                core.recordActivity(ts: term.lastOutputMs)
                core.setForegroundNonShell(foregroundProbe(term.shellPid))
                _ = core.evaluateSilence(nowMs: nowMs)
                emitIfChangedOnQueue(term.termId, core.conclusion)
            }
            // 剪除已消失终端：清 core + 缓存（无需再驱动，投影侧终端已随生命周期移除）。
            for id in cores.keys where !liveIds.contains(id) {
                cores.removeValue(forKey: id)
                lastEmitted.removeValue(forKey: id)
            }
        }
    }

    /// 测试/观测：某终端当前结论（无 core 则 running）。
    public func conclusion(for termId: String) -> WaitConclusion {
        hubQueue.sync { cores[termId]?.conclusion ?? .running }
    }

    // MARK: 私有（hubQueue 限定）

    private func handleEventOnQueue(_ event: WaitEvent) {
        let core = coreOnQueue(event.termId, startMs: event.ts)
        _ = core.ingest(event.event, ts: event.ts)
        emitIfChangedOnQueue(event.termId, core.conclusion)
    }

    private func coreOnQueue(_ termId: String, startMs: UInt64) -> WaitDetectorCore {
        if let core = cores[termId] { return core }
        let core = WaitDetectorCore(startMs: startMs)
        cores[termId] = core
        return core
    }

    /// 结论较上次变化才驱动（edge-triggered）：比较等待态 + 来源。
    private func emitIfChangedOnQueue(_ termId: String, _ conclusion: WaitConclusion) {
        if let prev = lastEmitted[termId], prev == conclusion { return }
        lastEmitted[termId] = conclusion
        onConclusion(SessionID(raw: termId), conclusion.isWaiting ? conclusion.source : nil)
    }
}
