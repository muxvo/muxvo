// TerminalService.resolveDefaultCwd 直测（M6 批1）：settings-modal.md 终端默认路径兜底逻辑。
// 空/仅空白/失效目录/非目录 → homePath；有效目录（含 ~ 展开）→ 该目录。非 spec（中文名）。
import Foundation
import Testing

@testable import MuxvoAppCore

@Suite("resolveDefaultCwd（默认终端路径兜底）")
struct DefaultCwdResolveTests {
    private let home = FileManager.default.temporaryDirectory.path

    @Test("空 / 仅空白 → homePath 兜底")
    func emptyFallsBack() {
        #expect(TerminalService.resolveDefaultCwd("", homePath: home) == home)
        #expect(TerminalService.resolveDefaultCwd("   ", homePath: home) == home)
    }

    @Test("有效目录 → 展开后返回该目录")
    func validDirectory() throws {
        let dir = home + "/muxvo-defcwd-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }
        #expect(TerminalService.resolveDefaultCwd(dir, homePath: home) == dir)
    }

    @Test("~ 展开：'~' → 用户主目录")
    func tildeExpands() {
        let expected = NSHomeDirectory()
        #expect(TerminalService.resolveDefaultCwd("~", homePath: home) == expected)
    }

    @Test("不存在目录 / 指向文件 → homePath 兜底（坏配置不至无法新建终端）")
    func invalidFallsBack() throws {
        #expect(TerminalService.resolveDefaultCwd(
            "/nonexistent/muxvo-\(UUID().uuidString)", homePath: home) == home)
        // 指向普通文件（非目录）→ 兜底
        let file = home + "/muxvo-defcwd-file-\(UUID().uuidString)"
        try Data("x".utf8).write(to: URL(fileURLWithPath: file))
        defer { try? FileManager.default.removeItem(atPath: file) }
        #expect(TerminalService.resolveDefaultCwd(file, homePath: home) == home)
    }
}

// settings-dogfood 批：pin 解析半（resolveDefaultCwd = resolveDefaultCwdPin ?? homePath 委托）。
// 语义差异点：pin 半「未设/失效 → nil（不 pin，保 .zshrc cd 习惯）」，落点半兜底 homePath。
@Suite("resolveDefaultCwdPin（默认路径抗漂移 pin 解析）")
struct DefaultCwdPinResolveTests {
    @Test("未设（空/仅空白）→ nil 不 pin")
    func unsetGivesNil() {
        #expect(TerminalService.resolveDefaultCwdPin("") == nil)
        #expect(TerminalService.resolveDefaultCwdPin("   ") == nil)
    }

    @Test("有效目录（含 ~ 展开）→ 展开值（与 resolveDefaultCwd 落点同源零漂移）")
    func validGivesExpanded() throws {
        let dir = FileManager.default.temporaryDirectory.path + "/muxvo-pinres-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }
        #expect(TerminalService.resolveDefaultCwdPin(dir) == dir)
        #expect(TerminalService.resolveDefaultCwdPin("~") == NSHomeDirectory())
        #expect(TerminalService.resolveDefaultCwd(dir, homePath: "/x") == dir) // 委托一致性
    }

    @Test("失效目录 / 指向文件 → nil（失效视同未设，不把 homePath pin 上去）")
    func invalidGivesNil() throws {
        #expect(TerminalService.resolveDefaultCwdPin("/nonexistent/muxvo-\(UUID().uuidString)") == nil)
        let file = FileManager.default.temporaryDirectory.path + "/muxvo-pinres-file-\(UUID().uuidString)"
        try Data("x".utf8).write(to: URL(fileURLWithPath: file))
        defer { try? FileManager.default.removeItem(atPath: file) }
        #expect(TerminalService.resolveDefaultCwdPin(file) == nil)
    }
}
