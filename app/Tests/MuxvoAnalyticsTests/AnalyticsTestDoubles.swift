// MuxvoAnalytics 测试替身（analytics.md §5 AN_*）：假 transport 永不打真网 + 手动时钟不 sleep 真实秒级。
import Foundation
@testable import MuxvoAnalytics

/// MainActor 泵（仿 MuxvoUpdaterTests settle）：tracker 内部 Task 均在 MainActor，泵若干 yield 即定。
@MainActor
func settle(_ rounds: Int = 25) async {
    for _ in 0..<rounds { await Task.yield() }
}

/// 记录型假 transport：按序出队预置 status（耗尽后重复最后一个）；可挂起模拟慢网。
final class FakeAnalyticsTransport: AnalyticsTransport, @unchecked Sendable {
    /// body 存原始 Data（[String: Any] 非 Sendable），events 惰性解析。
    struct Seen: Sendable {
        let url: String
        let headers: [String: String]
        let bodyData: Data

        var body: [String: Any] {
            (try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any]) ?? [:]
        }
        var events: [[String: Any]] { body["events"] as? [[String: Any]] ?? [] }
    }

    private let lock = NSLock()
    private var statuses: [Int]
    private let hang: Bool
    private var _seen: [Seen] = []

    init(statuses: [Int] = [200], hang: Bool = false) {
        self.statuses = statuses
        self.hang = hang
    }

    var seen: [Seen] { lock.withLock { _seen } }
    var requestCount: Int { seen.count }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        if hang {
            // 可取消挂起（AN_quit_flush_deadline：deadline 到点 cancelAll 收割）。
            try await Task.sleep(nanoseconds: 30_000_000_000)
        }
        var headers: [String: String] = [:]
        for (k, v) in request.allHTTPHeaderFields ?? [:] { headers[k] = v }
        let bodyData = request.httpBody ?? Data()
        let status: Int = lock.withLock {
            _seen.append(Seen(url: request.url?.absoluteString ?? "", headers: headers, bodyData: bodyData))
            return statuses.count > 1 ? statuses.removeFirst() : (statuses.first ?? 200)
        }
        return (Data("{}".utf8), status)
    }
}

/// 手动时钟（仿 MuxvoUpdaterTests ManualUpdateClock）：快进按到期序执行。
@MainActor
final class ManualAnalyticsClock: AnalyticsClock {
    final class Token: AnalyticsClockToken {
        var cancelled = false
        func cancel() { cancelled = true }
    }
    private struct Job {
        let dueAt: Date
        let token: Token
        let body: @MainActor () -> Void
    }

    private(set) var current = Date(timeIntervalSince1970: 1_700_000_000)
    private var jobs: [Job] = []
    var now: Date { current }

    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> AnalyticsClockToken {
        let token = Token()
        jobs.append(Job(dueAt: current.addingTimeInterval(seconds), token: token, body: body))
        return token
    }

    func advance(by seconds: TimeInterval) async {
        current = current.addingTimeInterval(seconds)
        while let index = jobs.firstIndex(where: { $0.dueAt <= current && !$0.token.cancelled }) {
            let job = jobs.remove(at: index)
            job.body()
            await settle()
        }
        jobs.removeAll { $0.token.cancelled }
        await settle()
    }

    var pendingJobCount: Int { jobs.filter { !$0.token.cancelled }.count }
}
