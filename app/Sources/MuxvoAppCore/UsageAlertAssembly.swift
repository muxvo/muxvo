// UsageAlertAssembly：CC 用量预警装配缝（usage-limit-alert.md §6）。
//
// 组合根（AppDelegate）逐字调 make——装配级测试的被测面（M4b 教训：单测注入 fake 掩盖组合根
// 断点，装配缝 + 真文件红绿锚为解）。watcher 由 make 内 start（常开，文件缺失 no-op）。
import Foundation

enum UsageAlertAssembly {
    /// - Parameters:
    ///   - settingsURL: CC settings.json（生产 ~/.claude/settings.json；测试 $TMPDIR 假文件）。
    ///   - dataRoot: dev 数据根（脚本 <root>/hooks/、产出 <root>/run/usage-status.json 均由此派生）。
    ///   - now: epoch ms 时钟（测试注入假时钟）。
    ///   - makeTimer: 定时器工厂（生产 RealDockBadge.makeTimer；测试替身手动 tick）。
    ///   - notify: 预警出口（生产 = OrchNotifier.limitApproaching 横幅 + app 内弹窗，§5）。
    @MainActor
    static func make(
        settingsURL: URL,
        dataRoot: URL,
        now: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
        makeTimer: @escaping (TimeInterval, @escaping @MainActor () -> Void) -> DockBadgeTimer,
        notify: @escaping (UsageAlert) -> Void
    ) -> (installer: StatusLineInstaller, watcher: UsageLimitWatcher) {
        let installer = StatusLineInstaller(settingsURL: settingsURL, dataRoot: dataRoot)
        let watcher = UsageLimitWatcher(
            usageStatusURL: StatusLineScript.usageStatusURL(dataRoot: dataRoot),
            now: now, makeTimer: makeTimer, notify: notify)
        watcher.start()
        return (installer, watcher)
    }
}

/// 当前全局登录账号信息只读取数（usage-limit-alert.md §5 email 标注 best-effort）。
/// 失败一律 nil 静默（预警照发，只是不带账号名）。
enum ClaudeAccountInfo {
    /// `~/.claude.json` 顶层 `oauthAccount.emailAddress`（只报字段，绝不触碰 token 值）。
    static func email(claudeJSONURL: URL) -> String? {
        guard let data = try? Data(contentsOf: claudeJSONURL),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let account = root["oauthAccount"] as? [String: Any] else { return nil }
        return account["emailAddress"] as? String
    }
}
