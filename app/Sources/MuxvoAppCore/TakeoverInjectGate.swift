// 注入门纯决策 + 注入串规范化（裁决终裁细则 §3）。
//
// 开源前置重构第 2 步（2026-07-18）：本纯枚举从 TakeoverTerminalManager.swift 抽出到独立文件——
// InitialCommandInjector（公开、非编排）复用 normalize/静默门决策，故须留公开仓（原文件依赖 MuxvoScheduler
// 属编排专属、进 exclude.txt）。本文件零编排依赖（仅 Foundation），公开仓保留。
import Foundation

/// 注入门纯决策 + 注入串规范化（裁决终裁细则 §3）。
public enum TakeoverInjectGate {
    /// 静默窗（裁决：历史重印分块间隙 << 500ms << 人类响应；首输出后静默 ≥ 此值才注入）。
    public static let silenceMs: UInt64 = 500
    /// 注入超时（裁决：8s 未达成静默门 → 放弃注入，不重试，降级 web 提示条）。
    public static let timeoutMs: UInt64 = 8_000

    public enum Decision: Equatable, Sendable {
        case inject
        case wait
        case abort
    }

    /// 门决策（纯函数）：超时 → abort；已见首输出（lastOutputMs 晚于 spawn 基线）且静默 ≥silenceMs
    /// → inject；否则 wait。超时优先判（持续喷字节永不静默的 CLI 在 8s 处收口）。
    public static func evaluate(
        baselineMs: UInt64, lastOutputMs: UInt64, nowMs: UInt64, deadlineMs: UInt64
    ) -> Decision {
        if nowMs >= deadlineMs { return .abort }
        let seenFirstOutput = lastOutputMs > baselineMs
        guard seenFirstOutput else { return .wait } // 未见首输出不盲注（残影/对话框吞字防线）
        let silence = nowMs > lastOutputMs ? nowMs - lastOutputMs : 0 // 时钟同域防御（无符号防下溢）
        return silence >= silenceMs ? .inject : .wait
    }

    /// 规范化（裁决细则2）：`\r`/`\n` 一律替换为空格（web 输入框本单行，防御性断言面）；
    /// 其余 C0 控制字节与 ESC/DEL 一律剥除——**绝不发 CR、绝不含 ESC**（意外对话框零确认零取消）。
    public static func normalize(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 0x0d, 0x0a: // CR/LF → 空格
                out.append(" ")
            case ..<0x20, 0x7f: // 其余 C0（含 ESC 0x1b、TAB、BEL）与 DEL → 剥除
                continue
            default:
                out.append(scalar)
            }
        }
        return String(out)
    }
}
