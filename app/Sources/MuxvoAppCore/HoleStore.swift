// 洞清单存储（web 上报的 layoutReport rects 落点）——C 案 hitTest 穿透的唯一真值源。
//
// rects 以 CSS 坐标（左上原点、CSS px）存储；命中判定由调用方把 AppKit（左下原点）坐标
// 翻转为 CSS 再比对（CSS px ≡ AppKit point，契约见 M3 设计附件 B §3.3）。
// 线程安全：layoutReport 在主线程回调写入、hitTest 在主线程读取，仍加锁以防未来后台访问。
//
// 洞（role != island）= 穿透区；岛（role == island）= 洞上浮着的 web 交互元素（FAB 等），
// 从穿透区“抠掉”不穿透（否则点击被下层终端吞掉，dogfood P0）。穿透判定 = 点在任一 visible 洞内
// **且不在任一 visible 岛内**。
//
// 空清单 / 全部 visible=false = 恒不穿透 = 全部事件命中上层 web。语义澄清（DOGFOOD_M3_04）：
// 空 rects 仅用于「有洞→无洞」整屏过渡（native 随即 detach 全部 surface），**不用于浮层挂起**；
// 浮层遮挡走岛约定——盖在洞矩形上的 live 交互浮层挂 data-hit-island、modal 挂全窗 backdrop 岛
// （半透明 backdrop 下若走空 rects 会 detach 终端画面 + 重 attach 抖动，故否决，设计附件 B §1.2）。
import Foundation
import MuxvoBridge

final class HoleStore {
    private let lock = NSLock()
    private var holes: [TermRect] = []
    private var islands: [TermRect] = []
    private(set) var lastStateId: String = ""

    /// 消费一条 layoutReport：整表替换（snapshot 语义），按 role 分洞与岛。
    func update(stateId: String, rects: [TermRect]) {
        lock.withLock {
            self.holes = rects.filter { $0.role != .island }
            self.islands = rects.filter { $0.role == .island }
            self.lastStateId = stateId
        }
    }

    /// 穿透判定：点（CSS 左上坐标）落在任一 **visible** 洞内且不在任一 **visible** 岛内 → true。
    /// 空清单 / 全隐藏 / 命中岛 → false（浮层或 FAB 挂起，停穿透，命中 web）。
    func containsCSS(x: Double, y: Double) -> Bool {
        lock.withLock {
            holes.contains { Self.hit($0, x, y) } && !islands.contains { Self.hit($0, x, y) }
        }
    }

    /// 命中点落在哪个洞的 terminalId（据当前 holes；焦点交接用）。多洞重叠取首个 visible。岛不含终端。
    func terminalId(atCSSX x: Double, y: Double) -> String? {
        lock.withLock { holes.first { Self.hit($0, x, y) }?.terminalId }
    }

    func snapshot() -> [TermRect] { lock.withLock { holes + islands } }

    private static func hit(_ r: TermRect, _ x: Double, _ y: Double) -> Bool {
        r.visible && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
    }
}
