// 洞 rect 清单存储（web 上报的 layoutReport 落点）。线程安全：JS 消息在主线程回调写入，
// hitTest 在主线程读取——但仍加锁以防未来后台访问，且提供 detach 期一致快照。
// rect 以 CSS 坐标（左上原点、CSS px）存储；命中判定时由调用方把 AppKit（左下原点）
// 坐标翻转为 CSS 再比对（CSS px ≡ AppKit point，契约见设计附件 §3.3）。
import Foundation

struct HoleRect {
    let idx: Int
    let x: Double, y: Double, w: Double, h: Double // CSS 左上
    func contains(cssX: Double, cssY: Double) -> Bool {
        cssX >= x && cssX < x + w && cssY >= y && cssY < y + h
    }
}

final class HoleStore {
    private let lock = NSLock()
    private var rects: [HoleRect] = []
    private(set) var modal = false
    private(set) var lastStateId = 0
    private(set) var lastReportTS = DispatchTime.now()
    private(set) var reportCount = 0

    func update(stateId: Int, rects: [HoleRect], modal: Bool) {
        lock.withLock {
            self.rects = rects
            self.modal = modal
            self.lastStateId = stateId
            self.lastReportTS = DispatchTime.now()
            self.reportCount += 1
        }
    }

    /// 洞命中：空清单（modal/整屏切换）恒 false = 全部停穿透。
    func containsCSS(x: Double, y: Double) -> Bool {
        lock.withLock { rects.contains { $0.contains(cssX: x, cssY: y) } }
    }

    func snapshot() -> (rects: [HoleRect], modal: Bool, stateId: Int) {
        lock.withLock { (rects, modal, lastStateId) }
    }

    func holeCenterCSS(idx: Int) -> (x: Double, y: Double)? {
        lock.withLock {
            guard let r = rects.first(where: { $0.idx == idx }) else { return nil }
            return (r.x + r.w / 2, r.y + r.h / 2)
        }
    }
}
