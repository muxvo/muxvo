// 更新状态机唯一真源（specs/behavior/auto-update.md §1-§5）：检查节律/去打扰/下载重试/两段式安装。
// 全接缝注入（UpdateSeams.swift），自身不碰网络/UI/文件系统。

import Foundation

@MainActor
public final class UpdateController {
    private let engine: UpdateEngine
    private let prompter: UpdatePrompter
    private let clock: UpdateClock
    private let store: UpdateDismissalStore
    private let events: UpdateEventSink
    private let dock: UpdateDockProgressSink
    private let log: UpdateLogging
    private let timings: UpdateTimings

    /// 去打扰内存镜像（启动自 store 恢复；legacy :751-758）。
    private var dismissal: UpdateDismissal?
    /// 最近一次 available 的候选（设置面板 updateDownload 请求的目标）。
    private var pendingCandidate: UpdateCandidate?
    /// 72h 会话内重弹定时器（legacy updateReminderTimer）。
    private var reminderToken: UpdateClockToken?
    private var pollToken: UpdateClockToken?
    /// 弹窗防重入门（legacy isPromptingUpdate :747）。
    private var isPrompting = false
    private var isCheckInFlight = false
    private var isDownloading = false
    /// downloaded 待装态（§2 偏差⑤吸收 + §4 两段式）。
    public private(set) var downloadedVersion: String?

    public init(
        engine: UpdateEngine,
        prompter: UpdatePrompter,
        clock: UpdateClock,
        store: UpdateDismissalStore,
        events: UpdateEventSink,
        dock: UpdateDockProgressSink,
        log: UpdateLogging,
        timings: UpdateTimings = UpdateTimings()
    ) {
        self.engine = engine
        self.prompter = prompter
        self.clock = clock
        self.store = store
        self.events = events
        self.dock = dock
        self.log = log
        self.timings = timings
        self.dismissal = store.load()
    }

    // MARK: 检查节律（§1）

    /// 启动即查一次 + 每 checkInterval 轮询。
    public func start() {
        kickCheck(reason: "launch")
        scheduleNextPoll()
    }

    /// 手动检查（app.request updateCheck；结果经推送，请求即时 ack 由装配层负责）。
    public func checkNow() {
        kickCheck(reason: "manual")
    }

    private func scheduleNextPoll() {
        pollToken = clock.schedule(after: timings.checkInterval) { [weak self] in
            guard let self else { return }
            self.kickCheck(reason: "poll")
            self.scheduleNextPoll()
        }
    }

    private func kickCheck(reason: String) {
        guard !isCheckInFlight, !isDownloading else { return }
        isCheckInFlight = true
        events.emit(.checking)
        Task { [weak self] in
            guard let self else { return }
            do {
                let candidate = try await self.engine.check()
                self.isCheckInFlight = false
                self.log.info("update:checked reason=\(reason) result=\(candidate?.version ?? "up-to-date")")
                if let candidate {
                    self.handleAvailable(candidate)
                } else {
                    self.events.emit(.notAvailable)
                }
            } catch {
                self.isCheckInFlight = false
                // 检查失败推 updateError（红 X 气泡「下载失败」3s）——legacy autoUpdater 'error'
                // 事件对检查失败同样推送（:867-873），非静默；§1 批2 亲读修正。
                self.log.error("update:check-failed reason=\(reason) error=\(error)")
                self.dock.setFraction(nil)
                self.events.emit(.error)
            }
        }
    }

    // MARK: 发现新版（§2 统一处理序）

    private func handleAvailable(_ candidate: UpdateCandidate) {
        // 1. 取消 pending 的会话内重弹（legacy :808）。
        reminderToken?.cancel()
        reminderToken = nil

        // downloaded 待装吸收（偏差⑤）：同版本不弹不推；更高版本走全新周期。
        if let downloaded = downloadedVersion, downloaded == candidate.version {
            engine.dismissPending()
            log.info("update:available-absorbed v\(candidate.version) (downloaded pending install)")
            return
        }

        // 2. 新版本号重置去打扰计数并立即落盘（legacy :810-815）。
        if dismissal?.version != candidate.version {
            let reset = UpdateDismissal(version: candidate.version, count: 0)
            dismissal = reset
            store.save(reset)
        }

        pendingCandidate = candidate

        // 3. 推送无论弹否（设置面板据此切 available，legacy :817）。
        events.emit(.available(version: candidate.version))
        log.info("update:available v\(candidate.version)")

        // 4. 已推迟 >1 次 → 静默（legacy :820-823）。
        if (dismissal?.count ?? 0) > 1 {
            engine.dismissPending()
            return
        }
        promptAvailable(candidate)
    }

