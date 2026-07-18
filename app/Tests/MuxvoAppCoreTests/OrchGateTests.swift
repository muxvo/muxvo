// 编排启用门（上线批 2026-07-16，OrchGate 头注）：
//   · OrchGate 纯函数：默认关，仅 env MUXVO_ORCH=1 开。
//   · AppMenuCommands(showOrchMenus: false)：「新建指挥台 ⌘⇧N」「任务中心 ⌘⇧T」两项不建、
//     键位失效；相邻项（新建终端/新建窗口/文件面板/聊天历史）不受牵连。
//   · 加性默认 true：既有构造零改动（e2e-harness/生产 gate on 形态菜单照旧）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
@testable import MuxvoAppCore

@Suite("编排启用门（OrchGate + 菜单入口门控）", .serialized)
@MainActor
struct OrchGateTests {

    private func cmdShiftKey(_ chars: String) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: [.command, .shift], timestamp: 0,
            windowNumber: 0, context: nil, characters: chars,
            charactersIgnoringModifiers: chars, isARepeat: false, keyCode: 0)!
    }

    @Test("OrchGate 纯函数：默认关，仅 MUXVO_ORCH=1 开")
    func gateDefaultsOff() {
        #expect(OrchGate.isEnabled(env: [:]) == false)
        #expect(OrchGate.isEnabled(env: ["MUXVO_ORCH": "1"]) == true)
        #expect(OrchGate.isEnabled(env: ["MUXVO_ORCH": "0"]) == false)
        #expect(OrchGate.isEnabled(env: ["MUXVO_ORCH": "true"]) == false)
    }

    @Test("gate off：文件菜单无「新建指挥台」、显示菜单无「任务中心」，相邻项健在")
    func gateOffHidesOrchMenuItems() {
        let commands = AppMenuCommands(onZoom: { _ in }, showOrchMenus: false)
        let menu = commands.buildMainMenu()

        guard let fileMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "文件" }),
              let viewMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "显示" })
        else {
            Issue.record("主菜单缺「文件」/「显示」子菜单"); return
        }
        #expect(!fileMenu.items.contains { $0.action == #selector(AppMenuCommands.newConsole(_:)) })
        #expect(!viewMenu.items.contains { $0.action == #selector(AppMenuCommands.toggleTaskCenter(_:)) })
        // 相邻项不受牵连（新建终端/新建窗口/文件面板/聊天历史）。
        #expect(fileMenu.items.contains { $0.action == #selector(AppMenuCommands.newTerminal(_:)) })
        #expect(fileMenu.items.contains { $0.action == #selector(AppMenuCommands.newWindow(_:)) })
        #expect(viewMenu.items.contains { $0.action == #selector(AppMenuCommands.toggleFilePanel(_:)) })
        #expect(viewMenu.items.contains { $0.action == #selector(AppMenuCommands.toggleChatHistory(_:)) })
    }

    @Test("gate off：⌘⇧T/⌘⇧N 键位失效，⌘⇧H（聊天历史）仍通")
    func gateOffKillsOrchKeyEquivalents() {
        _ = NSApplication.shared // performKeyEquivalent 经 NSApp.sendAction 投递
        var taskCenterToggled = 0
        var consoleOpened = 0
        var chatToggled = 0
        let commands = AppMenuCommands(
            onZoom: { _ in },
            onToggleTaskCenter: { taskCenterToggled += 1 },
            onToggleChatHistory: { chatToggled += 1 },
            onNewConsole: { consoleOpened += 1 },
            showOrchMenus: false)
        let menu = commands.buildMainMenu()

        #expect(menu.performKeyEquivalent(with: cmdShiftKey("t")) == false)
        #expect(taskCenterToggled == 0)
        // ⌘⇧N 只断言指挥台闭包不可达，不断言返回值：合成事件 characters 为小写 "n"，AppKit 会宽松
        // 匹配到「新建终端 ⌘N」消费掉（真机 Shift 产生大写 "N"，不会命中 ⌘N；此为合成事件保真度
        // 局限，非产品行为）。
        _ = menu.performKeyEquivalent(with: cmdShiftKey("n"))
        #expect(consoleOpened == 0)
        #expect(menu.performKeyEquivalent(with: cmdShiftKey("h")) == true)
        #expect(chatToggled == 1)
    }

    @Test("加性默认 true：不传 showOrchMenus 两编排项照建（既有构造零改动）")
    func defaultKeepsOrchMenuItems() {
        let commands = AppMenuCommands(onZoom: { _ in })
        let menu = commands.buildMainMenu()

        guard let fileMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "文件" }),
              let viewMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "显示" })
        else {
            Issue.record("主菜单缺「文件」/「显示」子菜单"); return
        }
        #expect(fileMenu.items.contains { $0.action == #selector(AppMenuCommands.newConsole(_:)) })
        #expect(viewMenu.items.contains { $0.action == #selector(AppMenuCommands.toggleTaskCenter(_:)) })
    }
}
