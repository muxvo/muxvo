// R2 bundle 守卫谓词（唯一权威，三 call-site 共用防漂移：AppDelegate UN delegate 装配 /
// OrchNotifier 生产构造 / SessionRestoreBanner 生产构造）：判「当前进程是否以真 .app 启动」。
//
// 为什么不能用 `Bundle.main.bundleIdentifier != nil`（2026-07-11 fix/r2-bundle-guard 根因）：
// Package.swift 给 MuxvoApp 挂 `-sectcreate __TEXT __info_plist` 把 Info.plist 嵌进可执行文件，
// `swift run`（= scripts/app.sh run）直跑裸可执行时 bundleIdentifier 也非 nil → 旧谓词误判放行 →
// `UNUserNotificationCenter.current()` 在无 bundle proxy 的进程里抛 NSInternalInconsistencyException
// （"bundleProxyForCurrentProcess is nil"）启动即崩（RED 取证 ~/Library/Caches/muxvo-build/logs/
// r2-bundle-guard-red.log）。真 .app 判据 = mainBundle.bundleURL 以 .app 结尾：.app 双击/open/直拉
// bundle 内二进制恒真；swift run 构建产物目录、swift test .xctest 宿主、e2e-harness 裸可执行恒假。
import Foundation

enum RealAppBundleGuard {
    /// 纯判定（单测覆盖两向 + 大小写）：bundleURL 扩展名为 .app（大小写不敏感，APFS 默认大小写不敏感）。
    static func isRealApp(bundleURL: URL) -> Bool {
        bundleURL.pathExtension.lowercased() == "app"
    }

    /// 装配壳：当前进程判定（`Bundle.main.bundleURL`——swift run 下指构建产物目录而非 .app，见头注）。
    static var isCurrentProcessRealApp: Bool {
        isRealApp(bundleURL: Bundle.main.bundleURL)
    }
}
