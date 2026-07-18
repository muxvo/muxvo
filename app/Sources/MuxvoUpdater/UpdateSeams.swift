// 软件自动更新——接缝与数据形状（specs/behavior/auto-update.md §0-§5）。
// 纯 Foundation：引擎（Sparkle adapter）/弹窗（NSAlert）/dock 进度/持久化（config.json）全部
// 经此处协议注入，MuxvoUpdater 自身零 AppKit 零 vendor 依赖（单测免链 libghostty）。

import Foundation

// MARK: - 引擎侧（J1 裁决 Sparkle 2.x 自定义 SPUUserDriver 全接管；fake 可整体替身）

/// 发现的新版本。version 之外引擎自持会话内部态（appcast item 等），不外泄。
public struct UpdateCandidate: Equatable, Sendable {
    public let version: String
    public init(version: String) { self.version = version }
}

/// 已下载待装的更新。
public struct DownloadedUpdate: Equatable, Sendable {
    public let version: String
    public init(version: String) { self.version = version }
}

/// 下载进度帧（auto-update.md §9 updateDownloading 同形）。
public struct UpdateDownloadProgress: Equatable, Sendable {
    public let percent: Double
    public let transferred: Int
    public let total: Int
    public let bytesPerSecond: Int
    public init(percent: Double, transferred: Int, total: Int, bytesPerSecond: Int) {
        self.percent = percent
        self.transferred = transferred
        self.total = total
        self.bytesPerSecond = bytesPerSecond
    }
}

/// 更新引擎三段能力：发现 / 下载 / 安装。
/// - check() 返回 nil = 已是最新。
/// - 用户「暂不/不再提醒」或 downloaded 吸收时调 dismissPending() 释放引擎侧 pending 会话
///   （Sparkle showUpdateFound reply(.dismiss)；自研/fake 为 no-op 亦可）。
/// - startDownload 对「会话已被 dismiss 的候选」须自行复活（Sparkle adapter 内部重查后自动
///   reply(.install)，对上层透明）——72h 会话内重弹后点「立即下载」走此路径。
@MainActor
public protocol UpdateEngine: AnyObject {
    func check() async throws -> UpdateCandidate?
    func startDownload(
        _ candidate: UpdateCandidate,
        onProgress: @escaping @MainActor (UpdateDownloadProgress) -> Void
    ) async throws -> DownloadedUpdate
    func dismissPending()
    /// 调用方（UpdateController）保证已出弹窗回调栈（§4 立即重启）。
    func installAndRelaunch(_ update: DownloadedUpdate)
    func scheduleInstallOnQuit(_ update: DownloadedUpdate)
}

// MARK: - 弹窗（原生 NSAlert 生产实现在 MuxvoAppCore；测试/e2e 注入记录型替身，永不 runModal）

/// 弹窗请求：文案即断言面（auto-update.md §2/§4 逐字表）。buttons 顺序 = 展示顺序，[0] 为 default。
public struct UpdateDialogRequest: Equatable, Sendable {
    public let title: String
    public let message: String
    public let detail: String
    public let buttons: [String]
    public init(title: String, message: String, detail: String, buttons: [String]) {
        self.title = title
        self.message = message
        self.detail = detail
        self.buttons = buttons
    }
}

public enum UpdateAvailableChoice: Equatable, Sendable {
    case download   // 立即下载
    case snooze     // 暂不更新
    case mute       // 不再提醒此版本
}

public enum UpdateDownloadedChoice: Equatable, Sendable {
    case restartNow     // 立即重启
    case installOnQuit  // 下次启动时安装
}

@MainActor
public protocol UpdatePrompter: AnyObject {
    func promptAvailable(_ request: UpdateDialogRequest) async -> UpdateAvailableChoice
    func promptDownloaded(_ request: UpdateDialogRequest) async -> UpdateDownloadedChoice
}

// MARK: - 推送/呈现 sink

/// web 推送抽象（生产 = data.event updateXxx 广播，auto-update.md §9）。
public enum UpdateEvent: Equatable, Sendable {
    case checking
    case available(version: String)
    case notAvailable
    case downloading(percent: Double, transferred: Int, total: Int, bytesPerSecond: Int)
    case downloaded(version: String)
    case error
}

@MainActor
public protocol UpdateEventSink: AnyObject {
    func emit(_ event: UpdateEvent)
}

/// dock 图标进度条（legacy setProgressBar 对等）：fraction ∈ [0,1]；nil = 清除（-1 语义）。
@MainActor
public protocol UpdateDockProgressSink: AnyObject {
    func setFraction(_ fraction: Double?)
}

// MARK: - 去打扰持久化（生产 = config.json updateDismissal，auto-update.md §0）

public struct UpdateDismissal: Equatable, Codable, Sendable {
    public var version: String
    public var count: Int
    public init(version: String, count: Int) {
        self.version = version
        self.count = count
    }
}

@MainActor
public protocol UpdateDismissalStore: AnyObject {
    func load() -> UpdateDismissal?
    func save(_ dismissal: UpdateDismissal)
}

// MARK: - 时钟（全部时序经此注入，测试假时钟直进，任何测试不 sleep 真实秒级）

public protocol UpdateClockToken: AnyObject {
    func cancel()
}

@MainActor
public protocol UpdateClock: AnyObject {
    var now: Date { get }
    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> UpdateClockToken
}

// MARK: - 日志（生产 = logs/update.log，auto-update.md §0/§8）

public protocol UpdateLogging: AnyObject, Sendable {
    func info(_ message: String)
    func warn(_ message: String)
    func error(_ message: String)
    func debug(_ message: String)
}

// MARK: - 时序参数（auto-update.md §1；装配处可经 MUXVO_UPDATE_TIMINGS_MS 全套毫秒化）

public struct UpdateTimings: Sendable {
    /// 轮询间隔（偏差①：spec INSTALL_L2_01 = 21600000ms = 6h）。
    public var checkInterval: TimeInterval
    /// 「暂不更新」后会话内重弹延迟（legacy REMIND_INTERVALS = [72h]）。
    public var snoozeRepromptDelay: TimeInterval
    public init(checkInterval: TimeInterval = 6 * 3600, snoozeRepromptDelay: TimeInterval = 72 * 3600) {
        self.checkInterval = checkInterval
        self.snoozeRepromptDelay = snoozeRepromptDelay
    }
}
