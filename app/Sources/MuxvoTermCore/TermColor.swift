// 终端色值（RGB，无 alpha）——对齐 vt `GhosttyColorRgb`（color.h：uint8 r/g/b）。
//
// 说明：§2 快照的 cell 色是 RGBA（含 alpha），归批 2② 的 MuxvoTerm 领地；本类型只服务
// 「主题默认色 → vt terminal option」这条装配链（terminal-rendering.md §4.2），vt 的
// 默认色 option 收 `GhosttyColorRgb*`（无 alpha），故此处刻意用 RGB 三通道、逐字对齐 C 结构。
import Foundation

/// 终端 RGB 色值。字节序与 `GhosttyColorRgb` 一致，批 3 建会话时可零成本转 C 结构。
public struct TermColorRGB: Equatable, Hashable, Sendable {
    public var r: UInt8
    public var g: UInt8
    public var b: UInt8

    public init(r: UInt8, g: UInt8, b: UInt8) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// 从 `0xRRGGBB` 构造（legacy xterm.js 主题以此形态书写十六进制）。
    public init(hex: UInt32) {
        self.r = UInt8((hex >> 16) & 0xFF)
        self.g = UInt8((hex >> 8) & 0xFF)
        self.b = UInt8(hex & 0xFF)
    }

    /// CSS 十六进制形态 `#rrggbb`（小写）——ui.state palette 等 web 消费面用。
    public var cssHex: String {
        String(format: "#%02x%02x%02x", r, g, b)
    }
}
