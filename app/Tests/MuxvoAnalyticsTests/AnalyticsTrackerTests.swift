// AnalyticsTracker/Client/DeviceID/Gate 直测（specs/behavior/analytics.md §5 AN_* 案例池，
// spec-coverage 强制 1:1）。假 transport + 手动时钟，只碰 $TMPDIR。
import Foundation
import Testing
@testable import MuxvoAnalytics

@Suite("Analytics 内核（批1）", .serialized)
@MainActor
struct AnalyticsTrackerTests {

    private static let envelope = ["app": "muxvo2", "v": "1.0.0", "os": "15.5.0"]

    private func makeTracker(
        transport: FakeAnalyticsTransport,
        clock: ManualAnalyticsClock,
        enabled: Bool = true,
        bearer: (@Sendable () -> String?)? = nil,
        config: AnalyticsTracker.Config = .init()
    ) -> AnalyticsTracker {
        let client = AnalyticsClient(
            baseURL: URL(string: "http://analytics.test")!,
            transport: transport,
            bearerProvider: bearer ?? { nil })
        return AnalyticsTracker(
            client: client, deviceID: "dev-42", envelope: Self.envelope,
            enabled: enabled, clock: clock, config: config)
    }

    private func makeTempDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-analytics-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // MARK: 信封

    @Test("AN_envelope_merge: metadata 恒含 app/v/os 三键，调用方同名 params 被信封覆盖")
    func envelopeMerge() async throws {
        let transport = FakeAnalyticsTransport()
        let tracker = makeTracker(transport: transport, clock: ManualAnalyticsClock())
        tracker.track("term.created", params: ["source": "menu", "app": "spoof", "os": "fake"])
        await tracker.flush()
        let events = try #require(transport.seen.first).events
        #expect(events.count == 1)
        let meta = events[0]["metadata"] as? [String: String]
        #expect(meta?["app"] == "muxvo2")
        #expect(meta?["v"] == "1.0.0")
        #expect(meta?["os"] == "15.5.0")
        #expect(meta?["source"] == "menu")
    }

    // MARK: device id

    @Test("AN_device_id_persist: 同目录两次 loadOrCreate → 同 UUID，第二次 isNew=false")
    func deviceIDPersist() async throws {
        let dir = try makeTempDir()
        let first = try AnalyticsDeviceID.loadOrCreate(stateDirectory: dir)
        let second = try AnalyticsDeviceID.loadOrCreate(stateDirectory: dir)
        #expect(first.id == second.id)
        #expect(second.isNew == false)
    }

    @Test("AN_device_id_first_new: 首建返回 isNew=true（装配层据此恰发一次 app.first_launch）")
    func deviceIDFirstNew() async throws {
        let dir = try makeTempDir()
        let identity = try AnalyticsDeviceID.loadOrCreate(stateDirectory: dir)
        #expect(identity.isNew == true)
        #expect(UUID(uuidString: identity.id) != nil)
    }

    @Test("AN_device_id_corrupt_regen: 文件内容非 UUID → 重生成新 id 且 isNew=true")
    func deviceIDCorruptRegen() async throws {
        let dir = try makeTempDir()
        let url = dir.appendingPathComponent("analytics-device-id")
        try Data("not-a-uuid".utf8).write(to: url)
        let identity = try AnalyticsDeviceID.loadOrCreate(stateDirectory: dir)
        #expect(identity.isNew == true)
        #expect(UUID(uuidString: identity.id) != nil)
        // 落盘为新 id，下次稳定复读。
        let again = try AnalyticsDeviceID.loadOrCreate(stateDirectory: dir)
        #expect(again.id == identity.id)
        #expect(again.isNew == false)
    }

    // MARK: 批量与节律

    @Test("AN_flush_60s: 假钟推进 60s → 恰一次 POST /analytics/track，body 含入队事件")
    func flushOn60s() async throws {
        let transport = FakeAnalyticsTransport()
        let clock = ManualAnalyticsClock()
        let tracker = makeTracker(transport: transport, clock: clock)
        tracker.start()
        tracker.track("app.launch")
        #expect(transport.requestCount == 0)
        await clock.advance(by: 60)
        #expect(transport.requestCount == 1)
        let first = try #require(transport.seen.first)
        #expect(first.url.hasSuffix("/analytics/track"))
        #expect(first.events.map { $0["metric"] as? String } == ["app.launch"])
    }

    @Test("AN_flush_threshold_50: 入队第 50 条立即触发 flush（不等 60s 定时）")
    func flushOnThreshold() async throws {
        let transport = FakeAnalyticsTransport()
        let tracker = makeTracker(transport: transport, clock: ManualAnalyticsClock())
        tracker.start()
        for i in 1...49 { tracker.track("e\(i)") }
        await settle()
        #expect(transport.requestCount == 0)
        tracker.track("e50")
        await settle()
        #expect(transport.requestCount == 1)
        #expect(try #require(transport.seen.first).events.count == 50)
    }

    @Test("AN_batch_limit_100: pending 120 条 → 单次 POST ≤100 条，余量随后续批次发出")
    func batchLimit() async throws {
        let transport = FakeAnalyticsTransport()
        var config = AnalyticsTracker.Config()
        config.flushThreshold = 1000 // 关阈值触发，手动 flush 观察分批
        let tracker = makeTracker(transport: transport, clock: ManualAnalyticsClock(), config: config)
        for i in 1...120 { tracker.track("e\(i)") }
        await tracker.flush()
        #expect(transport.requestCount == 2)
        try #require(transport.requestCount == 2)
        #expect(transport.seen[0].events.count == 100)
        #expect(transport.seen[1].events.count == 20)
        #expect(tracker.pendingCount == 0)
    }

