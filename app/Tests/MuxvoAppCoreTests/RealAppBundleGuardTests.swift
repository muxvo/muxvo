// R2 bundle 守卫谓词红→绿（fix/r2-bundle-guard）：-sectcreate 嵌 plist 令旧谓词
// `bundleIdentifier != nil` 在 swift run 下误判放行 → UNUserNotificationCenter.current() 启动即崩
// （RED 取证 ~/Library/Caches/muxvo-build/logs/r2-bundle-guard-red.log）。守卫判据改「真 .app」。
//
// 覆盖：
//   · 纯判定两向 + 大小写（.app 恒真；swift run 构建产物目录 / .xctest 宿主恒假）
//   · 进程锚：swift test 语境 isCurrentProcessRealApp 必须 false（守卫恒跳系统横幅）
//   · 装配锚（装配断点防线）：OrchNotifier / SessionRestoreBanner **生产构造**守卫值 = 共用谓词
//     （单测 fake 直注全绿 ≠ 组合根接了线——此锚断真实生产构造路径）
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import Foundation
import Testing

@testable import MuxvoAppCore

@Suite("RealAppBundleGuard（R2 守卫谓词：真 .app 判据）")
struct RealAppBundleGuardTests {

    @Test(".app bundle 判真（双击/open/直拉 bundle 内二进制的正路）")
    func appBundleURLIsRealApp() {
        #expect(RealAppBundleGuard.isRealApp(
            bundleURL: URL(fileURLWithPath: "/Applications/Muxvo2.app", isDirectory: true)))
    }

    @Test("扩展名大小写不敏感（APFS 默认大小写不敏感，.APP 同判真）")
    func appExtensionCaseInsensitive() {
        #expect(RealAppBundleGuard.isRealApp(
            bundleURL: URL(fileURLWithPath: "/tmp/Probe.APP", isDirectory: true)))
    }

    @Test("swift run 构建产物目录判假——本批根因形态（嵌 plist 下 bundleIdentifier 非 nil 也不放行）")
    func buildProductsDirectoryIsNotRealApp() {
        // RED 取证的真实 bundleURL 形态：.../spm-scratch-m4b/debug/
        #expect(!RealAppBundleGuard.isRealApp(
            bundleURL: URL(fileURLWithPath: "/Users/x/Library/Caches/muxvo-build/spm-scratch-m4b/debug", isDirectory: true)))
    }

    @Test(".xctest 测试宿主判假（swift test 语境）")
    func xctestBundleIsNotRealApp() {
        #expect(!RealAppBundleGuard.isRealApp(
            bundleURL: URL(fileURLWithPath: "/x/MuxvoAppPackageTests.xctest", isDirectory: true)))
    }

    @Test("进程锚：swift test 非 .app 进程 → 当前谓词必须判假（守卫恒跳系统横幅、不碰 UN）")
    func currentProcessIsNotRealAppUnderSwiftTest() {
        #expect(!RealAppBundleGuard.isCurrentProcessRealApp)
    }

    @Test("装配锚：OrchNotifier 生产构造守卫值 = 共用谓词（防谓词漂移/装配断点）")
    @MainActor
    func orchNotifierProductionInitUsesSharedPredicate() {
        #expect(OrchNotifier().hasBundle == RealAppBundleGuard.isCurrentProcessRealApp)
    }

    @Test("装配锚：SessionRestoreBanner 生产构造守卫值 = 共用谓词（防谓词漂移/装配断点）")
    @MainActor
    func sessionRestoreBannerProductionInitUsesSharedPredicate() {
        #expect(SessionRestoreBanner().hasBundle == RealAppBundleGuard.isCurrentProcessRealApp)
    }
}
