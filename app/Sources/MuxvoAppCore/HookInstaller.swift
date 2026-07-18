// HookInstaller：CC hook 授权 + 安装 UX（wait-detector.md §7；裁决 A3/B 区附）。
//
// 方案 1 主路径（用户裁决 2026-07-02）：授权 → 备份 settings.json.muxvo-bak-<ts> → JSON merge
// 追加四 hook 组（HookSettingsMerge 纯函数）→ AtomicFile 原子写 → 幂等（按 command 含
// muxvo-hook.sh 识别）→ 停用移除全部 muxvo 组 → 启动自检 drift 提示。
//
// 机器级单绑定（§7，2026-07-16 裁决）：settings.json 全局唯一，muxvo hook 组只保一份、归「最后
// 显式启用」的分身。授权证据 = 组 command 指向**本根**脚本绝对路径（ownIdentifier）；他分身的组
// 不认领、不弹、只记日志——认领他人授权→点启用→改指自己根，即 2026-07-16 跨分身劫持事故链。
// 显式启用（设置面板/env）= 接管：通用子串清扫全部 muxvo 组后装本根组。
//
// **settings.json 路径可注入**（§7）：生产 = ~/.claude/settings.json；测试注入 $TMPDIR 假文件——
// 真文件严禁碰。启动路径写真文件的**唯一授权例外 = fresh 首启四条件门**（§7 首启自动启用，
// 2026-07-17 产品口径）：数据根 freshInstall ∧ notInstalled ∧ 无他分身绑定 ∧ 用户未曾主动停用，
// 四条件全真才静默装（真实单实例用户无感开箱即用）；任一不满足回既有路径——drift 重启用提示
// （仅曾授权用户，写入仍须点「启用」，对抗回修 MAJOR-1）、他分身绑定不认领不弹、opt-out 永不
// 自动重装。其余显式授权入口 = 设置面板 / env MUXVO_HOOK_PROMPT=1。脚本走生成式写出
// （HookScript 常量），因 MuxvoApp/Resources 在 Package.swift 被 exclude 且 Package.swift 冻结。
import AppKit
import Foundation
import MuxvoBridge
import MuxvoStorage
import MuxvoTerm

@MainActor
final class HookInstaller {
    enum DriftStatus: Equatable {
        case notInstalled                       // 无本根组 = 无本分身授权（他分身组/脚本孤儿均不算）
        case installed                          // 本根组四事件齐 + 脚本在位 + 指纹匹配
        case drift(reason: String)              // 本根组在但部分安装/脚本缺失/指纹不匹 → 提示重新启用
    }

    /// 授权对话框文案（B 区附草案；B1 修订后按 command 子串识别，故不再声称 `__muxvo` 标记键）。
    static let authorizationMessage = "启用终端等待检测"
    static let authorizationInformative = """
    Muxvo 需要向 CC 配置（~/.claude/settings.json）追加 4 条 hook（Notification / Stop / \
    UserPromptSubmit / SessionStart），命令指向 Muxvo 的中继脚本，用于检测终端何时在等你回复、\
    并在会话启动时记录恢复锚点。
    将先备份你的 settings.json，绝不修改你的既有条目，可随时一键停用。是否启用？
    """

    private let settingsURL: URL
    private let dataRoot: URL

    // MARK: opt-out / 轻提示接缝（§7；AppDelegate 接 config store，测试注内存 bool）

    /// 用户主动停用记档读取（true = 首启自动装配门永久关）。默认 false = 未接线时不拦。
    var readUserOptOut: () -> Bool = { false }
    /// 用户主动停用记档写入：requestDisable 置 true；任一次成功 install() 置回 false。
    var writeUserOptOut: (Bool) -> Void = { _ in }
    /// 一次性轻提示消费（查询即写回先例）：读 pending，true 则清位并返回 true。默认恒 false。
    var consumeAutoEnableNoticeFlag: () -> Bool = { false }

