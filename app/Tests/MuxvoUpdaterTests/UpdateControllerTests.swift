// UpdateController 状态机用例（specs/behavior/auto-update.md §1-§6 / §12 UPD_* 池）。
// 文案断言一律字面量硬编码（禁 import UpdateCopy 比常量——防互抄回路，§12 UPD_dialog_copy_*）。

import Foundation
import Testing
@testable import MuxvoUpdater

@Suite("自动更新控制器（auto-update.md §1-§5）")
@MainActor
struct UpdateControllerCheckTests {

    @Test("UPD_check_on_launch: start() 启动即查一次（引擎 check 恰 1 次 + checking 推送）")
    func checkOnLaunch() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.upToDate]
        harness.controller.start()
        await settle()
        #expect(harness.engine.checkCalls == 1)
        #expect(harness.events.events.first == .checking)
        #expect(harness.events.events.contains(.notAvailable))
        #expect(harness.log.has("update:checked"))
    }

    @Test("INSTALL_L2_01: 更新检测 6h 轮询间隔＝21600000ms，启动即查 + 每 6h 自动检测（UPD_poll_6h）")
    func pollEverySixHours() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.upToDate, .upToDate, .upToDate]
        harness.controller.start()
        // 事件驱动泵到 start 链完整静止（M7 批6，替代固定 settle——满载下 25 yield 未必跑完 check+排程）。
        // 需**同时**满足 check 已发生 + next poll 已排程（排程可能先于 check 落，故用合取，非单看排程）。
        await settleUntil { harness.engine.checkCalls == 1 && harness.clock.nextDueInterval == 21_600_000 / 1000 }
        #expect(harness.engine.checkCalls == 1)
        // 下一次轮询恰在 6h（21600000ms）后。
        #expect(harness.clock.nextDueInterval == 21_600_000 / 1000)
        await harness.clock.advance(by: 6 * 3600 - 1)
        #expect(harness.engine.checkCalls == 1)
        await harness.clock.advance(by: 1)
        #expect(harness.engine.checkCalls == 2)
        // 轮询链持续（再 6h 第三次）。
        await harness.clock.advance(by: 6 * 3600)
        #expect(harness.engine.checkCalls == 3)
    }

    @Test("UPD_bad_feed_graceful: 检查失败（坏 feed/断网）→ 推 updateError（红 X 气泡 legacy 对等）+ update.log 有痕，不崩")
    func checkFailurePushesError() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.failure]
        harness.controller.start()
        await settle()
        #expect(harness.events.events.contains(.error))
        #expect(harness.log.has("update:check-failed"))
        // dock 清除（legacy error 事件 setProgressBar(-1) 对等）。
        #expect(harness.dock.fractions.last! == nil)
    }
}

@Suite("发现新版：弹窗文案与去打扰（auto-update.md §2）")
@MainActor
struct UpdateControllerPromptTests {

