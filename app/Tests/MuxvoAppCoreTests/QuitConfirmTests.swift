// 退出确认待决态全链翻牌（DOGFOOD_M3_19，功能对等缺口 legacy AppCloseConfirmDialog）：
// Cmd+Q/红叉 → applicationShouldTerminate 唯一漏斗置 quitConfirm 待决态、return .terminateLater
// 且**不 beginShutdown**（红锚：现状直接 beginShutdown 无确认）→ web 弹整 app 版对话框 → 确认
// (confirmQuit) 才 beginShutdown 走既有优雅关停序 / 取消(cancelQuit) 清态存活。薄胶水态照 searchBar
// /panelMode 手法留在 TerminalService（AppDelegate 经其面置/清 + 注册 confirm/cancel 回调）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
@testable import MuxvoAppCore

@Suite("退出确认待决态与确认/取消漏斗（DOGFOOD_M3_19）", .serialized)
@MainActor
struct QuitConfirmTests {

    /// $TMPDIR 下隔离数据根（不碰真 dev 目录）；调用方 defer 清理。
    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-quit-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeService(root: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
    }

    @Test("requestQuitConfirm：置待决态 + 推 ui.state.quitConfirm(terminalCount) + 不触发确认回调（红锚：现状直 beginShutdown）")
    func requestSetsPendingAndPushesWithoutConfirm() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        var confirmed = 0, cancelled = 0

        let entered = service.requestQuitConfirm(
            onConfirmed: { confirmed += 1 }, onCancelled: { cancelled += 1 })

        #expect(entered)                                   // 已进入待决 → AppDelegate 应 return .terminateLater
        #expect(service.quitConfirmPending != nil)         // 待决态置位
        #expect(pushes.last?.quitConfirm != nil)           // ui.state 携带 quitConfirm（web 据此弹窗）
        #expect(pushes.last?.quitConfirm?.terminalCount == service.registry.count) // terminalCount 读 registry
        #expect(confirmed == 0 && cancelled == 0)          // **不 beginShutdown**（等 web 确认；红锚）
    }

    @Test("cancelQuit：onCancelled 恰一次 + 清待决态 + 重推 ui.state(quitConfirm 清)")
    func cancelClearsAndRepushes() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }
        var confirmed = 0, cancelled = 0
        _ = service.requestQuitConfirm(onConfirmed: { confirmed += 1 }, onCancelled: { cancelled += 1 })

        service.cancelQuit()

        #expect(cancelled == 1)                            // reply(false) 等价回调恰一次
        #expect(confirmed == 0)
        #expect(service.quitConfirmPending == nil)         // 态清
        #expect(pushes.last?.quitConfirm == nil)           // 重推去掉 quitConfirm（web 撤下弹窗）
    }

    @Test("confirmQuit：onConfirmed 恰一次（beginShutdown 触发）")
    func confirmInvokesConfirmedOnce() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var confirmed = 0, cancelled = 0
        _ = service.requestQuitConfirm(onConfirmed: { confirmed += 1 }, onCancelled: { cancelled += 1 })

        service.confirmQuit()

        #expect(confirmed == 1)
        #expect(cancelled == 0)
    }

    @Test("重复 requestQuitConfirm 幂等：对话框已开再收 quit → 保持首回调、confirm 仍恰一次（AppKit terminateLater 单 reply 铁律）")
    func repeatRequestIsIdempotent() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var confirmedFirst = 0, confirmedSecond = 0

        let e1 = service.requestQuitConfirm(onConfirmed: { confirmedFirst += 1 }, onCancelled: {})
        let e2 = service.requestQuitConfirm(onConfirmed: { confirmedSecond += 1 }, onCancelled: {})
        #expect(e1 && e2)                                  // 两次都返回 true（进入/保持待决）

        service.confirmQuit()
        #expect(confirmedFirst == 1)                       // 保留首回调
        #expect(confirmedSecond == 0)                      // 第二次请求不覆盖 → 绝不双 reply
    }

    @Test("无待决态：confirmQuit/cancelQuit 均 no-op（防重复 reply，不崩）")
    func actionsWithoutPendingAreNoop() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        service.confirmQuit()                              // 无待决 → 静默 no-op
        service.cancelQuit()
        #expect(service.quitConfirmPending == nil)
    }

    @Test("ui.action confirmQuit/cancelQuit 经 handleAction 路由到 confirm/cancel（与 web 同一路径）")
    func handleActionRoutesQuitActions() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var confirmed = 0, cancelled = 0

        _ = service.requestQuitConfirm(onConfirmed: { confirmed += 1 }, onCancelled: { cancelled += 1 })
        service.handleAction(.cancelQuit)
        #expect(cancelled == 1)
        #expect(service.quitConfirmPending == nil)

        _ = service.requestQuitConfirm(onConfirmed: { confirmed += 1 }, onCancelled: { cancelled += 1 })
        service.handleAction(.confirmQuit)
        #expect(confirmed == 1)
    }

    // MARK: - 启动失败白名单（Noop coordinator 直退，不等 web 确认）

    @Test("白名单：coordinator 为 Noop → 不走确认直退；就位（非 Noop + service 有）→ 拦截确认")
    func noopCoordinatorSkipsConfirm() {
        // Noop（启动失败路径 AppDelegate:100 NSApp.terminate）：web 未必加载，不能等确认 → 直退。
        #expect(AppDelegate.shouldDeferQuitForConfirm(
            coordinatorIsNoop: true, hasService: true, windowVisible: true) == false)
        // service 未就位（极早期）→ 直退。
        #expect(AppDelegate.shouldDeferQuitForConfirm(
            coordinatorIsNoop: false, hasService: false, windowVisible: true) == false)
        // 正常就位 + 窗口在场 → 拦截，置待决等确认（windowVisible 轴详测归 WindowCloseConfirmTests）。
        #expect(AppDelegate.shouldDeferQuitForConfirm(
            coordinatorIsNoop: false, hasService: true, windowVisible: true) == true)
    }
}