    /// 本根识别子串（§7 机器级单绑定，2026-07-16 裁决）：组 command 含**本分身脚本绝对路径**才算
    /// 本分身的授权证据。全路径含 `/hooks/muxvo-hook.sh` 后缀，免疫数据根名前缀撞车（`…Dev` vs
    /// `…Dev 2`）。通用子串 `HookScript.identifierSubstring` 仅用于接管/停用时清扫全部 muxvo 组，
    /// **绝不再作授权证据**——他分身的组被认领即是 2026-07-16 跨分身劫持事故的根。
    private var ownIdentifier: String { HookScript.scriptURL(dataRoot: dataRoot).path }

    /// 本根组已装事件集（授权证据的唯一口径）。
    private func ownInstalledEvents() -> Set<String> {
        HookSettingsMerge.installedEvents(settings: readSettings(), identifierSubstring: ownIdentifier)
    }

    /// - settingsURL：CC settings.json 路径（生产 ~/.claude/settings.json；测试 $TMPDIR 假文件）。
    /// - dataRoot：dev 数据根（脚本装 <root>/hooks/，socket 在 <root>/run/）。
    init(settingsURL: URL, dataRoot: URL) {
        self.settingsURL = settingsURL
        self.dataRoot = dataRoot
    }

    // MARK: 授权 + 安装

    /// 首跑授权对话框 → 「启用」则安装（幂等）。已安装且无 drift 则直接返回不打扰。
    func promptAndInstallIfNeeded() {
        if case .installed = selfCheck() { return }
        runInstallAlert(
            message: Self.authorizationMessage, informative: Self.authorizationInformative)
    }

    /// drift 重启用提示（wait-detector.md §7「drift 提示重新启用而非静默重写」；对抗回修 MAJOR-1）。
    /// 只对「曾授权」用户弹，且授权证据 = **本根组**（§7 单绑定：他分身的组不构成本分身授权，
    /// 见到只记日志不弹——认领他人授权即 2026-07-16 劫持事故根）。全新用户/仅他分身绑定在场均走
    /// 设置面板/env 显式启用，绝不自动打扰。写入仍须用户点「启用」，非静默重写。典型场景 =
    /// hook 组升级（如 2026-07-16 加装 SessionStart）后本分身老安装缺新事件。
    func promptReenableOnDriftIfAuthorized() {
        let status = selfCheck()
        let prior = ownInstalledEvents()
        var driftReason: String?
        if case let .drift(reason) = status { driftReason = reason }
        guard Self.shouldRepromptOnStartup(
            isDrift: driftReason != nil, hasPriorMuxvoGroups: !prior.isEmpty),
            let reason = driftReason
        else { return }
        runInstallAlert(
            message: "终端等待检测配置需要升级",
            informative: "检测到 hook 配置漂移：\(reason)。\n" + Self.authorizationInformative)
    }

    /// 启动重提示纯判定（可单测）：drift + 曾授权（已有**本根**组）才提示。新 selfCheck 下 drift
    /// 已蕴含本根组在场，此函数保留作显式护栏（两判据缺一不弹）。
    nonisolated static func shouldRepromptOnStartup(isDrift: Bool, hasPriorMuxvoGroups: Bool) -> Bool {
        isDrift && hasPriorMuxvoGroups
    }

    /// 首启自动启用纯判定（§7 四条件门，可单测）：数据根 freshInstall ∧ notInstalled ∧ 无他分身
    /// 绑定 ∧ 用户未曾主动停用，全真才装。foreignBound 挡（无论对方死活）= 单绑定不认领裁决零变化；
    /// 非 fresh 挡 = 用户手删 hook 组永不被静默重写。
    nonisolated static func shouldAutoInstallOnFirstLaunch(
        isFreshInstall: Bool, isNotInstalled: Bool, foreignBound: Bool, userOptedOut: Bool
    ) -> Bool {
        isFreshInstall && isNotInstalled && !foreignBound && !userOptedOut
    }

