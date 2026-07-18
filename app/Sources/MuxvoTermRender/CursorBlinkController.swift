// 光标闪烁相位状态机（terminal-rendering.md §4.3）。
//
// 纯逻辑（无 Timer / 无 GPU / 无 AppKit）：视图侧 ~500ms Timer 每 tick 调 advancePhase()，
// 测试用「假时钟」= 直接调 advancePhase()/resetPhase() 断言相位与门控。规格要点：
//   - 仅 focused 且 BLINKING==true 时相位翻转（timerShouldRun 据此启停视图 Timer）；
//   - 键入即重置相位（点亮）——resetPhase()，供输入链批 3③ 经视图 API 调；
//   - 失焦画 hollow block（mode(...) 返回 .hollow）。
import Foundation

/// 光标绘制模式（§4.3）。视图据此决定 cursor 批：实心样式 / 空心边框 / 不画。
enum CursorRenderMode: Equatable {
    case solid    // 按快照 style 画实心（block/bar/underline）
    case hollow   // 空心块（失焦，或快照 style==blockHollow）
    case hidden   // 不画（不可见 / 不在视口 / 闪烁灭相位）
}

/// 光标闪烁相位状态机。单线程（主线程）使用；视图持有一个实例。
final class CursorBlinkController {
    /// 相位周期（§4.3 ~500ms）。视图据此设 Timer 间隔。
    static let period: TimeInterval = 0.5

    private(set) var focused: Bool = false
    /// 最新快照的 BLINKING 位（DECSCUSR 天然生效）。
    private(set) var blinking: Bool = false
    /// 当前相位：true=显示（实心相位），false=隐藏相位。
    private(set) var phaseOn: Bool = true

    init() {}

    /// 视图 Timer 是否应运行——仅 focused 且 blinking 才有相位翻转。视图据此启停 Timer。
    var timerShouldRun: Bool { focused && blinking }

    /// 相位翻转（Timer tick 调）。仅 focused+blinking 生效；返回是否需要重画。
    @discardableResult
    func advancePhase() -> Bool {
        guard focused, blinking else { return false }
        phaseOn.toggle()
        return true
    }

    /// 键入重置相位（点亮）——保证键入瞬间光标为实心（§4.3）。返回是否需要重画。
    @discardableResult
    func resetPhase() -> Bool {
        let changed = !phaseOn
        phaseOn = true
        return changed
    }

    /// 焦点变化。失焦时相位复位（下次聚焦从实心相位起，且失焦本就画 hollow 不看相位）。
    /// 返回 timerShouldRun 是否变化——视图据此启停 Timer。
    @discardableResult
    func setFocused(_ f: Bool) -> Bool {
        guard focused != f else { return false }
        let before = timerShouldRun
        focused = f
        if !f { phaseOn = true }
        return timerShouldRun != before
    }

    /// 应用最新快照的 blinking 位。变化时相位复位（避免残留灭相位）。
    /// 返回 timerShouldRun 是否变化——视图据此启停 Timer。
    @discardableResult
    func setBlinking(_ b: Bool) -> Bool {
        guard blinking != b else { return false }
        let before = timerShouldRun
        blinking = b
        phaseOn = true
        return timerShouldRun != before
    }

    /// 结合快照的可见/在视口，判定本帧绘制模式（§4.3）。
    func mode(visible: Bool, inViewport: Bool, styleHollow: Bool) -> CursorRenderMode {
        guard visible, inViewport else { return .hidden }
        if !focused { return .hollow }         // 失焦：空心块
        if styleHollow { return .hollow }       // 快照 style==blockHollow：空心
        if blinking, !phaseOn { return .hidden } // 闪烁灭相位
        return .solid
    }
}
