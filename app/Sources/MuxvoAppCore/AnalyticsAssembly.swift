// 埋点装配（analytics.md §1/§2；埋点批2）：AppDelegate 单实例持有——tracker 构建（启用门/信封/
// device-id/bearer）+ 桥 onTelemetry 落点 + Swift 原生事件便捷入口。未启用（dev/test 天然无
// Info.plist 键）→ tracker 全 no-op 零网络，装配代码无分支照常挂线。
import Foundation
import MuxvoAnalytics
import MuxvoAuth
import MuxvoBridge

@MainActor
final class AnalyticsAssembly {
    let tracker: AnalyticsTracker
    private let launchDate = Date()

    /// - Parameter dataRoot: 分身数据根（device-id 落 state/ 下，每数据根一个——测试分身天然隔离）。
    init(dataRoot: URL, env: [String: String] = ProcessInfo.processInfo.environment) {
        let plistFlag = (Bundle.main.object(forInfoDictionaryKey: "MuxvoAnalyticsEnabled") as? Bool) ?? false
        var enabled = AnalyticsGate.isEnabled(infoPlistFlag: plistFlag, env: env)

        let stateDir = dataRoot.appendingPathComponent("state", isDirectory: true)
        var identity: DeviceIdentity?
        if enabled {
            identity = try? AnalyticsDeviceID.loadOrCreate(stateDirectory: stateDir)
            if identity == nil { enabled = false } // device-id 不可持久 → 禁用（宁缺勿污染）
        }

        let osv = ProcessInfo.processInfo.operatingSystemVersion
        let tokenStore = AuthTokenStore(fileURL: dataRoot.appendingPathComponent("auth-token.json"))
        tracker = AnalyticsTracker(
            client: AnalyticsClient(env: env, bearerProvider: { tokenStore.load()?.tokens.accessToken }),
            deviceID: identity?.id ?? "disabled",
            envelope: [
                "app": "muxvo2",
                "v": AppInfo.shortVersion,
                "os": "\(osv.majorVersion).\(osv.minorVersion).\(osv.patchVersion)",
            ],
            enabled: enabled,
            clock: TimerAnalyticsClock())
        tracker.start()
        if identity?.isNew == true {
            tracker.track("app.first_launch") // 设备首建恰一次（AN_device_id_first_new）
        }
    }

    // MARK: - 便捷入口（analytics.md §1 事件表）

    func track(_ metric: String, value: Double? = nil, params: [String: String] = [:]) {
        tracker.track(metric, value: value, params: params)
    }

    /// 桥 telemetry 落点（web L4 事件）：KeyValue[] → params 字典（信封仍由 tracker 合入）。
    func handleBridgeTelemetry(_ event: TelemetryEvent) {
        var params: [String: String] = [:]
        for kv in event.params ?? [] { params[kv.key] = kv.value }
        tracker.track(event.metric, value: event.value, params: params)
    }

    /// 退出收口（performShutdown 串联；analytics.md §3）：入队 app.quit(uptime_min) → 限时 2s flush。
    func flushForQuit() async {
        let uptimeMin = (Date().timeIntervalSince(launchDate) / 60).rounded()
        tracker.track("app.quit", value: uptimeMin)
        await tracker.flushNow(deadline: 2)
    }

    // MARK: - 编排嗅探（analytics.md L3；stateSink 包装，埋点绝不改变推送行为）


    // MARK: - 登录嗅探（analytics.md L5；onStatusChanged 包装）

    /// nil = 启动恢复期（tryRestoreSession 未完），期间状态变更不计——恢复登录态 ≠ 用户登录动作。
    private var authObservedLoggedIn: Bool?

    /// tryRestoreSession 完成后启用观测（AppDelegate 串在恢复 Task 尾）。
    func beginAuthObservation(initialLoggedIn: Bool) {
        if authObservedLoggedIn == nil { authObservedLoggedIn = initialLoggedIn }
    }

    func noteAuthStatus(loggedIn: Bool, provider: String?) {
        guard let last = authObservedLoggedIn else { return }
        authObservedLoggedIn = loggedIn
        if !last, loggedIn {
            track("auth.login", params: provider.map { ["provider": $0] } ?? [:])
        } else if last, !loggedIn {
            track("auth.logout")
        }
    }

}

/// 生产时钟：Timer 单发（主 run loop；tracker 自续租，同 ManualAnalyticsClock 语义）。
@MainActor
final class TimerAnalyticsClock: AnalyticsClock {
    private final class Token: AnalyticsClockToken {
        weak var timer: Timer?
        init(_ timer: Timer) { self.timer = timer }
        func cancel() { timer?.invalidate() }
    }

    var now: Date { Date() }

    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> AnalyticsClockToken {
        let timer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { _ in
            Task { @MainActor in body() }
        }
        return Token(timer)
    }
}