    /// 首启静默自动启用（§7 首启自动启用条款；启动路径写真文件的唯一授权例外）。
    /// 四条件门全真 → install()（此时机器无任何 muxvo 组，清扫即空扫，无接管语义）；装失败只记
    /// 日志静默降级（设置面板仍是手动兜底），绝不弹窗。返回是否实际完成安装（调用方据此置
    /// 一次性轻提示 pending）。
    @discardableResult
    func autoInstallIfEligible(isFreshInstall: Bool) -> Bool {
        var isNotInstalled = false
        if case .notInstalled = selfCheck() { isNotInstalled = true }
        guard Self.shouldAutoInstallOnFirstLaunch(
            isFreshInstall: isFreshInstall,
            isNotInstalled: isNotInstalled,
            foreignBound: foreignBindingPresent(),
            userOptedOut: readUserOptOut())
        else { return false }
        do {
            try install()
            NSLog("[muxvo] hook 首启自动启用（§7 四条件门）：\(HookScript.installedEvents.joined(separator: "/"))")
            return true
        } catch {
            NSLog("[muxvo] hook 首启自动启用失败（静默降级，设置面板可手动启用）：\(error)")
            return false
        }
    }

    /// 禁装门（wait-detector.md §7）：Info.plist 本键 = true → hook 面整体退出（不自检、不弹、
    /// env 门也不装）。短命测试分身（如更新测试 vA：数据根被重置脚本反复清空）参与装配只会认领
    /// 他分身的授权并陷入「中继脚本缺失」重启用死循环（2026-07-16 真机）。键缺席 = 照常装配。
    static let installDisabledKey = "MuxvoHookInstallDisabled"

    /// 禁装门纯判定（可单测）：严格布尔 true 才关门；缺席/false/非布尔一律照常。
    nonisolated static func installDisabled(plistValue: Any?) -> Bool {
        (plistValue as? Bool) == true
    }

    private func runInstallAlert(message: String, informative: String) {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = message
        alert.informativeText = informative
        alert.addButton(withTitle: "启用")
        alert.addButton(withTitle: "稍后手动")
        guard alert.runModal() == .alertFirstButtonReturn else {
            NSLog("[muxvo] hook 授权：用户选择稍后手动")
            return
        }
        do {
            try install()
            NSLog("[muxvo] hook 已安装（\(HookScript.installedEvents.joined(separator: "/"))）")
        } catch {
            presentError("启用等待检测失败", error)
        }
    }

