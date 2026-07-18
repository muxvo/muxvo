// WaitEventBus：等待事件多订阅总线（wait-detector.md §0 共享接缝）。
//
// M3 唯一订阅者 = WaitDetectorHub；M4a 编排引擎作**第二订阅者**消费同一事件流喂 wait_entered
// （task-state-machine.md §3）。事件形状冻结（WaitEvent，§0），本总线不改形状只做多播。
//
// 时钟：WaitEvent.ts 由生产者按单一 epoch ms 时钟（WaitClock）打戳后 publish；总线不改 ts。
// 并发：publish 可来自任意线程（socket 后台队列 / 主线程 / 轮询）；每订阅者在其登记的 deliverOn
// 队列上收事件（订阅者各自选队列，互不阻塞）。
import Dispatch
import Foundation

public final class WaitEventBus: @unchecked Sendable {
    /// 移除订阅用 token。
    public struct Token: Hashable, Sendable { fileprivate let id: UInt64 }

    private struct Subscriber {
        let deliverOn: DispatchQueue
        let handler: @Sendable (WaitEvent) -> Void
    }

    private let lock = NSLock()
    private var subscribers: [UInt64: Subscriber] = [:]
    private var nextToken: UInt64 = 0
    private var publishedCount: UInt64 = 0

    public init() {}

    /// 登记订阅：事件在 `deliverOn` 队列上投递。返回移除 token。
    @discardableResult
    public func subscribe(
        deliverOn: DispatchQueue,
        _ handler: @escaping @Sendable (WaitEvent) -> Void
    ) -> Token {
        lock.lock(); defer { lock.unlock() }
        let id = nextToken
        nextToken &+= 1
        subscribers[id] = Subscriber(deliverOn: deliverOn, handler: handler)
        return Token(id: id)
    }

    /// 注销订阅（幂等）。
    public func unsubscribe(_ token: Token) {
        lock.lock(); defer { lock.unlock() }
        subscribers.removeValue(forKey: token.id)
    }

    /// 多播一个事件到全部订阅者（各自 deliverOn 队列 async 投递）。
    public func publish(_ event: WaitEvent) {
        lock.lock()
        publishedCount &+= 1
        let snapshot = Array(subscribers.values)
        lock.unlock()
        for sub in snapshot {
            sub.deliverOn.async { sub.handler(event) }
        }
    }

    /// 已发布事件总数（观测/测试用）。
    public var totalPublished: UInt64 { lock.lock(); defer { lock.unlock() }; return publishedCount }
    /// 当前订阅者数（测试用）。
    public var subscriberCount: Int { lock.lock(); defer { lock.unlock() }; return subscribers.count }
}
