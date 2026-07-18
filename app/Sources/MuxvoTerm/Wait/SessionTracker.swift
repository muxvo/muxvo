// SessionTracker：终端会话恢复锚点采集（terminal-session-restore.md §1）。
//
// = WaitEventBus **第三订阅者**（M3 detector hub / M4b 编排引擎为前两个）。独立于 detector 主链——
// 异常绝不回传 bus（fail-open）。采集源 = CC hook 事件（notification/stop/userPromptSubmit/
// sessionStart，末者为登记 4 兑现——resume 即锚定）的 WaitEvent.raw（CC hook stdin 原始 JSON 文本，
// 不可信）。白名单抽取 session_id/cwd/transcript_path。
//
// 依赖倒置（同 SessionRegistry→PtyChildrenStore）：本类不落盘、不 import MuxvoStorage——经**注入闭包**
// record/remove 写锚点 store（MuxvoAppCore 装配时把 TerminalActiveSessionsStore.updateAnchor/clear
// 接进来）。ownership 排除亦经注入闭包（B1 阶段绑定表未建，装配层用 takeover 现有登记做排除）。
//
// 硬约束（§1）：
//  · **无条件登记**——transcript 文件存在性绝不做登记条件（resume 前才校验，§3 预检）；
//  · **fail-open**——raw=nil/非法 JSON/缺 session_id → 不产锚点、不抛错、零影响 detector 主链；
//  · **只采 human**——ownership∈{human,worker,takeover,brain} 只采 human（防与调度器 §6/接管 §4.7 双恢复）；
//  · **内容盲**——只取 sessionId/cwd/transcript_path 定位用，不解读会话内容（核心原则二边界）。
import Dispatch
import Foundation

/// 终端归属（§1 found B-2）：只有 human（用户手起的普通终端）进恢复路径。worker/takeover/brain
/// 各由调度器 §6 / 接管 §4.7 / 指挥台自恢复。B1 阶段绑定表未建：查无绑定 = human（默认，向后兼容）。
public enum TerminalOwnership: String, Sendable, Equatable {
    case human
    case worker
    case takeover
    case brain
}

public final class SessionTracker: @unchecked Sendable {
    /// 白名单三字段（§1）。cwd/transcript_path 缺席 → 空串（无条件登记，恢复层复检退化）。
    public struct AnchorFields: Equatable, Sendable {
        public let sessionId: String
        public let cwd: String
        public let transcript: String
    }

    /// raw 解析大小上限（不可信数据防线；上游 HookSocketListener 已 64KB 截，此为纵深防御）。
    private static let maxRawBytes = 256 * 1024

    private let bus: WaitEventBus
    private let record: @Sendable (_ termId: String, _ sessionId: String, _ cwd: String, _ transcriptPath: String, _ ts: UInt64) -> Void
    private let remove: @Sendable (_ termId: String) -> Void
    private let ownershipOf: @Sendable (_ termId: String) -> TerminalOwnership
    private var token: WaitEventBus.Token?

    public init(
        bus: WaitEventBus,
        deliverOn: DispatchQueue,
        record: @escaping @Sendable (_ termId: String, _ sessionId: String, _ cwd: String, _ transcriptPath: String, _ ts: UInt64) -> Void,
        remove: @escaping @Sendable (_ termId: String) -> Void,
        ownershipOf: @escaping @Sendable (_ termId: String) -> TerminalOwnership = { _ in .human }
    ) {
        self.bus = bus
        self.record = record
        self.remove = remove
        self.ownershipOf = ownershipOf
        token = bus.subscribe(deliverOn: deliverOn) { [weak self] event in self?.handle(event) }
    }

    deinit { if let token { bus.unsubscribe(token) } }

    /// 用户显式关闭终端 / 终端移除（§1 清条目）：装配层从投影移除路径调。processExit 走 bus。
    public func terminalRemoved(termId: String) { remove(termId) }

    // MARK: - bus 事件处理（deliverOn 队列）

    private func handle(_ event: WaitEvent) {
        switch event.event {
        case .notification, .stop, .userPromptSubmit, .sessionStart:
            // sessionStart（登记 4 兑现，2026-07-16）：resume/启动即锚定——堵「resume 起来但
            // 从未再对话的会话零 hook 事件 → 永无锚点 → 意外关闭不可恢复」缺口（真机案例 wt-8）。
            // ownership 排除（§1 found B-2）：非 human 终端不采集（防双恢复）。
            guard ownershipOf(event.termId) == .human else { return }
            // fail-open：坏 raw / 缺 session_id → 不产锚点（零影响主链——本订阅者独立于 detector）。
            guard let f = Self.parseAnchorFields(raw: event.raw) else { return }
            // 无条件登记（§1）：文件存在性绝不做条件；harness=.cc 由 store 侧固定（M4b CC-only）。
            record(event.termId, f.sessionId, f.cwd, f.transcript, event.ts)
        case .processExit:
            // 前台 harness 退出 → 清该 termId 锚点（§1 清条目）。
            remove(event.termId)
        case .silence, .userInput, .acknowledge:
            break // 与锚点无关（等待/清红子系统事件）。
        }
    }

    // MARK: - 纯解析（fail-open，可单测）

    /// raw JSON → 白名单三字段。缺 session_id / raw=nil / 非法 JSON / 超限 → nil（fail-open）。
    /// 按不可信数据：大小上限 + 字段白名单，绝不 eval/透传 shell（内容盲）。
    public static func parseAnchorFields(raw: String?) -> AnchorFields? {
        guard let raw, let data = raw.data(using: .utf8), data.count <= maxRawBytes else { return nil }
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        guard let sid = obj["session_id"] as? String, !sid.isEmpty else { return nil }
        let cwd = obj["cwd"] as? String ?? ""
        let transcript = obj["transcript_path"] as? String ?? ""
        return AnchorFields(sessionId: sid, cwd: cwd, transcript: transcript)
    }
}