    @Test("UPD_dialog_copy_available: 三按钮弹窗 title/message/detail/按钮序逐字（老版 index.ts:772-780）")
    func availableDialogCopy() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.3.4")]
        harness.prompter.availableChoices = [.snooze]
        harness.controller.start()
        await settle()
        #expect(harness.prompter.availableRequests.count == 1)
        let request = harness.prompter.availableRequests[0]
        #expect(request.title == "Muxvo 有可用更新")
        #expect(request.message == "发现新版本 v2.3.4")
        #expect(request.detail == "下载在后台进行，不影响当前工作。下次启动时自动安装更新。")
        #expect(request.buttons == ["立即下载", "暂不更新", "不再提醒此版本"])
    }

    @Test("UPD_available_push_silent: 已推迟 >1 次 → 不弹框但仍推 updateAvailable（设置面板可见）")
    func silentWhenDismissedTwice() async {
        let harness = ControllerHarness(store: MemoryDismissalStore(UpdateDismissal(version: "2.0.0", count: 2)))
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.controller.start()
        await settle()
        #expect(harness.prompter.availableRequests.isEmpty)
        #expect(harness.events.events.contains(.available(version: "2.0.0")))
        // 引擎侧 pending 会话被释放。
        #expect(harness.engine.dismissPendingCalls == 1)
    }

    @Test("UPD_snooze_persist: 「暂不更新」→ count+1 落盘")
    func snoozePersists() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.snooze]
        harness.controller.start()
        await settle()
        // 首见落盘 {2.0.0, 0}，暂不后落盘 {2.0.0, 1}。
        #expect(harness.store.saves == [
            UpdateDismissal(version: "2.0.0", count: 0),
            UpdateDismissal(version: "2.0.0", count: 1),
        ])
    }

    @Test("UPD_snooze_72h_reprompt: count≤1 → 72h 后会话内直接重弹同版本（不重新 check）")
    func snoozeRepromptsAfter72h() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.snooze, .snooze]
        harness.controller.start()
        await settle()
        #expect(harness.prompter.availableRequests.count == 1)
        let checksBefore = harness.engine.checkCalls
        await harness.clock.advance(by: 72 * 3600 - 1)
        #expect(harness.prompter.availableRequests.count == 1)
        await harness.clock.advance(by: 1)
        #expect(harness.prompter.availableRequests.count == 2)
        #expect(harness.prompter.availableRequests[1].message == "发现新版本 v2.0.0")
        // 重弹不重新 check（legacy :798 setTimeout(promptUpdate)）。注意 6h 轮询会照跑，
        // 故只断言重弹瞬间前后无「额外」manual check——用 up-to-date 剧本让轮询不产生新弹窗。
        #expect(harness.engine.checkCalls - checksBefore <= 72 / 6) // 轮询自然次数上限内
    }

    @Test("UPD_snooze_cap_2: 两次「暂不」后（count=2）跨重启不再弹框（重建 controller 复用 store）")
    func snoozeCapTwoAcrossRestart() async {
        let store = MemoryDismissalStore()
        let first = ControllerHarness(store: store)
        first.engine.checkScripts = [.found("2.0.0")]
        first.prompter.availableChoices = [.snooze, .snooze]
        first.controller.start()
        await settle()
        // 72h 重弹再暂不 → count=2，且不再安排新的重弹（count>1）。
        await first.clock.advance(by: 72 * 3600)
        #expect(first.prompter.availableRequests.count == 2)
        #expect(store.stored == UpdateDismissal(version: "2.0.0", count: 2))

        // 「重启」：新 controller 复用同 store，同版本 available → 静默。
        let second = ControllerHarness(store: store)
        second.engine.checkScripts = [.found("2.0.0")]
        second.controller.start()
        await settle()
        #expect(second.prompter.availableRequests.isEmpty)
        #expect(second.events.events.contains(.available(version: "2.0.0")))
    }

    @Test("UPD_mute_version: 「不再提醒此版本」→ count=999 落盘，同版本永久静默")
    func mutePersistsForever() async {
        let store = MemoryDismissalStore()
        let first = ControllerHarness(store: store)
        first.engine.checkScripts = [.found("2.0.0")]
        first.prompter.availableChoices = [.mute]
        first.controller.start()
        await settle()
        #expect(store.stored == UpdateDismissal(version: "2.0.0", count: 999))

        let second = ControllerHarness(store: store)
        second.engine.checkScripts = [.found("2.0.0")]
        second.controller.start()
        await settle()
        #expect(second.prompter.availableRequests.isEmpty)
    }

    @Test("UPD_mute_reset_new_version: 更高版本 available → 重置 {新版本, 0} 落盘并可再弹")
    func newVersionResetsMute() async {
        let harness = ControllerHarness(store: MemoryDismissalStore(UpdateDismissal(version: "2.0.0", count: 999)))
        harness.engine.checkScripts = [.found("2.1.0")]
        harness.prompter.availableChoices = [.snooze]
        harness.controller.start()
        await settle()
        #expect(harness.prompter.availableRequests.count == 1)
        #expect(harness.store.saves.first == UpdateDismissal(version: "2.1.0", count: 0))
    }

    @Test("UPD_reprompt_guard: 弹窗在屏时再收 available → 不叠弹（防重入门 legacy isPromptingUpdate）")
    func promptReentryGuard() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0"), .found("2.0.0")]
        harness.prompter.holdAvailable = true
        harness.controller.start()
        await settle()
        #expect(harness.prompter.availableRequests.count == 1)
        // 弹窗未回，6h 轮询再次 available → 防重入不叠弹。
        await harness.clock.advance(by: 6 * 3600)
        #expect(harness.prompter.availableRequests.count == 1)
        harness.prompter.releaseHeld(with: .snooze)
        await settle()
    }
}

