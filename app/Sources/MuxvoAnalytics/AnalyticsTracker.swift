// 埋点 tracker（analytics.md §2/§3）：内存 buffer + 60s/≥50 批量 flush + 10min 心跳 + 退出限时 flush。
// enabled=false 全 no-op 零网络；无磁盘队列（进程死亡丢未 flush 事件=可接受损耗）。
import Foundation

@MainActor
public final class AnalyticsTracker {
    public struct Config: Sendable {
        public var flushInterval: TimeInterval = 60
        public var heartbeatInterval: TimeInterval = 600
        public var flushThreshold: Int = 50
        public var batchLimit: Int = 100   // 服务端单批上限
        public var bufferCap: Int = 500    // 超出 drop-oldest

        public init() {}
    }

    private let client: AnalyticsClient
    private let deviceID: String
    private let envelope: [String: String]
    private let enabled: Bool
    private let clock: AnalyticsClock
    private let config: Config

    private var buffer: [AnalyticsEvent] = []
    private var flushing = false
    private var started = false
    private var flushToken: AnalyticsClockToken?
    private var heartbeatToken: AnalyticsClockToken?

    /// - Parameters:
    ///   - envelope: 公共信封（app/v/os 三键，analytics.md §0）；track() 的同名 params 被其覆盖。
    ///   - enabled: AnalyticsGate.isEnabled 判定结果；false → 全 no-op。
    public init(
        client: AnalyticsClient,
        deviceID: String,
        envelope: [String: String],
        enabled: Bool,
        clock: AnalyticsClock,
        config: Config = Config()
    ) {
        self.client = client
        self.deviceID = deviceID
        self.envelope = envelope
        self.enabled = enabled
        self.clock = clock
        self.config = config
    }

    // MARK: - 生命周期

    /// 启动 60s flush 与 10min 心跳定时（幂等；未启用 no-op）。
    public func start() {
        guard enabled, !started else { return }
        started = true
        scheduleFlushTick()
        scheduleHeartbeatTick()
    }

    public func stop() {
        flushToken?.cancel()
        heartbeatToken?.cancel()
        flushToken = nil
        heartbeatToken = nil
        started = false
    }

    // MARK: - 入队

    public func track(_ metric: String, value: Double? = nil, params: [String: String] = [:]) {
        guard enabled else { return }
        // 信封覆盖调用方同名键（AN_envelope_merge）。
        let metadata = params.merging(envelope) { _, envelopeValue in envelopeValue }
        buffer.append(AnalyticsEvent(metric: metric, value: value, metadata: metadata))
        if buffer.count > config.bufferCap {
            buffer.removeFirst(buffer.count - config.bufferCap)
        }
        if buffer.count >= config.flushThreshold {
            Task { await self.flush() }
        }
    }

    // MARK: - flush

    /// 一轮 flush：循环发批直到 buffer 空或失败（analytics.md §3）。防重入。
    public func flush() async {
        guard enabled, !flushing else { return }
        flushing = true
        defer { flushing = false }
        while !buffer.isEmpty {
            let batch = Array(buffer.prefix(config.batchLimit))
            let outcome = await client.send(batch, deviceID: deviceID)
            switch outcome {
            case .ok, .rejected:
                // rejected（4xx）与成功同样移除：丢批不重试。
                buffer.removeFirst(min(batch.count, buffer.count))
            case .failed:
                return // 整批留 buffer 下轮重试
            }
        }
    }

    /// 退出前限时 flush（analytics.md §3）：超 deadline 即返回不悬挂、不阻塞退出。
    /// 不用 task group race：group 退出前隐式 drain children，而 await task.value 不响应取消——
    /// transport 一挂起就等满全程。continuation + 单次 resume 绝对有界，不依赖 transport 可取消性。
    public func flushNow(deadline: TimeInterval) async {
        guard enabled else { return }
        let gate = SingleResumeGate()
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            let flushTask = Task {
                await self.flush()
                gate.resume(cont)
            }
            Task.detached {
                try? await Task.sleep(nanoseconds: UInt64(max(0, deadline) * 1_000_000_000))
                flushTask.cancel() // 尽力收割慢 transport（可取消 sleep/URLSession）
                gate.resume(cont)
            }
        }
    }

    // MARK: - 定时

    private func scheduleFlushTick() {
        flushToken = clock.schedule(after: config.flushInterval) { [weak self] in
            guard let self, self.started else { return }
            Task { await self.flush() }
            self.scheduleFlushTick()
        }
    }

    private func scheduleHeartbeatTick() {
        heartbeatToken = clock.schedule(after: config.heartbeatInterval) { [weak self] in
            guard let self, self.started else { return }
            self.track("app.heartbeat")
            self.scheduleHeartbeatTick()
        }
    }

    // MARK: - 测试探针

    public var pendingCount: Int { buffer.count }
    public var pendingEvents: [AnalyticsEvent] { buffer }
}

/// flushNow 的一次性放行闸：完成/超时两路谁先到谁 resume，后到 no-op。
private final class SingleResumeGate: @unchecked Sendable {
    private let lock = NSLock()
    private var resumed = false

    func resume(_ cont: CheckedContinuation<Void, Never>) {
        lock.withLock {
            guard !resumed else { return }
            resumed = true
            cont.resume()
        }
    }
}
