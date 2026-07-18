// WorkerHookInstaller：HookInstaller 泛化——向**任意 worker 隔离 configDir** 装全套 hook（interactive-worker.md
// §2 feas M-3 + 冻结面登记 12）。
//
// 与 `HookInstaller`（面向用户 `~/.claude/settings.json` 的遥测三 hook 授权 UX）的分野：本类面向**交互式 worker
// 的隔离 `CLAUDE_CONFIG_DIR`**（SEC-02 干净作用域，绝不继承用户宽松 allow），生成式写**全套** settings——
// 遥测三 hook（Notification/Stop/UserPromptSubmit，行为不变量不动）**+ 新增 PreToolUse/PostToolUse 审批 hook**
// （事件不重叠、无冲突）。二组各自识别子串（`muxvo-hook.sh` / `muxvo-approval-hook.sh`）幂等合并、互不干扰。
//
// **known-good digest（裁决1 SEC-B2 廉价缓解①）**：写入即记 settings 内容摘要，供 `HookIntegrityMonitor` 周期
// 重哈希核对（失配 → worker 篡改/删除审批 hook → `task_interrupted(hook_tamper:*)` 收尸）。app 无沙箱下同 UID
// worker 可写隔离 configDir/settings.json（执法基座弱于 headless argv flag，可接受残余）——本类只做探测基座，
// 不假装沙箱。
import CryptoKit
import Foundation
import MuxvoStorage
import MuxvoTerm

/// worker settings 的 known-good 摘要（SEC-B2 完整性核对锚）。
public struct WorkerHookDigest: Sendable, Equatable {
    /// SHA256(hex) of the exact settings.json bytes app 写入时的内容。
    public let settingsDigest: String
    public init(settingsDigest: String) { self.settingsDigest = settingsDigest }
}

public enum WorkerHookInstaller {
    /// PreToolUse 审批 hook 的 CC per-hook `timeout`（秒）：必 > 脚本内 nc 有界窗口
    /// （`ApprovalHookScript.requestTimeoutSeconds`），否则 CC 会在脚本 emit_ask 前杀之 → fail-OPEN 放行。
    public static let preToolUseTimeoutSeconds = ApprovalHookScript.requestTimeoutSeconds + 60
    /// PostToolUse（fire-and-forget，后台 nc 秒退）+ 遥测三 hook 的 timeout（同 HookInstaller 既有 5s）。
    public static let quickTimeoutSeconds = 5

    /// worker 隔离 config 的 settings.json 路径 `<configDir>/settings.json`。
    public static func workerSettingsURL(configDir: URL) -> URL {
        configDir.appendingPathComponent("settings.json")
    }

    /// 向 worker `configDir` 装全套 hook（遥测三 + 审批二），返回 known-good digest。
    /// - configDir：worker 隔离 `CLAUDE_CONFIG_DIR`（settings 落其内 `settings.json`）。
    /// - dataRoot：dev 数据根（两脚本装 `<root>/hooks/`，socket 在 `<root>/run/`；脚本共享、per-worker 隔离经
    ///   configDir settings + `MUXVO_TERM_ID` env 达成）。
    @discardableResult
    public static func installWorkerHooks(configDir: URL, dataRoot: URL) throws -> WorkerHookDigest {
        try writeScripts(dataRoot: dataRoot)

        let telemetryScriptPath = HookScript.scriptURL(dataRoot: dataRoot).path
        let approvalScriptPath = ApprovalHookScript.scriptURL(dataRoot: dataRoot).path

        // 遥测三 hook（不变量不动）。
        let telemetryEntries = HookScript.installedEvents.map { event in
            HookSettingsMerge.Entry(
                event: event,
                command: HookScript.command(scriptPath: telemetryScriptPath, event: event),
                timeout: quickTimeoutSeconds)
        }
        // 审批二 hook：PreToolUse 双向（长 timeout 覆盖 nc 窗口）+ PostToolUse fire-and-forget（短 timeout）。
        let approvalEntries = ApprovalHookScript.installedEvents.map { event in
            HookSettingsMerge.Entry(
                event: event,
                command: ApprovalHookScript.command(scriptPath: approvalScriptPath, event: event),
                timeout: event == "PreToolUse" ? preToolUseTimeoutSeconds : quickTimeoutSeconds)
        }

        let settingsURL = workerSettingsURL(configDir: configDir)
        let existing = try? Data(contentsOf: settingsURL)
        // 两次幂等 merge（各自识别子串互不干扰）：先遥测组，再审批组。
        let step1 = try HookSettingsMerge.merged(
            settings: existing, action: .enable(telemetryEntries),
            identifierSubstring: HookScript.identifierSubstring)
        let merged = try HookSettingsMerge.merged(
            settings: step1, action: .enable(approvalEntries),
            identifierSubstring: ApprovalHookScript.identifierSubstring)

        try FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        try AtomicFile.write(merged, to: settingsURL, durability: .standard)
        return WorkerHookDigest(settingsDigest: Self.digest(of: merged))
    }

    /// 完整性核对：重哈希当前 `<configDir>/settings.json` 与 known-good 对比。
    /// 文件缺失/读失败 → 视作失配（worker 删除 settings 亦是篡改）。
    public static func verify(configDir: URL, expected: WorkerHookDigest) -> Bool {
        guard let data = try? Data(contentsOf: workerSettingsURL(configDir: configDir)) else { return false }
        return digest(of: data) == expected.settingsDigest
    }

    // MARK: - 私有

    /// 写两脚本到 `<dataRoot>/hooks/`（0755；socket 路径由 dataRoot 派生注入，字面纪律：不入源码）。
    /// 幂等覆盖（内容随 app 版本化，指纹注释在脚本内）。
    private static func writeScripts(dataRoot: URL) throws {
        let dir = HookScript.hooksDirectory(dataRoot: dataRoot)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let telemetrySocket = HookScript.socketURL(dataRoot: dataRoot).path
        let telemetryURL = HookScript.scriptURL(dataRoot: dataRoot)
        try AtomicFile.write(Data(HookScript.scriptText(socketPath: telemetrySocket).utf8),
                             to: telemetryURL, durability: .standard)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: telemetryURL.path)

        let approvalSocket = ApprovalHookScript.socketURL(dataRoot: dataRoot).path
        let approvalURL = ApprovalHookScript.scriptURL(dataRoot: dataRoot)
        try AtomicFile.write(Data(ApprovalHookScript.scriptText(socketPath: approvalSocket).utf8),
                             to: approvalURL, durability: .standard)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: approvalURL.path)
    }

    private static func digest(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
