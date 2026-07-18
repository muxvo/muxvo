// hook 首启静默自动启用 + opt-out 测试（wait-detector.md §7 首启自动启用/opt-out 条款，
// 2026-07-17 产品口径：真实单实例用户无感开箱即用）。
//
// 四条件门 = fresh ∧ notInstalled ∧ 无他分身绑定 ∧ 未曾主动停用；任一不满足绝不写。
// 全部落盘走 withTempRoot（$TMPDIR 假 settings + 假数据根），真 ~/.claude/settings.json 严禁碰；
// opt-out/轻提示经闭包缝注内存 bool（生产 = AppDelegate 接 config store）。
import Foundation
import MuxvoStorage
import MuxvoTerm
import MuxvoTestSupport
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("HookInstaller 首启自动启用（§7 四条件门 + opt-out）", .serialized)
struct HookAutoInstallTests {

    /// 双分身布景（HookInstallerBindingTests 同款）+ own 侧内存 opt-out 缝。
    private func makeInstallers(_ root: URL) -> (
        own: HookInstaller, foreign: HookInstaller, settings: URL, optOut: () -> Bool
    ) {
        let settings = root.appendingPathComponent("claude-settings.json")
        let own = HookInstaller(
            settingsURL: settings, dataRoot: root.appendingPathComponent("Own Dev", isDirectory: true))
        let foreign = HookInstaller(
            settingsURL: settings, dataRoot: root.appendingPathComponent("Foreign Dev", isDirectory: true))
        let box = OptOutBox()
        own.readUserOptOut = { box.value }
        own.writeUserOptOut = { box.value = $0 }
        return (own, foreign, settings, { box.value })
    }

    /// 内存 opt-out 位（生产 = config.json hookUserDisabled）。
    private final class OptOutBox { var value = false }

    @Test("WD_autoinstall_fresh_clean_machine：fresh + 干净机器 → 静默装成，本根 4 组落位 installed")
    func freshCleanMachineAutoInstalls() throws {
        try withTempRoot { root in
            let (own, _, settings, _) = makeInstallers(root)
            #expect(own.autoInstallIfEligible(isFreshInstall: true))
            #expect(own.selfCheck() == .installed)
            let ownScript = HookScript.scriptURL(
                dataRoot: root.appendingPathComponent("Own Dev", isDirectory: true)).path
            let data = try Data(contentsOf: settings)
            #expect(HookSettingsMerge.installedEvents(settings: data, identifierSubstring: ownScript)
                == Set(HookScript.installedEvents))
        }
    }

    @Test("WD_autoinstall_foreign_present_skip：他分身绑定在场 → 不装不认领，settings 字节零动（单绑定裁决零变化）")
    func foreignBindingPresentSkips() throws {
        try withTempRoot { root in
            let (own, foreign, settings, _) = makeInstallers(root)
            try foreign.install()
            let before = try Data(contentsOf: settings)
            #expect(!own.autoInstallIfEligible(isFreshInstall: true))
            let after = try Data(contentsOf: settings)
            #expect(after == before, "他分身绑定在场自动装必须零写入")
            #expect(own.selfCheck() == .notInstalled)
        }
    }

    @Test("WD_autoinstall_optout_skip：用户曾主动停用（opt-out 记档）→ fresh 也不装")
    func userOptOutSkips() throws {
        try withTempRoot { root in
            let (own, _, settings, _) = makeInstallers(root)
            own.readUserOptOut = { true }
            #expect(!own.autoInstallIfEligible(isFreshInstall: true))
            #expect(!FileManager.default.fileExists(atPath: settings.path), "opt-out 下不得创建 settings")
        }
    }

    @Test("WD_autoinstall_not_fresh_skip：非 fresh 启动（含用户手删 hook 组后的常规重启）→ 永不静默重写")
    func notFreshSkips() throws {
        try withTempRoot { root in
            let (own, _, settings, _) = makeInstallers(root)
            #expect(!own.autoInstallIfEligible(isFreshInstall: false))
            #expect(!FileManager.default.fileExists(atPath: settings.path))
        }
    }

    @Test("WD_disable_records_optout：requestDisable → 组全清 + opt-out=true + 终态 notInstalled（脚本保留）")
    func disableRecordsOptOut() async throws {
        try await withTempRootOnMain { root in
            let (own, _, settings, optOut) = makeInstallers(root)
            try own.install()
            let status = try await own.requestDisable()
            #expect(status.state == .notInstalled)
            #expect(optOut(), "停用必须记档 opt-out")
            let data = try Data(contentsOf: settings)
            #expect(HookSettingsMerge.installedEvents(
                settings: data, identifierSubstring: HookScript.identifierSubstring
            ).isEmpty, "停用后不得残留任何 muxvo 组")
            let script = HookScript.scriptURL(
                dataRoot: root.appendingPathComponent("Own Dev", isDirectory: true))
            #expect(FileManager.default.fileExists(atPath: script.path), "脚本保留（下次启用复用）")
        }
    }

    @Test("WD_enable_clears_optout：任一次成功 install()（显式重新启用）→ opt-out 记档清回 false")
    func enableClearsOptOut() throws {
        try withTempRoot { root in
            let (own, _, _, optOut) = makeInstallers(root)
            var memory = true
            own.readUserOptOut = { memory }
            own.writeUserOptOut = { memory = $0 }
            try own.install() // 显式路径（面板/env）不经四条件门，直接可达
            #expect(!memory, "install() 成功须清 opt-out（显式启用 = 撤回停用意愿）")
            _ = optOut // 布景默认缝已被本用例覆写，仅消 unused 警告
        }
    }

    @Test("WD_notice_consume_once：轻提示查询即写回——首查 true，再查 false（AppDelegate 闭包契约同款）")
    func noticeConsumeOnce() throws {
        try withTempRoot { root in
            let (own, _, _, _) = makeInstallers(root)
            var pending = true
            own.consumeAutoEnableNoticeFlag = {
                guard pending else { return false }
                pending = false
                return true
            }
            #expect(own.consumeAutoEnableNotice())
            #expect(!own.consumeAutoEnableNotice(), "轻提示必须一次性")
        }
    }
}
