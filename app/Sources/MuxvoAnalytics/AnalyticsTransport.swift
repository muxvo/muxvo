// 埋点接缝（specs/behavior/analytics.md §2/§3）：HTTP transport / 时钟 / 启用门。
// 生产 URLSession，测试注入假体（永不打真网）；时钟全注入，任何测试不 sleep 真实秒级。
import Foundation

public protocol AnalyticsTransport: Sendable {
    /// 发请求返回 (body, http status)。传输层失败（断网/DNS/超时）→ throw（tracker 归一「留 buffer 重试」）。
    func send(_ request: URLRequest) async throws -> (Data, Int)
}

/// 生产实现：URLSession 短连接（15s 超时，同 MuxvoAuth URLSessionTransport）。
public struct URLSessionAnalyticsTransport: AnalyticsTransport {
    private let session: URLSession

    public init() {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 15
        session = URLSession(configuration: cfg)
    }

    public func send(_ request: URLRequest) async throws -> (Data, Int) {
        let (data, resp) = try await session.data(for: request)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        return (data, status)
    }
}

// MARK: - 时钟（同 MuxvoUpdater UpdateClock 形；不依赖该 target 避免语义耦合）

public protocol AnalyticsClockToken: AnyObject {
    func cancel()
}

@MainActor
public protocol AnalyticsClock: AnyObject {
    var now: Date { get }
    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> AnalyticsClockToken
}

// MARK: - 启用门（analytics.md §2：dev/test 绝不向生产上报）

public enum AnalyticsGate {
    /// env `MUXVO_ANALYTICS=0` 强制关；`=1` 强制开（本地验证配 MUXVO_API_URL 指本地）；
    /// 否则取 Info.plist `MuxvoAnalyticsEnabled`（仅 release bundle 注入）。
    public static func isEnabled(infoPlistFlag: Bool, env: [String: String]) -> Bool {
        switch env["MUXVO_ANALYTICS"] {
        case "0": return false
        case "1": return true
        default: return infoPlistFlag
        }
    }
}
