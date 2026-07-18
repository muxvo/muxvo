// Sparkle 2.x 更新引擎 adapter（J1 裁决 2026-07-13，logs/auto-update-j1-adjudication.md）：
// 自定义 SPUUserDriver 全接管、Sparkle 标准 UI 零出场——Sparkle 只作换装引擎（进程外 Autoupdate
// 原子换装/EdDSA 验签/quarantine 处理），全部 UX（弹窗/推送/去打扰/轮询）由 UpdateController 自管
// （specs/behavior/auto-update.md）。push 回调经 continuation 桥成 UpdateEngine 的 pull async 接缝。
//
// 会话形态映射：
//   check()            = updater.checkForUpdates() → showUpdateFound（捕 reply）/ NotFound / Error
//   startDownload()    = foundReply(.install) → 进度回调流 → showReadyToInstallAndRelaunch（捕 reply）
//                        ；若会话已被 dismiss（72h 重弹后再下载）→ 内部重查并自动 .install 复活
//   dismissPending()   = foundReply(.dismiss)（用户暂不/静默/downloaded 吸收）
//   installAndRelaunch = readyReply(.install)（调用方已保证出弹窗回调栈）
//   scheduleInstallOnQuit = readyReply(.dismiss)——Sparkle 语义：ready 后 dismiss = 退出时自动装
//                        （autoInstallOnAppQuit 对等，J1 §二核实）
// Sparkle 契约：SPUUserDriver 回调恒在主线程 → @preconcurrency 会合 @MainActor（越线即崩=契约破裂）。

import AppKit
import Foundation
import MuxvoUpdater
import Sparkle

/// feed URL 委托（Sparkle 可能在后台线程调 delegate → 独立 nonisolated 小对象持不可变串）。
private final class SparkleFeedDelegate: NSObject, SPUUpdaterDelegate {
    private let feedURLString: String
    init(feedURL: URL) { self.feedURLString = feedURL.absoluteString }
    func feedURLString(for updater: SPUUpdater) -> String? { feedURLString }
}

@MainActor
public final class SparkleEngine: NSObject, UpdateEngine, @preconcurrency SPUUserDriver {
    public struct EngineError: Error, CustomStringConvertible {
        public let description: String
    }

    private var updater: SPUUpdater!
    private let feedDelegate: SparkleFeedDelegate
    private let log: UpdateLogging
    /// 立即重启前回调（装配接 AppDelegate 退出确认旁路——legacy forceClose=true 对等，auto-update.md §4：
    /// 更新安装触发的 terminate 不弹退出确认，仍走优雅关停序）。
    public var onWillInstallAndRelaunch: (() -> Void)?

    // 会话态（单会话：UpdateController 已保证 check/download 不并发）
    private var checkContinuation: CheckedContinuation<UpdateCandidate?, Error>?
    private var downloadContinuation: CheckedContinuation<DownloadedUpdate, Error>?
    private var foundReply: ((SPUUserUpdateChoice) -> Void)?
    private var readyReply: ((SPUUserUpdateChoice) -> Void)?
    private var foundVersion: String = ""
    /// 复活路径（会话曾被 dismiss，用户其后点下载）：下一次 showUpdateFound 直接 .install。
    private var autoInstallOnFound = false
    private var progressHandler: (@MainActor (UpdateDownloadProgress) -> Void)?

    // 进度累计（bytesPerSecond 由 driver 自算，J1 §二）
    private var totalBytes = 0
    private var transferredBytes = 0
    private var lastEmitAt = Date.distantPast
    private var speedMarkAt = Date()
    private var speedMarkBytes = 0
    private var lastBps = 0
    private static let emitInterval: TimeInterval = 0.1

    public init(feedURL: URL, log: UpdateLogging) {
        self.feedDelegate = SparkleFeedDelegate(feedURL: feedURL)
        self.log = log
        super.init()
        self.updater = SPUUpdater(
            hostBundle: .main,
            applicationBundle: .main,
            userDriver: self,
            delegate: feedDelegate
        )
        // 轮询/下载全由 UpdateController 自管（6h 口径），Sparkle 自动机制关死。
        updater.automaticallyChecksForUpdates = false
        updater.automaticallyDownloadsUpdates = false
    }

    /// 装配处启动（失败 = feed/plist 配置问题，返回 false 并留日志，更新面整体降级 no-op）。
    public func startUpdater() -> Bool {
        do {
            try updater.start()
            return true
        } catch {
            log.error("update:engine-start-failed error=\(error)")
            return false
        }
    }

    // MARK: UpdateEngine

    public func check() async throws -> UpdateCandidate? {
        guard checkContinuation == nil, downloadContinuation == nil else {
            throw EngineError(description: "check while session busy")
        }
        return try await withCheckedThrowingContinuation { continuation in
            checkContinuation = continuation
            updater.checkForUpdates()
        }
    }

    public func startDownload(
        _ candidate: UpdateCandidate,
        onProgress: @escaping @MainActor (UpdateDownloadProgress) -> Void
    ) async throws -> DownloadedUpdate {
        guard downloadContinuation == nil else {
            throw EngineError(description: "download already in flight")
        }
        progressHandler = onProgress
        resetProgressCounters()
        return try await withCheckedThrowingContinuation { continuation in
            downloadContinuation = continuation
            if let reply = foundReply {
                foundReply = nil
                reply(.install)
            } else {
                // 会话已被 dismiss → 重查复活，found 即自动 .install（对上层透明）。
                autoInstallOnFound = true
                updater.checkForUpdates()
            }
        }
    }

