// 波3b 任务中心菜单入口翻牌（task-center-panel.md §1「入口=原生菜单+快捷键」，AppMenuCommands 先例）：
//   · 「显示」子菜单含「任务中心」项，selector=toggleTaskCenter，键位 Cmd+Shift+T（[.command,.shift]+"t"）。
//   · action 经注入的 onToggleTaskCenter 闭包出去（生产 = AppDelegate 翻 panelMode + detach；harness 自接）。
//   · performKeyEquivalent 真匹配 Cmd+Shift+T → 触发闭包。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
@testable import MuxvoAppCore
@testable import MuxvoTerm

@Suite("任务中心菜单入口（§1 入口=原生菜单+快捷键）", .serialized)
@MainActor
struct TaskCenterMenuTests {

    private func cmdShiftKey(_ chars: String) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: [.command, .shift], timestamp: 0,
            windowNumber: 0, context: nil, characters: chars,
            charactersIgnoringModifiers: chars, isARepeat: false, keyCode: 0)!
    }

    @Test("「显示」子菜单含「任务中心」项：selector + Cmd+Shift+T 键位就位、target 接通")
    func viewMenuHasTaskCenterItemWired() {
        var toggled = 0
        let commands = AppMenuCommands(onZoom: { _ in }, onToggleTaskCenter: { toggled += 1 })
        let menu = commands.buildMainMenu()

        guard let viewMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "显示" }) else {
            Issue.record("主菜单缺「显示」子菜单"); return
        }
        guard let item = viewMenu.items.first(where: {
            $0.action == #selector(AppMenuCommands.toggleTaskCenter(_:))
        }) else {
            Issue.record("「显示」菜单缺「任务中心」项"); return
        }
        #expect(item.title == "任务中心")
        #expect(item.keyEquivalent == "t")
        #expect(item.keyEquivalentModifierMask == [.command, .shift])
        #expect(item.target === commands)
    }

    @Test("既有构造零改动：AppMenuCommands(onZoom:) 单参仍可建（onToggleTaskCenter 默认 no-op）")
    func legacyInitStillCompiles() {
        let commands = AppMenuCommands(onZoom: { _ in })
        let menu = commands.buildMainMenu()
        #expect(menu.items.compactMap { $0.submenu }.contains { $0.title == "显示" })
    }

    @Test("performKeyEquivalent 真匹配 Cmd+Shift+T → 触发 onToggleTaskCenter")
    func keyEquivalentTriggersToggle() {
        _ = NSApplication.shared // performKeyEquivalent 经 NSApp.sendAction 投递
        var toggled = 0
        let commands = AppMenuCommands(onZoom: { _ in }, onToggleTaskCenter: { toggled += 1 })
        let menu = commands.buildMainMenu()

        #expect(menu.performKeyEquivalent(with: cmdShiftKey("t")) == true)
        #expect(toggled == 1)
    }
}
