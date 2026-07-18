// 「文件 → 新建终端 ⌘N」菜单全链翻牌（DOGFOOD_M3_20，2026-07-07 用户新增，legacy 无此菜单已核实）：
//   R1 菜单结构：主菜单加「文件」子菜单（App 后、编辑前），含「新建终端」keyEquivalent "n"(.command)，
//      target 接通到 onNewTerminal；performKeyEquivalent(Cmd+N) 触发。上限 20 时经 validateMenuItem
//      读 isNewTerminalEnabled 置灰（与 FAB disabled 语义对齐）。
//   R2 服务归一：TerminalService.createTerminalFromMenu 与 term.command create 完全同链
//      （projection.createTerminal(cwd:nil) + installUserWriteHook，照 applyZoom 两路归一先例）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
import MuxvoTerm
@testable import MuxvoAppCore

// MARK: - R1 文件菜单结构与键位

@Suite("文件菜单：新建终端 ⌘N（DOGFOOD_M3_20 R1）", .serialized)
@MainActor
struct FileMenuTests {

    private func cmdKey(_ chars: String, flags: NSEvent.ModifierFlags = [.command]) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0,
            windowNumber: 0, context: nil, characters: chars,
            charactersIgnoringModifiers: chars, isARepeat: false, keyCode: 0)!
    }

    private func fileMenu(_ menu: NSMenu) -> NSMenu? {
        menu.items.compactMap { $0.submenu }.first { $0.title == "文件" }
    }

    private func newTerminalItem(_ menu: NSMenu) -> NSMenuItem? {
        fileMenu(menu)?.items.first { $0.action == #selector(AppMenuCommands.newTerminal(_:)) }
    }

    @Test("主菜单含「文件」子菜单：新建终端 ⌘N（Cmd 修饰）、target 接通到实例、action=newTerminal")
    func fileMenuHasNewTerminalItem() {
        let commands = AppMenuCommands(onZoom: { _ in }, onNewTerminal: {})
        let menu = commands.buildMainMenu()

        guard let item = newTerminalItem(menu) else {
            Issue.record("「文件」菜单缺「新建终端」项"); return
        }
        #expect(item.title == "新建终端")
        #expect(item.keyEquivalent == "n")
        #expect(item.keyEquivalentModifierMask == [.command]) // 裸 Cmd+N
        #expect(item.target === commands)                      // action 接通到真 target
    }

    @Test("菜单顺序：文件在 App 之后、编辑之前；既有编辑/显示菜单不受扰")
    func fileMenuOrderAndOthersIntact() {
        let commands = AppMenuCommands(onZoom: { _ in }, onNewTerminal: {})
        let menu = commands.buildMainMenu()
        let titles = menu.items.compactMap { $0.submenu?.title }
        guard let fileIdx = titles.firstIndex(of: "文件"),
              let editIdx = titles.firstIndex(of: "编辑"),
              let viewIdx = titles.firstIndex(of: "显示") else {
            Issue.record("缺「文件」/「编辑」/「显示」菜单（titles=\(titles)）"); return
        }
        // App 菜单是首项（title 为空/AppInfo）→ 文件是第二个 submenu；文件 < 编辑 < 显示。
        #expect(fileIdx < editIdx)
        #expect(editIdx < viewIdx)
        // 既有菜单零改动冒烟：编辑仍含粘贴、显示仍含任务中心。
        let editMenu = menu.items.compactMap { $0.submenu }.first { $0.title == "编辑" }
        #expect(editMenu?.items.contains { $0.action == #selector(NSText.paste(_:)) } == true)
        let viewMenu = menu.items.compactMap { $0.submenu }.first { $0.title == "显示" }
        #expect(viewMenu?.items.contains { $0.title == "任务中心" } == true)
    }

    @Test("performKeyEquivalent Cmd+N → onNewTerminal 触发恰一次")
    func cmdNDispatchesNewTerminal() {
        _ = NSApplication.shared // performKeyEquivalent 经 NSApp.sendAction 投递 action
        var fired = 0
        let commands = AppMenuCommands(onZoom: { _ in }, onNewTerminal: { fired += 1 })
        let menu = commands.buildMainMenu()

        #expect(menu.performKeyEquivalent(with: cmdKey("n")) == true)
        #expect(fired == 1)
    }

    @Test("上限置灰：isNewTerminalEnabled=false → validateMenuItem(新建终端)=false；true → 恒可用")
    func newTerminalGreyedAtMax() {
        // 满员（registry.maxReached==true 映射）：菜单项置灰，用户无法触发（与 FAB disabled 对齐）。
        let disabled = AppMenuCommands(onZoom: { _ in }, onNewTerminal: {}, isNewTerminalEnabled: { false })
        guard let itemD = newTerminalItem(disabled.buildMainMenu()) else {
            Issue.record("缺新建终端项"); return
        }
        #expect(disabled.validateMenuItem(itemD) == false)

        // 未满员：恒可用。
        let enabled = AppMenuCommands(onZoom: { _ in }, onNewTerminal: {}, isNewTerminalEnabled: { true })
        guard let itemE = newTerminalItem(enabled.buildMainMenu()) else {
            Issue.record("缺新建终端项"); return
        }
        #expect(enabled.validateMenuItem(itemE) == true)
        // 非新建终端项经 validate 恒放行（不误伤其余项）。按 action 指名取 Quit 项——App 菜单
        // 首位已是「CC 用量预警」项（usage-limit-alert.md §6），按索引取会名不副实。
        let quitItem = enabled.buildMainMenu().items.first?.submenu?.items
            .first { $0.action == #selector(NSApplication.terminate(_:)) }
        #expect(quitItem.map { enabled.validateMenuItem($0) } ?? true)
    }
}

// MARK: - R2 TerminalService 归一（菜单入口与 term.command 同落 projection）

@Suite("TerminalService 菜单直建归一（DOGFOOD_M3_20 R2）", .serialized)
@MainActor
struct MenuCreateServiceTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-newterm-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeService(root: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
    }

    @Test("createTerminalFromMenu 建出终端（cwd 缺省链，落 projection，registry.count +1）")
    func menuCreateBuildsTerminal() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }

        let before = service.registry.count
        let outcome = service.createTerminalFromMenu()
        guard case .created = outcome else {
            Issue.record("菜单直建应 .created，实得 \(outcome)"); return
        }
        #expect(service.registry.count == before + 1)
    }

    @Test("归一：菜单路径与 term.command create 同经 projection.createTerminal（各建一终端，registry 累加）")
    func menuAndCommandPathsUnified() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }

        let before = service.registry.count
        // term.command 路径。
        guard case .created = service.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("term.command create 应 .created"); return
        }
        // 菜单路径（同一 projection.createTerminal(cwd:nil) + installUserWriteHook）。
        guard case .created = service.createTerminalFromMenu() else {
            Issue.record("菜单直建应 .created"); return
        }
        #expect(service.registry.count == before + 2) // 两路各建一，同落 registry
    }
}
