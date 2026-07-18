// WorkerHookInstaller 直测（interactive-worker.md §2 feas M-3；B2-5 HookInstaller 泛化）。
//
// 被测面：向 worker 隔离 configDir 装全套 hook（遥测四 + 审批二，各自识别子串互不干扰）、known-good digest
// 记录 + verify 核对（篡改即失配）、幂等（二次装同摘要）、SEC-02 隔离（PreToolUse 审批 hook 在位，危险工具
// 必经策略引擎，非继承用户宽松 allow）。
import Foundation
import MuxvoStorage
import MuxvoTerm
import MuxvoTestSupport
import Testing

@testable import MuxvoAppCore

@Suite("WorkerHookInstaller 泛化装 hook + digest（B2-5）", .serialized)
struct WorkerHookInstallerTests {

    @Test("IW_settings_isolated_pretooluse：装全套 hook——审批 PreToolUse/PostToolUse + 遥测四 hook，PreToolUse 指向审批脚本")
    func installsFullHookSet() throws {
        try withTempRoot { root in
            let configDir = root.appendingPathComponent("worker-config", isDirectory: true)
            let dataRoot = root.appendingPathComponent("dataroot", isDirectory: true)
            _ = try WorkerHookInstaller.installWorkerHooks(configDir: configDir, dataRoot: dataRoot)

            let settingsURL = WorkerHookInstaller.workerSettingsURL(configDir: configDir)
            let data = try Data(contentsOf: settingsURL)
            // 审批组识别子串命中 PreToolUse + PostToolUse。
            let approvalEvents = HookSettingsMerge.installedEvents(
                settings: data, identifierSubstring: ApprovalHookScript.identifierSubstring)
            #expect(approvalEvents == Set(["PreToolUse", "PostToolUse"]))
            // 遥测组识别子串命中四 hook（含 SessionStart 锚点采集事件，与审批组共存）。
            let telemetryEvents = HookSettingsMerge.installedEvents(
                settings: data, identifierSubstring: HookScript.identifierSubstring)
            #expect(telemetryEvents == Set(["Notification", "Stop", "UserPromptSubmit", "SessionStart"]))
            // SEC-02 隔离：clean scope 无宽松 permissions.allow（不继承用户 profile）。
            let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            #expect(obj?["permissions"] == nil)
            // 两脚本落 <dataRoot>/hooks/ 且可执行。
            let approvalScript = ApprovalHookScript.scriptURL(dataRoot: dataRoot)
            let telemetryScript = HookScript.scriptURL(dataRoot: dataRoot)
            #expect(FileManager.default.isExecutableFile(atPath: approvalScript.path))
            #expect(FileManager.default.isExecutableFile(atPath: telemetryScript.path))
            // PreToolUse command 指向审批脚本（危险工具经此 hook 到策略引擎）。
            #expect(String(decoding: data, as: UTF8.self).contains(ApprovalHookScript.scriptFileName))
        }
    }

    @Test("known-good digest：装后 verify true；篡改 settings.json 后 verify false")
    func digestVerifyDetectsTamper() throws {
        try withTempRoot { root in
            let configDir = root.appendingPathComponent("wc", isDirectory: true)
            let dataRoot = root.appendingPathComponent("dr", isDirectory: true)
            let digest = try WorkerHookInstaller.installWorkerHooks(configDir: configDir, dataRoot: dataRoot)
            #expect(WorkerHookInstaller.verify(configDir: configDir, expected: digest))
            // worker 改写 settings.json 删审批 hook（旁路）→ 失配。
            try Data("{}".utf8).write(to: WorkerHookInstaller.workerSettingsURL(configDir: configDir))
            #expect(!WorkerHookInstaller.verify(configDir: configDir, expected: digest))
        }
    }

    @Test("verify 对文件缺失亦视失配（worker 删 settings 即篡改）")
    func missingSettingsIsMismatch() throws {
        try withTempRoot { root in
            let configDir = root.appendingPathComponent("wc", isDirectory: true)
            let dataRoot = root.appendingPathComponent("dr", isDirectory: true)
            let digest = try WorkerHookInstaller.installWorkerHooks(configDir: configDir, dataRoot: dataRoot)
            try FileManager.default.removeItem(at: WorkerHookInstaller.workerSettingsURL(configDir: configDir))
            #expect(!WorkerHookInstaller.verify(configDir: configDir, expected: digest))
        }
    }

    @Test("幂等：二次装同一 configDir → 同 digest（settings 确定性 prettyPrinted+sortedKeys）")
    func idempotentSameDigest() throws {
        try withTempRoot { root in
            let configDir = root.appendingPathComponent("wc", isDirectory: true)
            let dataRoot = root.appendingPathComponent("dr", isDirectory: true)
            let d1 = try WorkerHookInstaller.installWorkerHooks(configDir: configDir, dataRoot: dataRoot)
            let d2 = try WorkerHookInstaller.installWorkerHooks(configDir: configDir, dataRoot: dataRoot)
            #expect(d1 == d2)
            #expect(WorkerHookInstaller.verify(configDir: configDir, expected: d2))
        }
    }
}

/// HookInstaller 启动 drift 重启用判定（wait-detector.md §7「drift 提示重新启用」；对抗回修 MAJOR-1）。
/// 纯判定：drift + 曾授权（已有 muxvo hook 组）才提示——全新用户（无组）与健康安装（无 drift）均不打扰。
@Suite("HookInstaller drift 重启用判定（§7 对抗回修 MAJOR-1）")
struct HookInstallerRepromptDecisionTests {
    @Test("drift+曾授权 → 提示；全新用户/健康安装/无 drift 均不提示")
    func repromptOnlyWhenDriftWithPriorAuth() {
        #expect(HookInstaller.shouldRepromptOnStartup(isDrift: true, hasPriorMuxvoGroups: true))
        #expect(!HookInstaller.shouldRepromptOnStartup(isDrift: true, hasPriorMuxvoGroups: false),
                "全新用户不自动打扰（走 env/菜单显式授权）")
        #expect(!HookInstaller.shouldRepromptOnStartup(isDrift: false, hasPriorMuxvoGroups: true))
        #expect(!HookInstaller.shouldRepromptOnStartup(isDrift: false, hasPriorMuxvoGroups: false))
    }

    @Test("WD_hooks_disabled_gate：Info.plist 禁装键布尔 true 才关门；缺席/false/字符串照常装配")
    func installDisabledGateStrictBool() {
        #expect(HookInstaller.installDisabled(plistValue: true))
        #expect(!HookInstaller.installDisabled(plistValue: nil), "键缺席 = 现状不变（生产/dogfood 分身）")
        #expect(!HookInstaller.installDisabled(plistValue: false))
        #expect(!HookInstaller.installDisabled(plistValue: "true"), "字符串不认——防 plist 手滑写成字符串")
    }
}
