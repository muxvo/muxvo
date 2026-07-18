import Foundation

enum AppInfo {
    /// 显示名读自 -sectcreate 嵌入的 Info.plist（CFBundleName），兜底 "Muxvo"。
    /// 目录名字面量纪律：UI 文案一律走这里，不在 .swift 里写死数据目录同名字符串。
    static let displayName: String =
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? "Muxvo"

    /// 当前版本（CFBundleShortVersionString，app.sh 经 MUXVO_APP_VERSION 注入；auto-update.md §0）。
    static let shortVersion: String =
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
}
