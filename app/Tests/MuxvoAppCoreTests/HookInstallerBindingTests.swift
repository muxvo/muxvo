// HookInstaller 单绑定模型测试（wait-detector.md §7 机器级单绑定，2026-07-16 裁决）。
//
// 根修对象 = 跨分身授权混淆/绑定劫持（2026-07-16 真机事故）：授权证据须为「settings 组 command
// 指向本分身数据根的脚本绝对路径」，他分身的组不构成本分身的授权——不认领、不弹、不抢。
// 全部落盘走 withTempRoot（$TMPDIR 假 settings + 假数据根），真 ~/.claude/settings.json 严禁碰。
import Foundation
import MuxvoStorage
import MuxvoTerm
import MuxvoTestSupport
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("HookInstaller 单绑定模型（§7 跨分身劫持根修）", .serialized)
struct HookInstallerBindingTests {

    /// 常用双分身布景：同一 settings.json，foreign 分身完成过授权安装（4 组 + 脚本落自己根）。
    private func makeInstallers(_ root: URL) -> (own: HookInstaller, foreign: HookInstaller, settings: URL) {
        let settings = root.appendingPathComponent("claude-settings.json")
        let own = HookInstaller(
            settingsURL: settings, dataRoot: root.appendingPathComponent("Own Dev", isDirectory: true))
        let foreign = HookInstaller(
            settingsURL: settings, dataRoot: root.appendingPathComponent("Foreign Dev", isDirectory: true))
        return (own, foreign, settings)
    }

    @Test("WD_binding_foreign_not_claimed：他分身装的 4 组不构成本分身授权——selfCheck=notInstalled，启动不弹")
    func foreignGroupsNotClaimed() throws {
        try withTempRoot { root in
            let (own, foreign, _) = makeInstallers(root)
            try foreign.install() // 他分身完成授权安装

            // 事故链第一环：他分身组在场 + 本根无脚本 → 现状误判 drift「脚本缺失」→ 启动弹重启用。
            // 单绑定模型下必须是 notInstalled（他分身组 ≠ 我的授权）。
            #expect(own.selfCheck() == .notInstalled)
        }
    }

    @Test("WD_binding_own_drift_priority：本根 3 事件老安装（缺 SessionStart）在他分身组同场时仍报 drift——升级路径保全")
    func ownDriftDetectedDespiteForeignGroups() throws {
        try withTempRoot { root in
            let (own, _, settings) = makeInstallers(root)
            try own.install() // 先完整装（落脚本+组），再手工降回 3 事件老形态
            let ownScript = HookScript.scriptURL(
                dataRoot: root.appendingPathComponent("Own Dev", isDirectory: true)).path
            let foreignScript = HookScript.scriptURL(
                dataRoot: root.appendingPathComponent("Foreign Dev", isDirectory: true)).path
            let threeEvents = ["Notification", "Stop", "UserPromptSubmit"].map { event in
                HookSettingsMerge.Entry(
                    event: event,
                    command: HookScript.command(scriptPath: ownScript, event: event), timeout: 5)
            }
            // 以本根路径为识别子串先清本根 4 组再装 3 事件老形态（.enable 的清扫按事件分组，
            // 直接 enable 3 事件不会赶走旧 SessionStart 组）；再以 foreign 路径为子串 append
            // 他分身 4 组（不经 install()，其通用子串清扫会赶走对方——此处要的正是共存布景）。
            var data = try HookSettingsMerge.merged(
                settings: try Data(contentsOf: settings), action: .disable,
                identifierSubstring: ownScript)
            data = try HookSettingsMerge.merged(
                settings: data, action: .enable(threeEvents), identifierSubstring: ownScript)
            let foreignEntries = HookScript.installedEvents.map { event in
                HookSettingsMerge.Entry(
                    event: event,
                    command: HookScript.command(scriptPath: foreignScript, event: event), timeout: 5)
            }
            data = try HookSettingsMerge.merged(
                settings: data, action: .enable(foreignEntries), identifierSubstring: foreignScript)
            try data.write(to: settings)

            // 老 3-hook 安装必须仍报 drift 缺 SessionStart（a762787 批的主人升级激活路径防回归）——
            // 不得因他分身组凑齐 4 事件而误判 installed。
            guard case let .drift(reason) = own.selfCheck() else {
                Issue.record("期望 drift（缺 SessionStart），实得 \(own.selfCheck())")
                return
            }
            #expect(reason.contains("SessionStart"))
        }
    }

