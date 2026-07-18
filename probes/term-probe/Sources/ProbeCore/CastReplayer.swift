// CastReplayer：asciinema v2 .cast 回放器。
// - 按原时间轴或 ×N 加速（speed）把 "o" 事件字节灌进 TerminalSession.feed
// - feed 走会话串行队列 sync，自带背压（回放不会冲垮 vt）
// - loop 模式用于压测持续负载；oneByteChunks 模式按 1 字节切分灌入（乱码对抗）
// - 回放目标会话建议用隔离模式（spawnShell:false），内容即素材本身
import Dispatch
import Foundation

public final class CastReplayer: @unchecked Sendable {
    public struct Event: Sendable {
        public let t: Double
        public let bytes: [UInt8]
    }

    public let cols: UInt16
    public let rows: UInt16
    public let events: [Event]
    public let duration: Double

    private let stateLock = NSLock()
    private var cancelled = false
    private var thread: Thread?
    private var _bytesReplayed: UInt64 = 0

    public var bytesReplayed: UInt64 {
        stateLock.withLock { _bytesReplayed }
    }

    public init(path: String) throws {
        let content = try String(contentsOfFile: path, encoding: .utf8)
        var lines = content.split(separator: "\n", omittingEmptySubsequences: true)
        guard !lines.isEmpty else {
            throw ProbeError.spawnFailed("empty cast file \(path)")
        }
        let headerData = Data(lines.removeFirst().utf8)
        let header = (try? JSONSerialization.jsonObject(with: headerData)) as? [String: Any] ?? [:]
        self.cols = UInt16(header["width"] as? Int ?? 120)
        self.rows = UInt16(header["height"] as? Int ?? 40)

        var evs: [Event] = []
        evs.reserveCapacity(lines.count)
        for line in lines {
            guard let arr = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [Any],
                  arr.count >= 3,
                  let t = arr[0] as? Double,
                  let kind = arr[1] as? String, kind == "o",
                  let s = arr[2] as? String
            else { continue }
            evs.append(Event(t: t, bytes: Array(s.utf8)))
        }
        self.events = evs
        self.duration = evs.last?.t ?? 0
    }

    /// 后台线程回放。speed=10 即 ×10 加速；loop 到 stop() 为止。
    public func start(
        into session: TerminalSession,
        speed: Double = 1.0,
        loop: Bool = false,
        oneByteChunks: Bool = false
    ) {
        stateLock.withLock { cancelled = false }
        let t = Thread { [weak self, weak session] in
            guard let self else { return }
            repeat {
                let t0 = DispatchTime.now()
                for ev in self.events {
                    if self.isCancelled { return }
                    guard let session else { return }
                    let target = ev.t / max(speed, 0.001)
                    let elapsed = Double(DispatchTime.now().uptimeNanoseconds - t0.uptimeNanoseconds) / 1e9
                    let wait = target - elapsed
                    if wait > 0.0005 {
                        Thread.sleep(forTimeInterval: min(wait, 0.5))
                        if self.isCancelled { return }
                    }
                    if oneByteChunks {
                        LoadDriver.feedByteByByte(ev.bytes, into: session)
                    } else {
                        session.feed(ev.bytes)
                    }
                    self.stateLock.withLock { self._bytesReplayed += UInt64(ev.bytes.count) }
                }
            } while loop && !self.isCancelled
        }
        t.name = "muxvo.probe.cast-replay"
        thread = t
        t.start()
    }

    private var isCancelled: Bool {
        stateLock.withLock { cancelled }
    }

    public func stop() {
        stateLock.withLock { cancelled = true }
    }
}
