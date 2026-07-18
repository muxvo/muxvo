// StatusLineInstaller 直测（usage-limit-alert.md §3 / §8 UL_install_selfcheck_states）。
//
// $TMPDIR 假 settings + 假数据根（TempRoot 纪律：绝不碰真 ~/.claude/settings.json）。只测非弹窗
// 路径（install/uninstall/selfCheck/menuTitle）；prompt/handleMenuAction 的 NSAlert 人机路径归
// 真机冒烟（e2e 验证步骤③）。
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("StatusLineInstaller 安装/停用/四态自检（usage-limit-alert.md §3）")
struct StatusLineInstallerTests {
    private func make(_ root: URL) -> StatusLineInstaller {
        StatusLineInstaller(
            settingsURL: root.appendingPathComponent("claude-home/settings.json"),
            dataRoot: root.appendingPathComponent("dataroot", isDirectory: true))
    }

    private func settingsJSON(_ root: URL) -> [String: Any] {
        let url = root.appendingPathComponent("claude-home/settings.json")
        guard let data = try? Data(contentsOf: url) else { return [:] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    // MARK: UL_install_selfcheck_states

    @Test("UL_install_selfcheck_states: 初始 notInstalled → install → installed（脚本 0755 + settings 键 + 既有键保留 + 备份）")
    func installThenInstalled() throws {
        try withTempRoot { root in
            // 预置既有 settings（验备份 + 保键）。
            let settingsURL = root.appendingPathComponent("claude-home/settings.json")
            try FileManager.default.createDirectory(
                at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(#"{"model":"opus"}"#.utf8).write(to: settingsURL)

            let installer = make(root)
            #expect(installer.selfCheck() == .notInstalled)
            #expect(installer.menuTitle() == "启用 CC 用量预警…")

            try installer.install()
            #expect(installer.selfCheck() == .installed)
            #expect(installer.menuTitle() == "停用 CC 用量预警")

            let r = settingsJSON(root)
            let cmd = (r["statusLine"] as? [String: Any])?["command"] as? String
            #expect(cmd?.contains("muxvo-statusline.sh") == true)
            #expect(cmd?.hasPrefix("\"") == true) // 引号裹路径（dataRoot 含空格防线）
            #expect(r["model"] as? String == "opus") // 既有键原样

            // 脚本 0755 且含指纹行。
            let dataRoot = root.appendingPathComponent("dataroot", isDirectory: true)
            let scriptURL = StatusLineScript.scriptURL(dataRoot: dataRoot)
            let attrs = try FileManager.default.attributesOfItem(atPath: scriptURL.path)
            #expect((attrs[.posixPermissions] as? NSNumber)?.int16Value == 0o755)
            let text = try String(contentsOf: scriptURL, encoding: .utf8)
            #expect(text.contains("muxvo-statusline-version: \(StatusLineScript.version)"))

            // 备份存在（settings.json.muxvo-bak-<ts>）。
            let backups = try FileManager.default
                .contentsOfDirectory(atPath: settingsURL.deletingLastPathComponent().path)
                .filter { $0.hasPrefix("settings.json.muxvo-bak-") }
            #expect(!backups.isEmpty)
        }
    }

    @Test("UL_install_selfcheck_states: 删脚本 → drift；改指纹 → drift")
    func driftStates() throws {
        try withTempRoot { root in
            let installer = make(root)
            try installer.install()
            let dataRoot = root.appendingPathComponent("dataroot", isDirectory: true)
            let scriptURL = StatusLineScript.scriptURL(dataRoot: dataRoot)

            // 删脚本 → drift。
            try FileManager.default.removeItem(at: scriptURL)
            guard case .drift = installer.selfCheck() else {
                Issue.record("删脚本后应为 drift，实为 \(installer.selfCheck())")
                return
            }

            // 改指纹（重写为旧版本号）→ drift。
            try "#!/bin/bash\n# muxvo-statusline-version: 0\n".write(
                to: scriptURL, atomically: true, encoding: .utf8)
            guard case .drift = installer.selfCheck() else {
                Issue.record("指纹不匹配应为 drift，实为 \(installer.selfCheck())")
                return
            }
        }
    }

    @Test("UL_install_selfcheck_states: foreign 场 → selfCheck=foreign、install 抛错且 settings 原样")
    func foreignRefusedByInstall() throws {
        try withTempRoot { root in
            let settingsURL = root.appendingPathComponent("claude-home/settings.json")
            try FileManager.default.createDirectory(
                at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let foreign = #"{"statusLine":{"type":"command","command":"~/mine.sh"}}"#
            try Data(foreign.utf8).write(to: settingsURL)

            let installer = make(root)
            #expect(installer.selfCheck() == .foreign)
            #expect(throws: (any Error).self) { try installer.install() }
            // settings 原样（拒绝覆盖）。
            let cmd = (settingsJSON(root)["statusLine"] as? [String: Any])?["command"] as? String
            #expect(cmd == "~/mine.sh")
        }
    }

    @Test("UL_install_selfcheck_states: uninstall → statusLine 键消失、其余键原样、回 notInstalled")
    func uninstallRemovesKey() throws {
        try withTempRoot { root in
            let settingsURL = root.appendingPathComponent("claude-home/settings.json")
            try FileManager.default.createDirectory(
                at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(#"{"model":"opus"}"#.utf8).write(to: settingsURL)

            let installer = make(root)
            try installer.install()
            #expect(installer.selfCheck() == .installed)

            try installer.uninstall()
            let r = settingsJSON(root)
            #expect(r["statusLine"] == nil)
            #expect(r["model"] as? String == "opus")
            #expect(installer.selfCheck() == .notInstalled) // 脚本残留不影响（残留无害）
        }
    }
}