    public func dismissPending() {
        if let reply = foundReply {
            foundReply = nil
            reply(.dismiss)
        }
    }

    public func installAndRelaunch(_ update: DownloadedUpdate) {
        guard let reply = readyReply else {
            log.error("update:install-requested without staged update")
            return
        }
        readyReply = nil
        onWillInstallAndRelaunch?() // 退出确认旁路先置位（Sparkle 随后 NSApp.terminate）
        reply(.install)
    }

    public func scheduleInstallOnQuit(_ update: DownloadedUpdate) {
        guard let reply = readyReply else {
            log.error("update:install-on-quit-requested without staged update")
            return
        }
        readyReply = nil
        reply(.dismiss) // Sparkle ready 态 dismiss = 保留 staged，退出时自动装。
    }

    // MARK: SPUUserDriver（Sparkle 主线程契约；标准 UI 零出场）

    public func show(
        _ request: SPUUpdatePermissionRequest,
        reply: @escaping (SUUpdatePermissionResponse) -> Void
    ) {
        // 自动检查自管：Sparkle 权限询问恒答否（不出现任何 Sparkle UI）。
        reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false))
    }

    public func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
        // 检查中无自有 UI（web 端 checking 态由 UpdateController 推送驱动）。
    }

    public func showUpdateFound(
        with appcastItem: SUAppcastItem,
        state: SPUUserUpdateState,
        reply: @escaping (SPUUserUpdateChoice) -> Void
    ) {
        foundVersion = appcastItem.displayVersionString
        if autoInstallOnFound {
            autoInstallOnFound = false
            reply(.install)
            return
        }
        // downloaded/installing 阶段的 found（Sparkle 恢复 staged 会话）：已就绪 → 直接进 ready 流。
        foundReply = reply
        if let continuation = checkContinuation {
            checkContinuation = nil
            continuation.resume(returning: UpdateCandidate(version: foundVersion))
        }
    }

    public func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {
        // release notes 走随包 CHANGELOG（auto-update.md §7），Sparkle 侧不消费。
    }

    public func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}

    public func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
        acknowledgement()
        if let continuation = checkContinuation {
            checkContinuation = nil
            continuation.resume(returning: nil)
        }
    }

    public func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
        acknowledgement()
        log.error("update:engine-error \(error.localizedDescription)")
        if let continuation = checkContinuation {
            checkContinuation = nil
            continuation.resume(throwing: error)
        } else if let continuation = downloadContinuation {
            downloadContinuation = nil
            progressHandler = nil
            continuation.resume(throwing: error)
        }
    }

    public func showDownloadInitiated(cancellation: @escaping () -> Void) {
        resetProgressCounters()
    }

    public func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
        // 重定向可能多次报长：每次重置总量与已收（Sparkle 头注释语义）。测速基准也须同步重置——
        // 否则下一拍 bytesPerSecond=（新 transferred − 旧 speedMarkBytes）/dt 可瞬时为负（对抗 MINOR-4）。
        totalBytes = Int(expectedContentLength)
        transferredBytes = 0
        speedMarkBytes = 0
        speedMarkAt = Date()
    }

    public func showDownloadDidReceiveData(ofLength length: UInt64) {
        transferredBytes += Int(length)
        let now = Date()
        let sinceMark = now.timeIntervalSince(speedMarkAt)
        if sinceMark >= 0.5 {
            lastBps = Int(Double(transferredBytes - speedMarkBytes) / sinceMark)
            speedMarkAt = now
            speedMarkBytes = transferredBytes
        }
        guard now.timeIntervalSince(lastEmitAt) >= Self.emitInterval else { return }
        lastEmitAt = now
        emitProgress()
    }

    public func showDownloadDidStartExtractingUpdate() {
        // 下载完成终帧（环走满；提取阶段无 UI，legacy 同）。
        if totalBytes > 0 {
            transferredBytes = totalBytes
            emitProgress()
        }
    }

    public func showExtractionReceivedProgress(_ progress: Double) {}

    public func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
        readyReply = reply
        if let continuation = downloadContinuation {
            downloadContinuation = nil
            progressHandler = nil
            continuation.resume(returning: DownloadedUpdate(version: foundVersion))
        }
    }

    public func showInstallingUpdate(
        withApplicationTerminated applicationTerminated: Bool,
        retryTerminatingApplication: @escaping () -> Void
    ) {}

    public func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
        acknowledgement()
    }

    public func showUpdateInFocus() {}

    public func dismissUpdateInstallation() {
        // 会话收尾：仍有挂起 continuation = 会话被外因终止 → 以取消语义收敛（controller 走错误路径）。
        if let continuation = checkContinuation {
            checkContinuation = nil
            continuation.resume(throwing: CancellationError())
        }
        if let continuation = downloadContinuation {
            downloadContinuation = nil
            progressHandler = nil
            continuation.resume(throwing: CancellationError())
        }
        foundReply = nil
    }

    // MARK: 进度小工具

    private func resetProgressCounters() {
        totalBytes = 0
        transferredBytes = 0
        lastEmitAt = .distantPast
        speedMarkAt = Date()
        speedMarkBytes = 0
        lastBps = 0
    }

    private func emitProgress() {
        let percent = totalBytes > 0 ? Double(transferredBytes) / Double(totalBytes) * 100 : 0
        progressHandler?(UpdateDownloadProgress(
            percent: min(percent, 100),
            transferred: transferredBytes,
            total: totalBytes,
            bytesPerSecond: lastBps
        ))
    }
}