    /// 三按钮弹窗（§2 表）；72h 重弹直接进此（不重新 check，legacy :798）。
    private func promptAvailable(_ candidate: UpdateCandidate) {
        guard !isPrompting else { return }
        isPrompting = true
        Task { [weak self] in
            guard let self else { return }
            let choice = await self.prompter.promptAvailable(UpdateCopy.availableRequest(version: candidate.version))
            self.isPrompting = false
            switch choice {
            case .download:
                self.beginDownload(candidate)
            case .mute:
                let mute = UpdateDismissal(version: candidate.version, count: 999)
                self.dismissal = mute
                self.store.save(mute)
                self.engine.dismissPending()
                self.log.info("update:muted v\(candidate.version)")
            case .snooze:
                var snoozed = self.dismissal ?? UpdateDismissal(version: candidate.version, count: 0)
                snoozed.count += 1
                self.dismissal = snoozed
                self.store.save(snoozed)
                self.engine.dismissPending()
                self.log.info("update:snoozed v\(candidate.version) count=\(snoozed.count)")
                if snoozed.count <= 1 {
                    self.reminderToken = self.clock.schedule(after: self.timings.snoozeRepromptDelay) { [weak self] in
                        self?.promptAvailable(candidate)
                    }
                }
            }
        }
    }

    // MARK: 下载（§3）

    /// 设置面板「下载 v{x}」（app.request updateDownload）。候选缺席（异常时序）静默忽略。
    public func downloadNow() {
        guard let candidate = pendingCandidate else {
            log.warn("update:download-requested without pending candidate")
            return
        }
        beginDownload(candidate)
    }

    private func beginDownload(_ candidate: UpdateCandidate, isRetry: Bool = false) {
        guard !isDownloading else { return }
        isDownloading = true
        if !isRetry {
            // 首帧 percent:0 先推，菜单栏指示器立现（legacy pushDownloadStart :760-765）。
            events.emit(.downloading(percent: 0, transferred: 0, total: 0, bytesPerSecond: 0))
            dock.setFraction(0)
            log.info("update:downloading v\(candidate.version)")
        } else {
            log.warn("update:retry v\(candidate.version)")
        }
        Task { [weak self] in
            guard let self else { return }
            do {
                let update = try await self.engine.startDownload(candidate) { [weak self] progress in
                    guard let self else { return }
                    self.events.emit(.downloading(
                        percent: progress.percent,
                        transferred: progress.transferred,
                        total: progress.total,
                        bytesPerSecond: progress.bytesPerSecond
                    ))
                    self.dock.setFraction(progress.percent / 100)
                }
                self.isDownloading = false
                self.handleDownloaded(update)
            } catch {
                self.isDownloading = false
                if !isRetry {
                    // 偏差②（INSTALL_L2_15）：自动重试 1 次，重试成功全程无感。
                    self.log.error("update:download-failed v\(candidate.version) error=\(error) (auto-retrying once)")
                    self.beginDownload(candidate, isRetry: true)
                } else {
                    self.log.error("update:download-failed v\(candidate.version) error=\(error) (retry exhausted)")
                    self.dock.setFraction(nil)
                    self.events.emit(.error)
                }
            }
        }
    }

    // MARK: 完成与安装（§4）

    private func handleDownloaded(_ update: DownloadedUpdate) {
        downloadedVersion = update.version
        pendingCandidate = nil
        dock.setFraction(nil)
        events.emit(.downloaded(version: update.version))
        log.info("update:downloaded v\(update.version)")
        Task { [weak self] in
            guard let self else { return }
            let choice = await self.prompter.promptDownloaded(UpdateCopy.downloadedRequest(version: update.version))
            switch choice {
            case .restartNow:
                self.log.info("update:installing v\(update.version)")
                // 必须出弹窗回调栈后执行（legacy setImmediate 防 SIGABRT 对等，§4）。
                self.clock.schedule(after: 0) { [weak self] in
                    self?.engine.installAndRelaunch(update)
                }
            case .installOnQuit:
                self.log.info("update:install-on-quit v\(update.version)")
                self.engine.scheduleInstallOnQuit(update)
            }
        }
    }
}