    /// 安装：写脚本（0755）→ 备份 settings.json → merge enable → AtomicFile 原子写。
    /// 移除识别**保持通用子串** = 接管语义（§7 单绑定）：清扫全部 muxvo 组（含他分身旧绑定与陈组）
    /// 后 append 本根四组——仅显式路径（设置面板/env）可达，绝不自动触发。
    func install() throws {
        try writeScript()
        try backupSettingsIfPresent()
        let entries = HookScript.installedEvents.map { event in
            HookSettingsMerge.Entry(
                event: event,
                command: HookScript.command(scriptPath: HookScript.scriptURL(dataRoot: dataRoot).path, event: event),
                timeout: 5
            )
        }
        let merged = try HookSettingsMerge.merged(
            settings: readSettings(), action: .enable(entries),
            identifierSubstring: HookScript.identifierSubstring)
        try FileManager.default.createDirectory(
            at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try AtomicFile.write(merged, to: settingsURL, durability: .standard)
        // 任一次成功安装（面板启用/接管、drift 重启用、env 弹窗、首启自动装）清 opt-out 记档：
        // 用户显式重新启用 = 撤回此前的停用意愿（§7 opt-out 条款）。
        writeUserOptOut(false)
    }

    /// 停用：merge disable（通用子串移除全部 muxvo 组 = 关掉本机等待检测，顺带清陈尸组，§7 单绑定）
    /// → 备份 → 原子写。脚本文件保留（无害，下次启用复用）。
    func uninstall() throws {
        guard let data = readSettings() else { return } // 无 settings 无可停
        try backupSettingsIfPresent()
        let merged = try HookSettingsMerge.merged(
            settings: data, action: .disable, identifierSubstring: HookScript.identifierSubstring)
        try AtomicFile.write(merged, to: settingsURL, durability: .standard)
    }

    // MARK: 自检（§7 每次启动）

    /// 授权证据 = 本根组（§7 单绑定）：本根组空 → notInstalled，**先于脚本在位检查**——同时杜绝
    /// 「他分身组被误认成我的授权」与「组被清后脚本孤儿反复弹升级」两条事故路径。本根组在 →
    /// 脚本在位 + 四事件齐 + 指纹匹配，任一缺 → drift（提示重新启用，非静默重写）。
    func selfCheck() -> DriftStatus {
        let own = ownInstalledEvents()
        if own.isEmpty { return .notInstalled }

        let scriptURL = HookScript.scriptURL(dataRoot: dataRoot)
        if !FileManager.default.fileExists(atPath: scriptURL.path) {
            return .drift(reason: "中继脚本缺失（settings 有本分身 hook 但脚本不在位）")
        }
        let missing = Set(HookScript.installedEvents).subtracting(own)
        if !missing.isEmpty {
            return .drift(reason: "settings.json 缺 hook：\(missing.sorted().joined(separator: ", "))")
        }
        if !scriptFingerprintMatches(scriptURL) {
            return .drift(reason: "中继脚本指纹版本不匹配（需重新启用升级）")
        }
        return .installed
    }

    /// 他分身绑定在场（本根组空时的旁证，§7 单绑定）：通用子串命中非空而本根命中为空。
    /// 消费者 = 启动日志 + 设置面板 foreignBound 态；**绝不触发弹窗**。
    func foreignBindingPresent() -> Bool {
        guard ownInstalledEvents().isEmpty else { return false }
        return !HookSettingsMerge.installedEvents(
            settings: readSettings(), identifierSubstring: HookScript.identifierSubstring
        ).isEmpty
    }

    /// 启动只读自检日志（不写任何文件；真文件安全）。AppDelegate 启动调。
    func logStartupSelfCheck() {
        switch selfCheck() {
        case .installed: NSLog("[muxvo] hook 自检：已安装且指纹匹配")
        case .notInstalled:
            if foreignBindingPresent() {
                NSLog("[muxvo] hook 自检：绑定属于其他 Muxvo 分身（单绑定模型）——不认领、不弹；本分身启用走设置面板")
            } else {
                NSLog("[muxvo] hook 自检：未安装（等待检测 Layer 0 未启用）")
            }
        case let .drift(reason): NSLog("[muxvo] hook 自检 drift：\(reason)")
        }
    }

    // MARK: 私有

    private func writeScript() throws {
        let dir = HookScript.hooksDirectory(dataRoot: dataRoot)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = HookScript.scriptURL(dataRoot: dataRoot)
        // socket 路径由 dataRoot 派生注入（字面纪律：数据根字面只经运行时路径出现，不入源码）。
        let socketPath = HookScript.socketURL(dataRoot: dataRoot).path
        try AtomicFile.write(Data(HookScript.scriptText(socketPath: socketPath).utf8), to: url, durability: .standard)
        // 可执行位（hook 由 CC 直接 exec）。
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    }

    private func backupSettingsIfPresent() throws {
        guard FileManager.default.fileExists(atPath: settingsURL.path) else { return }
        let ts = Int(Date().timeIntervalSince1970)
        let backup = settingsURL.deletingLastPathComponent()
            .appendingPathComponent("\(settingsURL.lastPathComponent).muxvo-bak-\(ts)")
        // 已存在同秒备份则不覆盖（幂等，保首份）。
        guard !FileManager.default.fileExists(atPath: backup.path) else { return }
        try FileManager.default.copyItem(at: settingsURL, to: backup)
    }

    private func readSettings() -> Data? {
        try? Data(contentsOf: settingsURL)
    }

    private func scriptFingerprintMatches(_ url: URL) -> Bool {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return false }
        return text.contains("muxvo-hook-version: \(HookScript.version)")
    }

