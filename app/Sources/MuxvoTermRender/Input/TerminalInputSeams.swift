// TerminalInputSeams：输入链与「会话 / 宿主视图」之间的窄接缝（terminal-input.md §0）。
//
// 为什么是接缝而非直连 TerminalSession：
//   - 依赖方向 MuxvoTermRender → MuxvoTerm（渲染层依赖会话核心，反之不成立）。
//     TerminalSession 若要 conform 本模块定义的 protocol，需 MuxvoTerm 反向 import
//     MuxvoTermRender → 依赖环，编译不过。故「按键编码要摸活终端 modes」这件事只能
//     由一个会话侧 adapter 满足（见 TerminalKeyEncoding），checkpoint⑩ 挂接。
//   - TerminalSession 的 `queue`/`term` 均 private，本层拿不到 → 编码/模式查询必须
//     经会话 queue 串行化（与 feed 互斥），这正是 TerminalKeyEncoding.withTerminal 的契约。
//
// 三条接缝：
//   1. TerminalInputWriting —— 往 PTY 直写字节（= TerminalSession.write，公有 API，
//      本文件给 TerminalSession 补 retroactive conformance，仅用公有方法，合法）。
//   2. TerminalKeyEncoding —— 在「会话 queue 上、持活终端句柄」跑一段闭包并取回结果，
//      供 setopt_from_terminal 同步 modes 与 mode_get 查询（bracketed 2004 / focus 1004）。
//      本模块不给 TerminalSession 补此 conformance（拿不到私有 queue/term）；测试用隔离
//      实现，生产由会话侧 adapter 提供（报告「挂接说明」）。
//   3. TerminalInputHost —— 宿主视图回调（键入前回底+重置闪烁相位 / 焦点态转发）。
//      TerminalSurfaceView 已暴露 prepareForKeystroke()/setFocused(_:)，本文件补 conformance。
//   附：CursorRectProviding —— IME 候选窗定位所需的光标屏幕矩形（宿主视图后续实现）。
import AppKit
import MuxvoTerm

/// 往终端 PTY 直写已编码字节。= 键盘输入 / 粘贴 / 焦点 / IME 提交的唯一出口。
public protocol TerminalInputWriting: AnyObject {
    func writeInput(_ bytes: [UInt8])
}

/// TerminalSession 的公有 `write([UInt8])` 即 PTY 直写通道（terminal-input.md §0：人键入直达
/// PTY、零桥参与）。retroactive conformance，只用公有 API，不碰会话内部。
extension TerminalSession: TerminalInputWriting {
    public func writeInput(_ bytes: [UInt8]) { write(bytes) }
}

/// 会话侧编码接缝：TerminalSession.withTerminal（MuxvoTerm 公有 API，检查点⑩接线补齐）
/// 即「会话 queue 串行 + 活终端句柄」契约本身；nonisolated 方法见证 @MainActor 要求合法。
extension TerminalSession: TerminalKeyEncoding {}

/// 在会话 queue 上、持活 libghostty 终端句柄，同步跑 `body` 并取回结果。
///
/// - 契约：实现必须把 `body` 串行到会话自己的串行 queue 上执行（与 vt feed 互斥），
///   把该会话的原始终端句柄（`OpaquePointer`，等同 `GhosttyTerminal`）交给 `body`。
///   终端已释放则返回 nil。
/// - 用途：`ghostty_key_encoder_setopt_from_terminal`（每击同步 cursor-key/keypad/
///   modifyOtherKeys/kitty 等 modes）与 `ghostty_terminal_mode_get`（bracketed 2004 /
///   focus 1004 门控）都必须读活终端状态，故收敛到此。
/// - 挂接：生产由 MuxvoTerm 侧 adapter conform（拿会话私有 queue/term）；本层与测试
///   用隔离实现。@MainActor：本层输入事件都在 main 触发，实现内部用 `queue.sync` 即在
///   main 线程上、会话 queue 互斥下执行 body（线程一致、无需跨 actor 传递闭包）。
@MainActor
public protocol TerminalKeyEncoding: AnyObject {
    func withTerminal<R>(_ body: (OpaquePointer) -> R) -> R?
}

/// 宿主视图回调（TerminalSurfaceView 已具备）：键入前 prepare、焦点态转发。
@MainActor
public protocol TerminalInputHost: AnyObject {
    /// 键入前：①离底则先回底（§5）②重置光标闪烁相位（§4.3）。
    func prepareForKeystroke()
    /// 焦点变化：驱动光标 hollow / 闪烁 timer（§7 / §4.3）。
    func setFocused(_ focused: Bool)
}

/// TerminalSurfaceView 已暴露 prepareForKeystroke()/setFocused(_:)，直接 conform。
extension TerminalSurfaceView: TerminalInputHost {}

/// IME 候选窗定位：光标 cell 的屏幕矩形（terminal-input.md §2 firstRect）。
/// 宿主视图后续实现（cell 屏幕坐标换算）；测试用假实现。
@MainActor
public protocol CursorRectProviding: AnyObject {
    func cursorRectOnScreen() -> NSRect
}
