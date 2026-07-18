// M5 批3 聊天历史菜单入口（chat-history.md §7.6「入口=原生菜单+快捷键」，AppMenuCommands 先例）：
//   · 「显示」子菜单含「聊天历史」项，selector=toggleChatHistory，键位 Cmd+Shift+H（[.command,.shift]+"h"）。
//   · action 经注入的 onToggleChatHistory 闭包出去（生产 = AppDelegate 翻 panelMode(.chatHistory) + detach）。
//   · performKeyEquivalent 真匹配 Cmd+Shift+H → 触发闭包；与任务中心 Cmd+Shift+T 不撞键。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
@testable import MuxvoAppCore
@testable import MuxvoTerm

@Suite("聊天历史菜单入口（§7.6 入口=原生菜单+快捷键；CHAT_L1_18 native 半）", .serialized)
@MainActor
struct ChatHistoryMenuTests {

    private func cmdShiftKey(_ chars: String) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: [.command, .shift], timestamp: 0,
            windowNumber: 0, context: nil, characters: chars,
            charactersIgnoringModifiers: chars, isARepeat: false, keyCode: 0)!
    }

    @Test("「显示」子菜单含「聊天历史」项：selector + Cmd+Shift+H 键位就位、target 接通")
    func viewMenuHasChatHistoryItemWired() {
        var toggled = 0
        let commands = AppMenuCommands(onZoom: { _ in }, onToggleChatHistory: { toggled += 1 })
        let menu = commands.buildMainMenu()

        guard let viewMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "显示" }) else {
            Issue.record("主菜单缺「显示」子菜单"); return
        }
        guard let item = viewMenu.items.first(where: {
            $0.action == #selector(AppMenuCommands.toggleChatHistory(_:))
        }) else {
            Issue.record("「显示」菜单缺「聊天历史」项"); return
        }
        #expect(item.title == "聊天历史")
        #expect(item.keyEquivalent == "h")
        #expect(item.keyEquivalentModifierMask == [.command, .shift])
        #expect(item.target === commands)
    }

    @Test("与任务中心不撞键：聊天历史 Cmd+Shift+H、任务中心 Cmd+Shift+T 各自独立就位")
    func chatHistoryAndTaskCenterKeysDistinct() {
        let commands = AppMenuCommands(onZoom: { _ in }, onToggleTaskCenter: {}, onToggleChatHistory: {})
        let menu = commands.buildMainMenu()
        guard let viewMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "显示" }) else {
            Issue.record("主菜单缺「显示」子菜单"); return
        }
        let chatItem = viewMenu.items.first { $0.action == #selector(AppMenuCommands.toggleChatHistory(_:)) }
        let taskItem = viewMenu.items.first { $0.action == #selector(AppMenuCommands.toggleTaskCenter(_:)) }
        #expect(chatItem?.keyEquivalent == "h")
        #expect(taskItem?.keyEquivalent == "t")
        #expect(chatItem?.keyEquivalent != taskItem?.keyEquivalent)
    }

    @Test("既有构造零改动：AppMenuCommands(onZoom:) 单参仍可建（onToggleChatHistory 默认 no-op）")
    func legacyInitStillCompiles() {
        let commands = AppMenuCommands(onZoom: { _ in })
        let menu = commands.buildMainMenu()
        #expect(menu.items.compactMap { $0.submenu }.contains { $0.title == "显示" })
    }

    @Test("performKeyEquivalent 真匹配 Cmd+Shift+H → 触发 onToggleChatHistory")
    func keyEquivalentTriggersToggle() {
        _ = NSApplication.shared // performKeyEquivalent 经 NSApp.sendAction 投递
        var toggled = 0
        let commands = AppMenuCommands(onZoom: { _ in }, onToggleChatHistory: { toggled += 1 })
        let menu = commands.buildMainMenu()

        #expect(menu.performKeyEquivalent(with: cmdShiftKey("h")) == true)
        #expect(toggled == 1)
    }
}
