// HTTP transport 接缝（右上角批 B5）：生产 URLSession，测试注入假体（永不打真网）。
import Foundation

public protocol AuthTransport: Sendable {
    /// 发请求返回 (body, http status)。传输层失败（断网/DNS/超时）→ throw（上层归一 AUTH_NETWORK）。
    func send(_ request: URLRequest) async throws -> (Data, Int)
}

/// 生产实现：URLSession 短连接（15s 超时，legacy backend-client AbortController 同窗）。
public struct URLSessionTransport: AuthTransport {
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
