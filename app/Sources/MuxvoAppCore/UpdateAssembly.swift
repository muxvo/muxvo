// 自动更新生产装配（specs/behavior/auto-update.md §0/§1/§9）：UpdateController 七接缝的生产实现
// + 启用门。门 = env MUXVO_UPDATE_FEED_URL（e2e/真机脚本）→ Info.plist MuxvoUpdateFeedURL（dist 注入）
// → 双缺席 = dev no-op（更新面整体不装配，AppRequestHandler updateActions=nil 即 legacy dev 对等）。
// What's New 数据面不随此门（legacy GET_RELEASE_NOTES dev 也可用）。

import AppKit
import Foundation
import MuxvoBridge
import MuxvoStorage
import MuxvoUpdater

// MARK: 真时钟（Timer 主线程；测试宇宙用 ManualUpdateClock，本类仅生产）

@MainActor
final class RealUpdateClock: UpdateClock {
    private final class Token: UpdateClockToken {
        weak var timer: Timer?
        init(timer: Timer) { self.timer = timer }
        func cancel() { timer?.invalidate() }
    }

    var now: Date { Date() }

    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> UpdateClockToken {
        let timer = Timer.scheduledTimer(withTimeInterval: max(seconds, 0), repeats: false) { _ in
            MainActor.assumeIsolated { body() }
        }
        return Token(timer: timer)
    }
}

// MARK: 原生弹窗（auto-update.md §2/§4；文案由 UpdateController 经 UpdateCopy 传入）

/// NSAlert 生产弹窗。映射与 legacy dialog.showMessageBox 的 macOS 呈现一致：message → messageText
/// （粗体主文案）、detail → informativeText；title 在 macOS 上历来不显示（Electron 同），不参与呈现。
/// buttons[0]=default（Return）；「暂不更新/下次启动时安装」列 cancel 位（Esc，legacy cancelId=1 对等）。
/// 呈现 = 挂主窗 sheet（非阻塞，auto-update.md §2）：app-modal runModal 会冻结主 run loop 的
/// 首帧 ui.state 推送——启动即查场景下 web 整个弹窗期只能停在演示 fixture 假终端（2026-07-16 真机定性）。
@MainActor
final class NSAlertUpdatePrompter: UpdatePrompter {
    func promptAvailable(_ request: UpdateDialogRequest) async -> UpdateAvailableChoice {
        switch await runAlert(request, escapeButtonIndex: 1) {
        case .alertFirstButtonReturn: return .download
        case .alertThirdButtonReturn: return .mute
        default: return .snooze
        }
    }

    func promptDownloaded(_ request: UpdateDialogRequest) async -> UpdateDownloadedChoice {
        switch await runAlert(request, escapeButtonIndex: 1) {
        case .alertFirstButtonReturn: return .restartNow
        default: return .installOnQuit
        }
    }

    private func runAlert(_ request: UpdateDialogRequest, escapeButtonIndex: Int) async -> NSApplication.ModalResponse {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = request.message
        alert.informativeText = request.detail
        for (index, title) in request.buttons.enumerated() {
            let button = alert.addButton(withTitle: title)
            if index == escapeButtonIndex { button.keyEquivalent = "\u{1b}" }
        }
        if let window = NSApp.mainWindow ?? NSApp.windows.first(where: { $0.isVisible }) {
            return await alert.beginSheetModal(for: window)
        }
        return alert.runModal() // 无可挂窗兜底（主窗尚未建/全关）：宁可阻塞不可丢弹窗
    }
}

/// 埋点弹窗装饰器（analytics.md L5，埋点批2）：包任意 prompter 嗅探更新漏斗——弹窗展示
/// update.prompted(stage) / 用户选择 update.choice(stage, choice)。纯旁路透传，绝不改变弹窗行为。
@MainActor
final class AnalyticsUpdatePrompter: UpdatePrompter {
    private let wrapped: any UpdatePrompter
    private let track: (String, [String: String]) -> Void

    init(wrapping wrapped: any UpdatePrompter, track: @escaping (String, [String: String]) -> Void) {
        self.wrapped = wrapped
        self.track = track
    }