@Suite("下载/完成/安装/错误（auto-update.md §3-§5）")
@MainActor
struct UpdateControllerDownloadTests {
    private static let frames = [
        UpdateDownloadProgress(percent: 25, transferred: 256, total: 1024, bytesPerSecond: 128),
        UpdateDownloadProgress(percent: 100, transferred: 1024, total: 1024, bytesPerSecond: 256),
    ]

    @Test("UPD_download_first_frame_0: 「立即下载」先推 percent:0 首帧再开始下载（菜单栏指示器立现）")
    func firstFrameZero() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.engine.downloadScripts = [.success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        let frames = harness.events.downloadingFrames()
        #expect(frames.first! == (0, 0, 0, 0))
        #expect(harness.engine.downloadCalls == 1)
    }

    @Test("UPD_download_progress_sink: 进度帧透传且 percent 单调不减；完成推 updateDownloaded")
    func progressForwarded() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.engine.downloadScripts = [.success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        let frames = harness.events.downloadingFrames()
        #expect(frames.count == 3) // 首帧 + 2 进度帧
        #expect(frames[1] == (25, 256, 1024, 128))
        #expect(frames[2] == (100, 1024, 1024, 256))
        let percents = frames.map { $0.0 }
        #expect(zip(percents, percents.dropFirst()).allSatisfy { $0 <= $1 })
        #expect(harness.events.events.contains(.downloaded(version: "2.0.0")))
    }

    @Test("UPD_dock_progress: dock 进度 = percent/100 序列；downloaded 与 error 均清除（-1 语义 = nil）")
    func dockProgressSequence() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.engine.downloadScripts = [.success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        #expect(harness.dock.fractions == [0, 0.25, 1.0, nil])
    }

    @Test("INSTALL_L2_15: 下载失败自动重试 1 次，仍失败才提示（UPD_error_retry_once：重试成功全程不推 updateError）")
    func retryOnceThenSuccess() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.engine.downloadScripts = [.failure, .success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        #expect(harness.engine.downloadCalls == 2)
        #expect(!harness.events.events.contains(.error))
        #expect(harness.events.events.contains(.downloaded(version: "2.0.0")))
        #expect(harness.log.has("update:retry") || harness.log.has("auto-retrying"))
    }

