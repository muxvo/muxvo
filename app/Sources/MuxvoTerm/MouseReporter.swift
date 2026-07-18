// MouseReporter：鼠标上报编码（行为规格 terminal-input.md §5）。会话串行 queue 专属。
//
// vt GHOSTTY_MOUSE_* encoder：tracking 活跃且**未按 Shift** 时把鼠标事件编码进 PTY。
//   - tracking 门控读 GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING（X10/normal/button/any 任一活跃）。
//   - Shift 旁通（终端惯例）：按住 Shift 强制走本地选区 → 本层返回 nil（视图据此改走选区）。
//   - 格式/追踪模式由 setopt_from_terminal 每次同步（X10/SGR/urxvt/SGR-Pixels 随终端 DECSET）；
//     surface→cell 换算由 encoder 依 SIZE（cell px + padding）内建，故只喂 surface px 位置。
//
// 返回语义：nil = 未上报（视图走选区）；非 nil（含空 []）= 已上报（视图跳过选区；空=该事件无编码产出，
// 如 normal 模式的移动）。
import CGhosttyVT
import Dispatch

/// 一次鼠标事件的上报输入（vendor-free 值类型；映射到 vt 枚举在本文件内收口）。
public struct TerminalMouseReport: Sendable {
    public enum Action: Sendable { case press, release, motion }
    public enum Button: Sendable { case left, right, middle, none }

    public var action: Action
    public var button: Button
    public var shift: Bool
    public var control: Bool
    public var option: Bool
    public var command: Bool
    /// surface 空间像素坐标（backing px，(0,0)=左上）。
    public var surfaceX: Double
    public var surfaceY: Double

    public init(action: Action, button: Button,
                shift: Bool = false, control: Bool = false, option: Bool = false, command: Bool = false,
                surfaceX: Double, surfaceY: Double) {
        self.action = action; self.button = button
        self.shift = shift; self.control = control; self.option = option; self.command = command
        self.surfaceX = surfaceX; self.surfaceY = surfaceY
    }
}

final class MouseReporter: @unchecked Sendable {
    private var term: OpaquePointer?
    private var encoder: OpaquePointer?
    private var event: OpaquePointer?

    init?(term: OpaquePointer) {
        self.term = term
        var e: OpaquePointer?
        guard ghostty_mouse_encoder_new(nil, &e) == GHOSTTY_SUCCESS, let e else { return nil }
        var ev: OpaquePointer?
        guard ghostty_mouse_event_new(nil, &ev) == GHOSTTY_SUCCESS, let ev else {
            ghostty_mouse_encoder_free(e)
            return nil
        }
        self.encoder = e; self.event = ev
    }

    func shutdownOnQueue() {
        ghostty_mouse_event_free(event)
        ghostty_mouse_encoder_free(encoder)
        event = nil; encoder = nil; term = nil
    }

    /// 编码一次鼠标事件。tracking 未活跃或按住 Shift → nil（走选区）；否则返回编码字节（可能空）。
    func encodeOnQueue(report: TerminalMouseReport,
                       screenW: Int, screenH: Int, cellW: Int, cellH: Int) -> [UInt8]? {
        guard let term, let encoder, let event else { return nil }

        var tracking = false
        _ = ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING, &tracking)
        guard tracking, !report.shift else { return nil }   // 无追踪 / Shift 旁通 → 选区

        ghostty_mouse_encoder_setopt_from_terminal(encoder, term)   // 同步追踪模式 + 输出格式
        var size = GhosttyMouseEncoderSize()
        size.size = MemoryLayout<GhosttyMouseEncoderSize>.size
        size.screen_width = UInt32(max(0, screenW))
        size.screen_height = UInt32(max(0, screenH))
        size.cell_width = UInt32(max(1, cellW))
        size.cell_height = UInt32(max(1, cellH))
        ghostty_mouse_encoder_setopt(encoder, GHOSTTY_MOUSE_ENCODER_OPT_SIZE, &size)

        ghostty_mouse_event_set_action(event, report.action.ghostty)
        if let b = report.button.ghostty {
            ghostty_mouse_event_set_button(event, b)
        } else {
            ghostty_mouse_event_clear_button(event)
        }
        ghostty_mouse_event_set_mods(event, report.mods)
        ghostty_mouse_event_set_position(event, GhosttyMousePosition(x: Float(report.surfaceX), y: Float(report.surfaceY)))

        var buf = [CChar](repeating: 0, count: 64)
        var written = 0
        let rc = buf.withUnsafeMutableBufferPointer { p in
            ghostty_mouse_encoder_encode(encoder, event, p.baseAddress, p.count, &written)
        }
        guard rc == GHOSTTY_SUCCESS else { return nil }
        return buf.prefix(written).map { UInt8(bitPattern: $0) }
    }
}

// MARK: - vt 枚举映射（本文件收口，值类型保持 vendor-free）

private extension TerminalMouseReport.Action {
    var ghostty: GhosttyMouseAction {
        switch self {
        case .press: return GHOSTTY_MOUSE_ACTION_PRESS
        case .release: return GHOSTTY_MOUSE_ACTION_RELEASE
        case .motion: return GHOSTTY_MOUSE_ACTION_MOTION
        }
    }
}

private extension TerminalMouseReport.Button {
    var ghostty: GhosttyMouseButton? {
        switch self {
        case .left: return GHOSTTY_MOUSE_BUTTON_LEFT
        case .right: return GHOSTTY_MOUSE_BUTTON_RIGHT
        case .middle: return GHOSTTY_MOUSE_BUTTON_MIDDLE
        case .none: return nil
        }
    }
}

private extension TerminalMouseReport {
    /// Shift 已在 encodeOnQueue 前门控（旁通），故编码时不带 Shift 位。
    var mods: GhosttyMods {
        var m: GhosttyMods = 0
        if control { m |= GhosttyMods(GHOSTTY_MODS_CTRL) }
        if option { m |= GhosttyMods(GHOSTTY_MODS_ALT) }
        if command { m |= GhosttyMods(GHOSTTY_MODS_SUPER) }
        return m
    }
}