    func promptAvailable(_ request: UpdateDialogRequest) async -> UpdateAvailableChoice {
        track("update.prompted", ["stage": "available"])
        let choice = await wrapped.promptAvailable(request)
        let name: String
        switch choice {
        case .download: name = "download"
        case .snooze: name = "snooze"
        case .mute: name = "mute"
        }
        track("update.choice", ["stage": "available", "choice": name])
        return choice
    }

    func promptDownloaded(_ request: UpdateDialogRequest) async -> UpdateDownloadedChoice {
        track("update.prompted", ["stage": "downloaded"])
        let choice = await wrapped.promptDownloaded(request)
        track("update.choice", [
            "stage": "downloaded",
            "choice": choice == .restartNow ? "restart_now" : "install_on_quit",
        ])
        return choice
    }
}

/// 埋点事件 sink 装饰器（analytics.md L5）：嗅探 downloaded/error 后透传 broadcast。
final class AnalyticsUpdateEventSink: UpdateEventSink {
    private let wrapped: any UpdateEventSink
    private let track: (String, [String: String]) -> Void

    init(wrapping wrapped: any UpdateEventSink, track: @escaping (String, [String: String]) -> Void) {
        self.wrapped = wrapped
        self.track = track
    }

    public func emit(_ event: UpdateEvent) {
        switch event {
        case let .downloaded(version):
            track("update.downloaded", ["version": version])
        case .error:
            track("app.error", ["domain": "update", "code": "update_error"])
        default:
            break
        }
        wrapped.emit(event)
    }
}

/// autopilot 弹窗器（仅 tools/update-swap 真机换装终验用，env MUXVO_UPDATE_AUTOPILOT=1）：
/// 自动选「立即下载」→安装选择；逐步落 update.log 供脚本断言。生产路径不进此类。
/// 安装选择由 env MUXVO_UPDATE_AUTOPILOT_INSTALL 决定：`onQuit`=下次启动时安装（对抗 MINOR-2 护栏），
/// 其余（默认）=立即重启。
@MainActor
final class AutopilotUpdatePrompter: UpdatePrompter {
    private let log: UpdateLogging
    private let installOnQuit: Bool
    init(log: UpdateLogging) {
        self.log = log
        self.installOnQuit = ProcessInfo.processInfo.environment["MUXVO_UPDATE_AUTOPILOT_INSTALL"] == "onQuit"
    }

    func promptAvailable(_ request: UpdateDialogRequest) async -> UpdateAvailableChoice {
        log.info("update:autopilot available-dialog [\(request.buttons.joined(separator: "|"))] → 立即下载")
        return .download
    }

    func promptDownloaded(_ request: UpdateDialogRequest) async -> UpdateDownloadedChoice {
        let choice = installOnQuit ? "下次启动时安装" : "立即重启"
        log.info("update:autopilot downloaded-dialog [\(request.buttons.joined(separator: "|"))] → \(choice)")
        return installOnQuit ? .installOnQuit : .restartNow
    }
}

// MARK: dock 进度条（legacy mainWindow.setProgressBar 对等：图标底部横条覆盖层）

@MainActor
final class DockProgressController: UpdateDockProgressSink {
    /// 绘制已迁 DockTileRenderer（进度条几何原样），与 Dock 徽标共用 contentView 合成互不 clobber。
    func setFraction(_ fraction: Double?) {
        DockTileRenderer.shared.setProgressFraction(fraction)
    }
}

// MARK: 持久化（config.json，MuxvoConfig.updateDismissal；auto-update.md §0）

@MainActor
final class ConfigUpdateDismissalStore: UpdateDismissalStore {
    private let configModel: ConfigModel
    init(configModel: ConfigModel) { self.configModel = configModel }

    func load() -> UpdateDismissal? {
        configModel.config.updateDismissal.map { UpdateDismissal(version: $0.version, count: $0.count) }
    }

    func save(_ dismissal: UpdateDismissal) {
        // 非偏好域结构性写回（不触发 onPrefsChanged 副作用），与 openTerminals 同 update(_:) 通道。
        configModel.update {
            $0.updateDismissal = .init(version: dismissal.version, count: dismissal.count)
        }
    }
}