    @Test("UPD_error_badge_copy: 重试仍失败 → 恰一次 updateError 推送 + dock 清除（web 气泡断言在 vitest 半）")
    func retryExhaustedEmitsError() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.engine.downloadScripts = [.failure, .failure]
        harness.controller.start()
        await settle()
        #expect(harness.engine.downloadCalls == 2)
        #expect(harness.events.events.filter { $0 == .error }.count == 1)
        #expect(harness.dock.fractions.last! == nil)
        #expect(harness.log.has("retry exhausted"))
    }

    @Test("UPD_dialog_copy_ready: 下载完成两按钮弹窗逐字（老版 index.ts:847-855）")
    func downloadedDialogCopy() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.3.4")]
        harness.prompter.availableChoices = [.download]
        harness.engine.downloadScripts = [.success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        #expect(harness.prompter.downloadedRequests.count == 1)
        let request = harness.prompter.downloadedRequests[0]
        #expect(request.title == "下载完成")
        #expect(request.message == "v2.3.4 已下载完成")
        #expect(request.detail == "立即重启安装，还是下次启动时自动安装？")
        #expect(request.buttons == ["立即重启", "下次启动时安装"])
    }

    @Test("UPD_restart_now_installs: 「立即重启」→ installAndRelaunch 恰 1 次且经时钟出弹窗回调栈（tick 前不装）")
    func restartNowInstallsOutOfStack() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.prompter.downloadedChoices = [.restartNow]
        harness.engine.downloadScripts = [.success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        // 选择已回但安装挂在 clock.schedule(after:0)——tick 前不得安装（出栈保证，§4）。
        #expect(harness.engine.installAndRelaunchCalls.isEmpty)
        await harness.clock.advance(by: 0)
        #expect(harness.engine.installAndRelaunchCalls == [DownloadedUpdate(version: "2.0.0")])
        #expect(harness.engine.scheduleInstallOnQuitCalls.isEmpty)
        #expect(harness.log.has("update:installing v2.0.0"))
    }

    @Test("UPD_install_on_next_launch: 「下次启动时安装」→ scheduleInstallOnQuit，无即时安装")
    func installOnQuit() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.prompter.downloadedChoices = [.installOnQuit]
        harness.engine.downloadScripts = [.success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        await harness.clock.advance(by: 0)
        #expect(harness.engine.scheduleInstallOnQuitCalls == [DownloadedUpdate(version: "2.0.0")])
        #expect(harness.engine.installAndRelaunchCalls.isEmpty)
        #expect(harness.log.has("update:install-on-quit v2.0.0"))
    }

    @Test("UPD_downloaded_no_reprompt: downloaded 待装态同版本 available 吸收——不弹不推（偏差⑤）")
    func downloadedAbsorbsSameVersion() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0"), .found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.prompter.downloadedChoices = [.installOnQuit]
        harness.engine.downloadScripts = [.success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        await harness.clock.advance(by: 0)
        let availablePushes = harness.events.events.filter { $0 == .available(version: "2.0.0") }.count
        let prompts = harness.prompter.availableRequests.count
        // 6h 轮询再次发现同版本 → 吸收。
        await harness.clock.advance(by: 6 * 3600)
        #expect(harness.prompter.availableRequests.count == prompts)
        #expect(harness.events.events.filter { $0 == .available(version: "2.0.0") }.count == availablePushes)
        #expect(harness.log.has("update:available-absorbed v2.0.0"))
    }

    @Test("UPD_error_log_file: 全链里程碑 token 按序落日志（checked→available→downloading→downloaded→install-on-quit）")
    func milestoneTokensInOrder() async {
        let harness = ControllerHarness()
        harness.engine.checkScripts = [.found("2.0.0")]
        harness.prompter.availableChoices = [.download]
        harness.prompter.downloadedChoices = [.installOnQuit]
        harness.engine.downloadScripts = [.failure, .success(frames: Self.frames)]
        harness.controller.start()
        await settle()
        await harness.clock.advance(by: 0)
        let joined = harness.log.lines.joined(separator: "\n")
        let tokens = ["update:checked", "update:available v2.0.0", "update:downloading v2.0.0",
                      "update:retry", "update:downloaded v2.0.0", "update:install-on-quit v2.0.0"]
        var cursor = joined.startIndex
        for token in tokens {
            guard let found = joined.range(of: token, range: cursor..<joined.endIndex) else {
                Issue.record("里程碑 token 缺失或乱序：\(token)")
                return
            }
            cursor = found.upperBound
        }
        // 失败路径 ERROR 级有痕（retry 前的首次失败）。
        #expect(harness.log.lines.contains { $0.hasPrefix("[ERROR]") && $0.contains("download-failed") })
    }
}