    @Test("AN_flush_fail_retain: 网络失败 → 留 buffer；下轮成功后清空且不丢不重")
    func failRetain() async throws {
        let transport = FakeAnalyticsTransport(statuses: [500, 200])
        let tracker = makeTracker(transport: transport, clock: ManualAnalyticsClock())
        tracker.track("a")
        tracker.track("b")
        await tracker.flush()
        #expect(tracker.pendingCount == 2) // 5xx 整批留存
        await tracker.flush()
        #expect(tracker.pendingCount == 0)
        try #require(transport.requestCount == 2)
        // 两次请求同一批内容（不丢不重）。
        #expect(transport.seen[0].events.map { $0["metric"] as? String }
            == transport.seen[1].events.map { $0["metric"] as? String })
    }

    @Test("AN_flush_4xx_drop: 400 响应 → 该批丢弃，后续 flush 不再重发")
    func rejectedDrop() async throws {
        let transport = FakeAnalyticsTransport(statuses: [400])
        let tracker = makeTracker(transport: transport, clock: ManualAnalyticsClock())
        tracker.track("bad")
        await tracker.flush()
        #expect(tracker.pendingCount == 0)
        await tracker.flush()
        #expect(transport.requestCount == 1) // 无重发
    }

    @Test("AN_buffer_cap_500: 累积 601 条 → buffer ≤500 且丢最旧（最新保留）")
    func bufferCap() async throws {
        let transport = FakeAnalyticsTransport(statuses: [500]) // 恒失败：只涨不清
        var config = AnalyticsTracker.Config()
        config.flushThreshold = 10_000 // 关阈值触发
        let tracker = makeTracker(transport: transport, clock: ManualAnalyticsClock(), config: config)
        for i in 1...601 { tracker.track("e\(i)") }
        #expect(tracker.pendingCount == 500)
        #expect(tracker.pendingEvents.first?.metric == "e102") // 1-101 被挤出
        #expect(tracker.pendingEvents.last?.metric == "e601")
    }

    @Test("AN_heartbeat_10min: 假钟推进 10min → 恰一条 app.heartbeat；再 10min → 第二条")
    func heartbeat() async throws {
        let transport = FakeAnalyticsTransport()
        let clock = ManualAnalyticsClock()
        var config = AnalyticsTracker.Config()
        config.flushInterval = 100_000 // 隔离 flush 定时，只观察心跳入队
        let tracker = makeTracker(transport: transport, clock: clock, config: config)
        tracker.start()
        await clock.advance(by: 600)
        #expect(tracker.pendingEvents.map(\.metric) == ["app.heartbeat"])
        await clock.advance(by: 600)
        #expect(tracker.pendingEvents.map(\.metric) == ["app.heartbeat", "app.heartbeat"])
    }

    // MARK: 门

    @Test("AN_disabled_noop: enabled=false → track/start/flushNow 零 transport 调用零定时任务")
    func disabledNoop() async throws {
        let transport = FakeAnalyticsTransport()
        let clock = ManualAnalyticsClock()
        let tracker = makeTracker(transport: transport, clock: clock, enabled: false)
        tracker.start()
        tracker.track("app.launch")
        await tracker.flush()
        await tracker.flushNow(deadline: 0.1)
        await clock.advance(by: 3600)
        #expect(transport.requestCount == 0)
        #expect(tracker.pendingCount == 0)
        #expect(clock.pendingJobCount == 0)
    }

    @Test("AN_gate_env_override: env=1 无 plist 也开；env=0 有 plist 也关；无 env 依 plist")
    func gateEnvOverride() async throws {
        #expect(AnalyticsGate.isEnabled(infoPlistFlag: false, env: ["MUXVO_ANALYTICS": "1"]) == true)
        #expect(AnalyticsGate.isEnabled(infoPlistFlag: true, env: ["MUXVO_ANALYTICS": "0"]) == false)
        #expect(AnalyticsGate.isEnabled(infoPlistFlag: true, env: [:]) == true)
        #expect(AnalyticsGate.isEnabled(infoPlistFlag: false, env: [:]) == false)
    }

    // MARK: 退出 flush

    @Test("AN_quit_flush_deadline: transport 挂起 → 按 deadline 时限返回不悬挂")
    func quitFlushDeadline() async throws {
        let transport = FakeAnalyticsTransport(hang: true)
        let tracker = makeTracker(transport: transport, clock: ManualAnalyticsClock())
        tracker.track("app.quit", value: 12)
        let began = Date()
        await tracker.flushNow(deadline: 0.05)
        #expect(Date().timeIntervalSince(began) < 2.0) // 远小于挂起的 30s
    }

    // MARK: 请求头

    @Test("AN_bearer_optional: bearerProvider 有值 → Authorization: Bearer；nil → 无该头")
    func bearerOptional() async throws {
        let withToken = FakeAnalyticsTransport()
        let t1 = makeTracker(transport: withToken, clock: ManualAnalyticsClock(), bearer: { "tok-1" })
        t1.track("a")
        await t1.flush()
        #expect(try #require(withToken.seen.first).headers["Authorization"] == "Bearer tok-1")

        let noToken = FakeAnalyticsTransport()
        let t2 = makeTracker(transport: noToken, clock: ManualAnalyticsClock())
        t2.track("a")
        await t2.flush()
        #expect(try #require(noToken.seen.first).headers["Authorization"] == nil)
    }

    @Test("AN_device_header: 每次 POST 带 X-Device-ID 头 = 注入的 device_id")
    func deviceHeader() async throws {
        let transport = FakeAnalyticsTransport()
        let tracker = makeTracker(transport: transport, clock: ManualAnalyticsClock())
        tracker.track("a")
        await tracker.flush()
        #expect(try #require(transport.seen.first).headers["X-Device-ID"] == "dev-42")
    }
}
