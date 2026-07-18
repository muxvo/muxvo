// What's New 触发门（specs/behavior/auto-update.md §7；legacy App.tsx:171-184 对等）：
// shouldShow = lastSeen 存在且 ≠ 当前；查询即写回（≠当前才写，首装缺席 → 不弹但写回）。
// 2s 延迟与弹窗渲染在 web 侧；本门由 whatsNewStatus 请求处理器调用（MuxvoAppCore 装配）。

import Foundation

public enum WhatsNewGate {
    public struct Verdict: Equatable, Sendable {
        public let shouldShow: Bool
        /// 非 nil = 处理器须把 lastSeenVersion 写回为该值。
        public let lastSeenToWrite: String?
        public init(shouldShow: Bool, lastSeenToWrite: String?) {
            self.shouldShow = shouldShow
            self.lastSeenToWrite = lastSeenToWrite
        }
    }

    public static func evaluate(lastSeen: String?, current: String) -> Verdict {
        let shouldShow = (lastSeen != nil && lastSeen != current)
        let write = (lastSeen != current) ? current : nil
        return Verdict(shouldShow: shouldShow, lastSeenToWrite: write)
    }
}