    private func presentError(_ title: String, _ error: any Error) {
        NSLog("[muxvo] \(title)：\(error)")
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = String(describing: error)
        alert.runModal()
    }
}

// MARK: - 设置面板接缝（HookPanelHandling；wait-detector.md §7 单绑定 + settings-modal.md 终端等待检测行）

extension HookInstaller: HookPanelHandling {
    /// 面板安装态映射：selfCheck 三态 + foreignBound 旁证（disabled 由装配缺席表达，不在此层）。
    func panelStatus() -> (state: HookInstallState, reason: String?) {
        switch selfCheck() {
        case .installed: return (.installed, nil)
        case let .drift(reason): return (.drift, reason)
        case .notInstalled:
            return foreignBindingPresent() ? (.foreignBound, nil) : (.notInstalled, nil)
        }
    }

    /// 显式启用/接管：sheet 授权确认（非阻塞——吸收「更新弹窗 runModal 冻结首帧」事故的 sheet 化
    /// 先例；§7 授权文案原文复用，drift/接管场景各前置一句语境）→ 确认则 install()（通用子串清扫
    /// = 接管）→ 返回终态。用户取消 = 当前态不变。
    func requestEnable() async throws -> (state: HookInstallState, reason: String?) {
        guard await confirmAuthorizationSheet() else {
            NSLog("[muxvo] hook 授权（设置面板）：用户选择稍后手动")
            return panelStatus()
        }
        try install()
        NSLog("[muxvo] hook 已经设置面板启用（\(HookScript.installedEvents.joined(separator: "/"))）")
        return panelStatus()
    }

    /// 显式停用（§7 opt-out 条款）：uninstall（通用子串清扫全部 muxvo 组，脚本保留）+ 记档
    /// opt-out = true（此后首启自动装配门永久关，重新启用只走显式路径）。**无确认 sheet**——
    /// 可逆（随时可再启用）+ 写前自动备份，产品选择记 spec 防审查当遗漏。
    func requestDisable() async throws -> (state: HookInstallState, reason: String?) {
        try uninstall()
        writeUserOptOut(true)
        NSLog("[muxvo] hook 已经设置面板停用（opt-out 记档，不再自动启用）")
        return panelStatus()
    }

    /// 一次性轻提示消费（§7 首启自动启用条款）：查询即写回，仅首个查询者拿到 true。
    func consumeAutoEnableNotice() -> Bool { consumeAutoEnableNoticeFlag() }

    private func confirmAuthorizationSheet() async -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = Self.authorizationMessage
        var informative = Self.authorizationInformative
        switch selfCheck() {
        case let .drift(reason):
            informative = "检测到 hook 配置漂移：\(reason)。\n" + informative
        case .notInstalled where foreignBindingPresent():
            informative = "检测到本机其他 Muxvo 实例的 hook 绑定，启用将替换为本实例（机器级单绑定）。\n"
                + informative
        default: break
        }
        alert.informativeText = informative
        alert.addButton(withTitle: "启用")
        alert.addButton(withTitle: "稍后手动")
        guard let window = NSApp.keyWindow ?? NSApp.mainWindow else {
            return alert.runModal() == .alertFirstButtonReturn // 无窗防御兜底（面板触发时必有窗）
        }
        return await withCheckedContinuation { continuation in
            alert.beginSheetModal(for: window) { response in
                continuation.resume(returning: response == .alertFirstButtonReturn)
            }
        }
    }
}
