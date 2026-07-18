// MuxvoTerm：会话核心。批 1② 落地 PTYHost / TerminalSession / EnvContract；
// RenderCoordinator / SessionRegistry 属批 2。
// 依赖 MuxvoKit + MuxvoTermCore + CGhosttyVT + CMuxvoPTY。
import CGhosttyVT
import MuxvoKit
import MuxvoTermCore

public enum MuxvoTermSmoke {
    /// 链接冒烟：真实调用 vendor libghostty-vt.a 的 terminal_new/free，确保静态库
    /// 在最终链接产物里被真的链上。批 3 清理占位调用点后可移除。
    public static func vtLinkSmoke() -> Bool {
        var terminal: OpaquePointer?
        let opts = GhosttyTerminalOptions(cols: 80, rows: 24, max_scrollback: 0)
        let rc = ghostty_terminal_new(nil, &terminal, opts)
        guard rc == GHOSTTY_SUCCESS, let terminal else { return false }
        ghostty_terminal_free(terminal)
        return true
    }

    /// Core 层版本透传（验证依赖方向 MuxvoTerm → MuxvoTermCore 通）。
    public static var coreVersion: String { MuxvoTermCoreInfo.version }
}