// MARK: 推送 sink（UpdateEvent → data.event 全窗广播；auto-update.md §9）

@MainActor
public final class BroadcastUpdateEventSink: UpdateEventSink {
    private weak var windowManager: WindowManager?
    public init(windowManager: WindowManager) { self.windowManager = windowManager }

    public func emit(_ event: UpdateEvent) {
        windowManager?.broadcastDataEvent(Self.dataEvent(for: event))
    }

    public static func dataEvent(for event: UpdateEvent) -> DataEvent {
        switch event {
        case .checking:
            return .updateChecking
        case let .available(version):
            return .updateAvailable(version: version)
        case .notAvailable:
            return .updateNotAvailable
        case let .downloading(percent, transferred, total, bytesPerSecond):
            return .updateDownloading(
                percent: percent, transferred: transferred, total: total, bytesPerSecond: bytesPerSecond)
        case let .downloaded(version):
            return .updateDownloaded(version: version)
        case .error:
            return .updateError
        }
    }
}

// MARK: What's New 数据服务（auto-update.md §7；不随生产启用门）

@MainActor
public final class WhatsNewService: WhatsNewRequestHandling {
    private let configModel: ConfigModel
    private let log: UpdateLogging
    private let changelogDirectory: URL?
    private let appVersion: String

    /// - changelogDirectory: 随包 CHANGELOG.{zh,en}.md 所在目录。生产 = Contents/Resources
    ///   （app.sh bundle 拷入）；e2e/dev 经 env MUXVO_CHANGELOG_DIR 覆盖；双缺席读失败 → []（空态）。
    public init(configModel: ConfigModel, log: UpdateLogging, changelogDirectory: URL?, appVersion: String) {
        self.configModel = configModel
        self.log = log
        self.changelogDirectory = changelogDirectory
        self.appVersion = appVersion
    }

    public func releaseNotes(locale: String) -> [ReleaseEntry] {
        let lang = locale == "en" ? "en" : "zh" // en 之外一律 zh（legacy app-handlers.ts:33）
        guard let dir = changelogDirectory,
              let content = try? String(
                  contentsOf: dir.appendingPathComponent("CHANGELOG.\(lang).md"), encoding: .utf8)
        else { return [] } // 读失败 → []（legacy :40-42，弹窗空态）
        return ChangelogParser.parse(content).map { release in
            ReleaseEntry(
                version: release.version,
                date: release.date,
                sections: release.sections.map { ReleaseSection(key: $0.key, items: $0.items) }
            )
        }
    }

    public func whatsNewStatus() -> (shouldShow: Bool, appVersion: String) {
        let verdict = WhatsNewGate.evaluate(lastSeen: configModel.config.lastSeenVersion, current: appVersion)
        if let write = verdict.lastSeenToWrite {
            configModel.update { $0.lastSeenVersion = write } // 查询即写回（legacy App.tsx:180-182）
        }
        if verdict.shouldShow {
            log.info("update:whats-new-shown v\(appVersion)")
        }
        return (verdict.shouldShow, appVersion)
    }
}

// MARK: 动作接缝 adapter（app.request updateCheck/updateDownload → 控制器）

@MainActor
public final class UpdateControllerActions: UpdateActionHandling {
    private let controller: UpdateController
    public init(controller: UpdateController) { self.controller = controller }
    public func updateCheck() { controller.checkNow() }
    public func updateDownload() { controller.downloadNow() }
}

// MARK: 装配根

/// 强持有集（AppDelegate 保活；桥闭包只 weak 引 composite 的既有纪律不变）。
@MainActor
final class UpdateServices {
    let controller: UpdateController
    let actions: UpdateActionHandling
    let logger: UpdateLogging
    private let engine: SparkleEngine
    private let prompter: any UpdatePrompter
    private let dock: DockProgressController
    private let sink: BroadcastUpdateEventSink
    private let clock: RealUpdateClock
    private let store: ConfigUpdateDismissalStore

