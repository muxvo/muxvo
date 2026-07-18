// 埋点上报 client（analytics.md §0/§3）：POST {MUXVO_API_URL ?? api.muxvo.com}/analytics/track，
// 批量信封对齐 legacy server/src/routes/analytics.ts（X-Device-ID 必填 + Bearer 可选）。
import Foundation

/// 一条待发事件（metadata 已含公共信封，tracker 入队时合成）。
public struct AnalyticsEvent: Equatable, Sendable {
    public var metric: String
    public var value: Double?
    public var metadata: [String: String]

    public init(metric: String, value: Double? = nil, metadata: [String: String] = [:]) {
        self.metric = metric
        self.value = value
        self.metadata = metadata
    }
}

/// 单批发送结局（tracker 据此决定移除/丢弃/重试，analytics.md §3）。
public enum AnalyticsSendOutcome: Equatable, Sendable {
    case ok        // 2xx → 移除已发
    case rejected  // 4xx → 丢批不重试（schema 被拒重试无意义）
    case failed    // 网络失败/5xx → 留 buffer 下轮重试
}

public struct AnalyticsClient: Sendable {
    public let baseURL: URL
    private let transport: any AnalyticsTransport
    private let bearerProvider: @Sendable () -> String?

    public init(
        baseURL: URL? = nil,
        transport: any AnalyticsTransport = URLSessionAnalyticsTransport(),
        env: [String: String] = ProcessInfo.processInfo.environment,
        bearerProvider: @escaping @Sendable () -> String? = { nil }
    ) {
        self.baseURL = baseURL
            ?? env["MUXVO_API_URL"].flatMap { URL(string: $0) }
            ?? URL(string: "https://api.muxvo.com")!
        self.transport = transport
        self.bearerProvider = bearerProvider
    }

    /// 发一批（调用方保证 1...100 条）。不 throw：一切失败归一到 outcome。
    public func send(_ events: [AnalyticsEvent], deviceID: String) async -> AnalyticsSendOutcome {
        var req = URLRequest(url: baseURL.appendingPathComponent("/analytics/track"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(deviceID, forHTTPHeaderField: "X-Device-ID")
        if let bearer = bearerProvider() {
            req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        let items: [[String: Any]] = events.map { e in
            var obj: [String: Any] = ["metric": e.metric, "metadata": e.metadata]
            if let v = e.value { obj["value"] = v }
            return obj
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["events": items])

        do {
            let (_, status) = try await transport.send(req)
            switch status {
            case 200...299: return .ok
            case 400...499: return .rejected
            default: return .failed
            }
        } catch {
            return .failed
        }
    }
}
