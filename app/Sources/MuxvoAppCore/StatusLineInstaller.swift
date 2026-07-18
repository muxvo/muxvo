// StatusLineInstaller：CC 用量传感器授权 + 安装 UX（usage-limit-alert.md §3；镜像 HookInstaller 骨架）。
//
// 独立类不扩展 HookInstaller（其语义按 wait-detector.md 冻结；指纹版本/授权文案/自检判据均不同）。
// 主路径：授权 → 备份 settings.json.muxvo-bak-<ts> → StatusLineSettingsMerge 纯函数 merge →
// AtomicFile 原子写 → 幂等（按 statusLine.command 含 muxvo-statusline.sh 识别）→ 停用只删 muxvo 键
// → 启动自检 drift 提示。**外来 statusLine 永不覆盖**（§3 foreign 态）。
//
// **settings.json 路径可注入**：生产 = ~/.claude/settings.json；测试注入 $TMPDIR 假文件——真文件
// 严禁碰。本类不在启动路径自动写真文件：启动只跑只读自检日志；实际授权写入由菜单
// 「启用 CC 用量预警…」或 env MUXVO_STATUSLINE_PROMPT=1 显式触发。
import AppKit
import Foundation
import MuxvoStorage

@MainActor
final class StatusLineInstaller {
    enum Status: Equatable {
        case notInstalled                 // settings 无 statusLine 键（脚本残留与否不论，残留无害）
        case installed                    // muxvo statusLine + 脚本在位 + 指纹匹配
        case foreign                      // 已有外来 statusLine（永不覆盖，提示后放弃）
        case drift(reason: String)        // muxvo statusLine 但脚本缺失/指纹不匹配 → 提示重新启用
    }

    /// 授权对话框文案（§3）。
    static let authorizationMessage = "启用 CC 用量预警"
    static let authorizationInformative = """
    Muxvo 需要向 CC 配置（~/.claude/settings.json）写入 statusLine 传感器（指向 Muxvo 的静默脚本，\
    终端不显示任何文字），用于读取当前账号的用量百分比；达到 90% 时提前提醒你换号，避免所有终端\
    同时被限额停摆。将先备份你的 settings.json，绝不修改你的既有条目，可随时一键停用。是否启用？
    """
    static let foreignNotice = "检测到你已配置自定义 statusLine，Muxvo 不会覆盖它。如需启用用量预警，请先移除既有 statusLine 配置。"

    private let settingsURL: URL
    private let dataRoot: URL

    /// - settingsURL：CC settings.json 路径（生产 ~/.claude/settings.json；测试 $TMPDIR 假文件）。
    /// - dataRoot：dev 数据根（脚本装 <root>/hooks/，产出文件在 <root>/run/）。
    init(settingsURL: URL, dataRoot: URL) {
        self.settingsURL = settingsURL
        self.dataRoot = dataRoot
    }

    // MARK: 菜单入口（§6）

    /// 菜单项标题按状态切换（validateMenuItem 每次弹开菜单时重算）。
    func menuTitle() -> String {
        if case .installed = selfCheck() { return "停用 CC 用量预警" }
        return "启用 CC 用量预警…"
    }

    /// 菜单 action：installed → 确认后停用；foreign → 提示不覆盖；其余（未装/drift）→ 授权安装。
    func handleMenuAction() {
        switch selfCheck() {
        case .installed:
            let alert = NSAlert()
            alert.alertStyle = .informational
            alert.messageText = "停用 CC 用量预警？"
            alert.informativeText = "将从 ~/.claude/settings.json 移除 Muxvo 的 statusLine 传感器（先备份）。传感器脚本文件保留，下次启用复用。"
            alert.addButton(withTitle: "停用")
            alert.addButton(withTitle: "取消")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            do {
                try uninstall()
                NSLog("[muxvo] 用量预警已停用（statusLine 键已移除）")
            } catch {
                presentError("停用用量预警失败", error)
            }
        case .foreign:
            presentForeignNotice()
        case .notInstalled, .drift:
            promptAndInstallIfNeeded()
        }
    }

    // MARK: 授权 + 安装