    init(
        controller: UpdateController, actions: UpdateActionHandling, logger: UpdateLogging,
        engine: SparkleEngine, prompter: any UpdatePrompter, dock: DockProgressController,
        sink: BroadcastUpdateEventSink, clock: RealUpdateClock, store: ConfigUpdateDismissalStore
    ) {
        self.controller = controller
        self.actions = actions
        self.logger = logger
        self.engine = engine
        self.prompter = prompter
        self.dock = dock
        self.sink = sink
        self.clock = clock
        self.store = store
    }
}

@MainActor
enum UpdateAssembly {
    /// 生产启用门（auto-update.md §1）：env 覆盖 → Info.plist → nil = no-op。
    static func feedURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundle: Bundle = .main
    ) -> URL? {
        if let raw = environment["MUXVO_UPDATE_FEED_URL"], let url = URL(string: raw) { return url }
        if let raw = bundle.object(forInfoDictionaryKey: "MuxvoUpdateFeedURL") as? String,
           let url = URL(string: raw) { return url }
        return nil
    }

    /// 时序（auto-update.md §1）：MUXVO_UPDATE_TIMINGS_MS = 轮询间隔毫秒替值，72h 等比缩放（仅测试）。
    static func timings(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> UpdateTimings {
        guard let raw = environment["MUXVO_UPDATE_TIMINGS_MS"], let ms = Double(raw), ms > 0 else {
            return UpdateTimings()
        }
        let defaults = UpdateTimings()
        let scale = (ms / 1000) / defaults.checkInterval
        return UpdateTimings(
            checkInterval: defaults.checkInterval * scale,
            snoozeRepromptDelay: defaults.snoozeRepromptDelay * scale
        )
    }

    /// What's New changelog 目录：env MUXVO_CHANGELOG_DIR（e2e/dev）→ bundle Resources（dist）。
    static func changelogDirectory(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundle: Bundle = .main
    ) -> URL? {
        if let raw = environment["MUXVO_CHANGELOG_DIR"] {
            return URL(fileURLWithPath: raw, isDirectory: true)
        }
        return bundle.resourceURL
    }

    /// 更新面装配（门不过 → nil，AppRequestHandler updateActions=nil = legacy dev no-op 对等）。
    /// 返回后 controller 已 start()（启动即查 + 6h 轮询）。
    static func makeIfEnabled(
        configModel: ConfigModel, windowManager: WindowManager, logger: UpdateLogging,
        onWillInstallAndRelaunch: (() -> Void)? = nil,
        analyticsTrack: ((String, [String: String]) -> Void)? = nil
    ) -> UpdateServices? {
        guard let feedURL = feedURL() else { return nil }
        let engine = SparkleEngine(feedURL: feedURL, log: logger)
        engine.onWillInstallAndRelaunch = onWillInstallAndRelaunch
        guard engine.startUpdater() else { return nil } // 引擎起不来 → 降级 no-op（日志已留痕）
        // autopilot（仅真机换装终验脚本注入 env）：自动立即下载→立即重启；生产恒 NSAlert。
        var prompter: any UpdatePrompter =
            ProcessInfo.processInfo.environment["MUXVO_UPDATE_AUTOPILOT"] == "1"
                ? AutopilotUpdatePrompter(log: logger)
                : NSAlertUpdatePrompter()
        let clock = RealUpdateClock()
        let store = ConfigUpdateDismissalStore(configModel: configModel)
        let sink = BroadcastUpdateEventSink(windowManager: windowManager)
        // 埋点批2（analytics.md L5）：prompter/sink 装饰嗅探更新漏斗（纯旁路；未接 = 原链原样）。
        var events: any UpdateEventSink = sink
        if let analyticsTrack {
            prompter = AnalyticsUpdatePrompter(wrapping: prompter, track: analyticsTrack)
            events = AnalyticsUpdateEventSink(wrapping: sink, track: analyticsTrack)
        }
        let dock = DockProgressController()
        let controller = UpdateController(
            engine: engine, prompter: prompter, clock: clock, store: store,
            events: events, dock: dock, log: logger, timings: timings()
        )
        let services = UpdateServices(
            controller: controller, actions: UpdateControllerActions(controller: controller),
            logger: logger, engine: engine, prompter: prompter, dock: dock,
            sink: sink, clock: clock, store: store
        )
        controller.start()
        return services
    }
}
