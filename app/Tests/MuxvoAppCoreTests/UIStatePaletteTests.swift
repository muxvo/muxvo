// ui.state palette 随终端主题派生（terminal-theme.md §6，右上角批 B1）：
// mapSnapshot 的 Palette 必须从 config.terminal.themeName 经 TermTheme.named 取真值，
// 不得按 UI theme 二值硬编码——否则 monokai/dracula/solarized 的终端洞 web 回退底色
// 与 Metal 真实渲染色不符（暗色族互切「底色错拍」，dogfood 2026-07-13 反馈）。
// 案例池：terminal-theme.md §8.1 TT_palette_*（spec-coverage 强制 1:1）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
@testable import MuxvoAppCore
@testable import MuxvoTerm

@Suite("ui.state palette 随 terminal.themeName 派生（B1）", .serialized)
@MainActor
struct UIStatePaletteTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-palette-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// 建 service 前先落盘指定 themeName 的 config，republishState 后取第一帧 ui.state palette。
    private func paletteFor(themeName: String, theme: String) throws -> Palette {
        let root = makeTempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        var cfg = store.load()
        cfg.theme = theme
        cfg.terminal.themeName = themeName
        try store.save(cfg)
        let service = TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
        var captured: Palette?
        service.onState = { captured = $0.palette }
        service.republishState()
        return try #require(captured)
    }

    @Test("TT_palette_dark_frozen：dark 默认 palette 与旧硬编码逐字节同值（回归保护）")
    func darkPaletteUnchanged() throws {
        let p = try paletteFor(themeName: "dark", theme: "dark")
        #expect(p.background == "#1e1e1e")
        #expect(p.foreground == "#cccccc")
    }

    @Test("TT_palette_derived_monokai：palette 取 Theme.swift 真值（非 isDark 二值硬编码）")
    func monokaiPaletteDerived() throws {
        let p = try paletteFor(themeName: "monokai", theme: "dark")
        #expect(p.background == "#272822")
        #expect(p.foreground == "#f8f8f2")
    }

    @Test("TT_palette_light_fg：light 前景取 legacy #383a42（修旧硬编码 #1e1e1e 偏差）")
    func lightPaletteDerived() throws {
        let p = try paletteFor(themeName: "light", theme: "light")
        #expect(p.background == "#ffffff")
        #expect(p.foreground == "#383a42")
    }

    @Test("TT_palette_unknown_fallback：未知 themeName 回退 dark（对等 legacy resolveTerminalTheme 兜底）")
    func unknownThemeFallsBackDark() throws {
        let p = try paletteFor(themeName: "no-such-theme", theme: "dark")
        #expect(p.background == "#1e1e1e")
        #expect(p.foreground == "#cccccc")
    }
}