    /// 授权对话框 → 「启用」则安装（幂等）。已安装且无 drift 直接返回；foreign 提示后放弃（永不覆盖）。
    func promptAndInstallIfNeeded() {
        switch selfCheck() {
        case .installed: return
        case .foreign: presentForeignNotice(); return
        case .notInstalled, .drift: break
        }
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = Self.authorizationMessage
        alert.informativeText = Self.authorizationInformative
        alert.addButton(withTitle: "启用")
        alert.addButton(withTitle: "稍后手动")
        guard alert.runModal() == .alertFirstButtonReturn else {
            NSLog("[muxvo] 用量预警授权：用户选择稍后手动")
            return
        }
        do {
            try install()
            NSLog("[muxvo] 用量预警已启用（statusLine 传感器已安装）")
        } catch {
            presentError("启用用量预警失败", error)
        }
    }

    /// 安装：写脚本（0755）→ 备份 settings.json → merge enable → AtomicFile 原子写。
    func install() throws {
        try writeScript()
        try backupSettingsIfPresent()
        let scriptPath = StatusLineScript.scriptURL(dataRoot: dataRoot).path
        let merged = try StatusLineSettingsMerge.merged(
            settings: readSettings(),
            action: .enable(command: StatusLineScript.command(scriptPath: scriptPath)),
            identifierSubstring: StatusLineScript.identifierSubstring)
        try FileManager.default.createDirectory(
            at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try AtomicFile.write(merged, to: settingsURL, durability: .standard)
    }

    /// 停用：merge disable（只删 muxvo 键）→ 备份 → 原子写。脚本文件保留（无害，下次启用复用）。
    func uninstall() throws {
        guard let data = readSettings() else { return } // 无 settings 无可停
        try backupSettingsIfPresent()
        let merged = try StatusLineSettingsMerge.merged(
            settings: data, action: .disable,
            identifierSubstring: StatusLineScript.identifierSubstring)
        try AtomicFile.write(merged, to: settingsURL, durability: .standard)
    }

    // MARK: 自检（§3 四态）

    func selfCheck() -> Status {
        let presence = StatusLineSettingsMerge.inspect(
            settings: readSettings(), identifierSubstring: StatusLineScript.identifierSubstring)
        switch presence {
        case .foreign: return .foreign
        case .absent: return .notInstalled
        case .muxvo:
            let scriptURL = StatusLineScript.scriptURL(dataRoot: dataRoot)
            guard FileManager.default.fileExists(atPath: scriptURL.path) else {
                return .drift(reason: "传感器脚本缺失（settings 有 statusLine 但脚本不在位）")
            }
            guard scriptFingerprintMatches(scriptURL) else {
                return .drift(reason: "传感器脚本指纹版本不匹配（需重新启用升级）")
            }
            return .installed
        }
    }

    /// 启动只读自检日志（不写任何文件；真文件安全）。AppDelegate 启动调。
    func logStartupSelfCheck() {
        switch selfCheck() {
        case .installed: NSLog("[muxvo] 用量预警自检：statusLine 传感器已安装且指纹匹配")
        case .notInstalled: NSLog("[muxvo] 用量预警自检：未安装（菜单「启用 CC 用量预警…」可启用）")
        case .foreign: NSLog("[muxvo] 用量预警自检：存在外来 statusLine（Muxvo 不覆盖）")
        case let .drift(reason): NSLog("[muxvo] 用量预警自检 drift：\(reason)")
        }
    }

    // MARK: 私有

    private func writeScript() throws {
        let dir = StatusLineScript.scriptURL(dataRoot: dataRoot).deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = StatusLineScript.scriptURL(dataRoot: dataRoot)
        // 产出文件路径由 dataRoot 派生注入（字面纪律：数据根字面只经运行时路径出现，不入源码）。
        let usageStatusPath = StatusLineScript.usageStatusURL(dataRoot: dataRoot).path
        try AtomicFile.write(
            Data(StatusLineScript.scriptText(usageStatusPath: usageStatusPath).utf8),
            to: url, durability: .standard)
        // 可执行位（statusline 由 CC 直接 exec）。
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
        return text.contains("muxvo-statusline-version: \(StatusLineScript.version)")
    }

    private func presentForeignNotice() {
        NSLog("[muxvo] 用量预警：存在外来 statusLine，不覆盖")
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "无法启用 CC 用量预警"
        alert.informativeText = Self.foreignNotice
        alert.runModal()
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