    @Test("WD_binding_script_orphan_silent：settings 无任何组 + 本根脚本孤儿在位 → notInstalled（杀重弹死循环）")
    func orphanScriptWithoutGroupsIsNotInstalled() throws {
        try withTempRoot { root in
            let (own, _, settings) = makeInstallers(root)
            try own.install()
            try Data("{}".utf8).write(to: settings) // 组被外力清空（如被他分身接管/settings 重置），脚本文件残留

            // 授权证据 = 本根组；脚本孤儿不构成证据 → notInstalled，不再每启动弹「配置需要升级」。
            #expect(own.selfCheck() == .notInstalled)
        }
    }

    @Test("WD_binding_takeover：显式启用 = 接管——他分身组清除、本根 4 组落位、用户既有条目零动")
    func explicitInstallTakesOverForeignBinding() throws {
        try withTempRoot { root in
            let (own, foreign, settings) = makeInstallers(root)
            // 用户自有 Stop hook 先在场。
            let userSettings = """
            {"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo user-own-hook"}]}]}}
            """
            try Data(userSettings.utf8).write(to: settings)
            try foreign.install()
            try own.install() // 显式启用（面板/env 才会走到）= 接管

            let data = try Data(contentsOf: settings)
            let ownScript = HookScript.scriptURL(
                dataRoot: root.appendingPathComponent("Own Dev", isDirectory: true)).path
            let foreignScript = HookScript.scriptURL(
                dataRoot: root.appendingPathComponent("Foreign Dev", isDirectory: true)).path
            #expect(HookSettingsMerge.installedEvents(settings: data, identifierSubstring: ownScript)
                == Set(HookScript.installedEvents))
            #expect(HookSettingsMerge.installedEvents(settings: data, identifierSubstring: foreignScript)
                .isEmpty, "接管后他分身组不得残留（单绑定）")
            #expect(String(decoding: data, as: UTF8.self).contains("echo user-own-hook"),
                    "用户既有条目零动")
            #expect(own.selfCheck() == .installed)
        }
    }

    @Test("WD_binding_panel_status：面板态映射——净态 notInstalled / 他分身 foreignBound / 本根全齐 installed / 本根缺事件 drift")
    func panelStatusMapping() throws {
        try withTempRoot { root in
            let (own, foreign, settings) = makeInstallers(root)
            // 净态（无任何组）。
            #expect(own.panelStatus() == (.notInstalled, nil))
            // 他分身绑定在场 → foreignBound（不认领，可显式接管）。
            try foreign.install()
            #expect(own.panelStatus() == (.foreignBound, nil))
            // 本分身显式启用（接管）→ installed。
            try own.install()
            #expect(own.panelStatus() == (.installed, nil))
            // 本根降回 3 事件老形态 → drift 且 reason 带缺失事件。
            let ownScript = HookScript.scriptURL(
                dataRoot: root.appendingPathComponent("Own Dev", isDirectory: true)).path
            let threeEvents = ["Notification", "Stop", "UserPromptSubmit"].map { event in
                HookSettingsMerge.Entry(
                    event: event,
                    command: HookScript.command(scriptPath: ownScript, event: event), timeout: 5)
            }
            var data = try HookSettingsMerge.merged(
                settings: try Data(contentsOf: settings), action: .disable,
                identifierSubstring: ownScript)
            data = try HookSettingsMerge.merged(
                settings: data, action: .enable(threeEvents), identifierSubstring: ownScript)
            try data.write(to: settings)
            let panel = own.panelStatus()
            #expect(panel.state == .drift)
            #expect(panel.reason?.contains("SessionStart") == true)
        }
    }
}
