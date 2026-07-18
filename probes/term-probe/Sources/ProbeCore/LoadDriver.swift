// LoadDriver：两种灌负载方式
// 1) 经 PTY：往会话 shell 发命令跑 loads/ 下的对抗脚本
// 2) 隔离模式：绕过 PTY 直接 vt_write 合成数据（含「按 1 字节 chunk 切 UTF-8」模式）
import Foundation

public enum LoadKind: String, CaseIterable, Sendable {
    case color
    case cjk
    case alt
    case wrap
    case fill
    case mix
    case cast // CC .cast 回放（隔离模式直灌，无 shell）
    case ccmix // 标准混布：12×cast + 4×color + 2×cjk + 2×alt（按 20 取模）

    public var scriptName: String? {
        switch self {
        case .color: return "flood-color.sh"
        case .cjk: return "flood-cjk.sh"
        case .alt: return "altscreen-churn.sh"
        case .wrap: return "wrap-resize.sh"
        case .fill: return "scrollback-fill.sh"
        case .mix, .cast, .ccmix: return nil
        }
    }

    public static let mixCycle: [LoadKind] = [.color, .cjk, .alt, .wrap, .fill]

    /// 总计划标准混布（20 会话）：12×CC加速回放 + 4×flood-color + 2×flood-cjk + 2×altscreen
    public static let ccmixPattern: [LoadKind] =
        Array(repeating: .cast, count: 12)
        + Array(repeating: .color, count: 4)
        + Array(repeating: .cjk, count: 2)
        + Array(repeating: .alt, count: 2)

    /// mix/ccmix 按会话序号解析到具体负载；其余原样返回
    public func resolved(forIndex index: Int) -> LoadKind {
        switch self {
        case .mix: return Self.mixCycle[index % Self.mixCycle.count]
        case .ccmix: return Self.ccmixPattern[index % Self.ccmixPattern.count]
        default: return self
        }
    }
}

public enum LoadDriver {
    /// 在会话 shell 内启动 loads/ 脚本（bash 跑，脚本依赖 bash 特性）。
    /// exec 替换掉 shell，脚本结束即会话进程退出——压测窗口内由探针先杀。
    public static func startScript(
        on session: TerminalSession,
        loadsDir: String,
        kind: LoadKind,
        index: Int,
        seconds: Int
    ) {
        let k = kind.resolved(forIndex: index)
        guard let script = k.scriptName else { return }
        session.send("exec bash '\(loadsDir)/\(script)' \(seconds)\n")
    }

    /// 按 1 字节 chunk 切分灌入：验证 UTF-8 / 逃逸序列被任意切分时 vt 解析的正确性
    public static func feedByteByByte(_ bytes: [UInt8], into session: TerminalSession) {
        for b in bytes {
            session.feed([b])
        }
    }

    /// 确定性合成 chunk（隔离模式洪水，无需 shell）
    public static func syntheticChunk(kind: LoadKind, iteration i: Int) -> [UInt8] {
        let s: String
        switch kind {
        case .color, .mix, .cast, .ccmix:
            let c = i % 256
            s = "\u{1b}[38;2;\(c);\((c &+ 97) % 256);\((c &+ 199) % 256)m█████ synthetic color row \(i) █████\u{1b}[0m\r\n"
        case .cjk:
            s = "\(String(format: "%05d", i)) 终端性能压测中文宽字符 👍🏽🚀 混排 mixed width テスト\r\n"
        case .alt:
            s = i % 2 == 0
                ? "\u{1b}[?1049h\u{1b}[2J\u{1b}[H\u{1b}[7m TUI frame \(i) \u{1b}[0m"
                : "\u{1b}[?1049l main screen batch \(i)\r\n"
        case .wrap:
            s = String(format: "%05d ", i) + String(repeating: "wrap-\(i % 10)", count: 60) + "\r\n"
        case .fill:
            s = String(format: "scrollback-fill %08d lorem ipsum dolor sit amet consectetur\r\n", i)
        }
        return Array(s.utf8)
    }
}
