// RenderCoordinator / TerminalFrameSnapshot 验收（批 2②；行为规格 terminal-rendering.md §7）。
// 全部走 spawnShell:false 隔离会话 + 快照检查，无 GUI、无 Metal。
// 命名纪律：本批无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import Darwin
import Dispatch
import Foundation
import Testing
@testable import MuxvoTerm

// 轮询直到 cond() 成立或超时。
private func waitUntil(timeout: TimeInterval = 5, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return true }
        usleep(2_000)
    }
    return cond()
}

// 线程安全快照盒（观察者投递记录）。
private final class SnapshotBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: TerminalFrameSnapshot?
    func set(_ v: TerminalFrameSnapshot) { lock.withLock { value = v } }
    func get() -> TerminalFrameSnapshot? { lock.withLock { value } }
}

// 线程安全布尔（draw 线程停机旗标）。
private final class AtomicFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var v: Bool
    init(_ initial: Bool) { v = initial }
    func get() -> Bool { lock.withLock { v } }
    func set(_ nv: Bool) { lock.withLock { v = nv } }
}

@Suite("RenderCoordinator 合同①：render state 归会话、多视图共读")
struct RenderContract1Tests {

    @Test("两视图 attach + 单次 feed → 恰一次 update、两者读到同 generation 同内容")
    func singleUpdateSharedByTwoViews() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        // 两个假视图 = 两个观察者，各自记下收到的快照。
        let notifyQ = DispatchQueue(label: "test.notify.contract1")
        let boxA = SnapshotBox()
        let boxB = SnapshotBox()
        let idA = s.addFrameObserver(deliverOn: notifyQ) { boxA.set($0) }
        let idB = s.addFrameObserver(deliverOn: notifyQ) { boxB.set($0) }
        #expect(idA != nil && idB != nil)

        #expect(s.currentFrame() == nil)   // feed 前无快照（attach 不自动 update）

        s.feed("hello\r\n")
        #expect(waitUntil { s.currentFrame() != nil })
        notifyQ.sync {}   // 冲刷观察者投递（串行 queue：sync 返回即所有 async 已跑完）

        let snap = try #require(s.currentFrame())
        #expect(snap.generation == 1)      // 单次 feed → 恰一次 update
        #expect(snap.lineText(0) == "hello")

        // 两观察者读到同一份（同 generation 同内容）——render state 归会话、只 update 一次的直接证据。
        let a = try #require(boxA.get())
        let b = try #require(boxB.get())
        #expect(a.generation == 1)
        #expect(b.generation == 1)
        #expect(a.lineText(0) == b.lineText(0))
        #expect(a.lineText(0) == "hello")

        s.removeFrameObserver(idA!)
        s.removeFrameObserver(idB!)
    }
}

@Suite("RenderCoordinator 合同②：节流合并 + 并发读快照安全")
struct RenderContract2Tests {

    @Test("突发 feed 10k 块 → update 次数 ≤ ⌈时长/4ms⌉+1，且远少于 feed 次数；并发读快照不撕裂")
    func burstFeedThrottledAndConcurrentReadSafe() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 80; cfg.rows = 24
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        // draw 线程：后台循环读快照指针并遍历字段（撕裂探测）。
        let running = AtomicFlag(true)
        let reader = Thread {
            while running.get() {
                if let f = s.currentFrame() {
                    var acc = 0
                    for row in f.lines { acc = acc &+ row.cells.count &+ Int(row.contentHash & 0xff) }
                    acc = acc &+ f.cols &+ f.rows &+ Int(f.generation)
                    acc = acc &+ Int(f.colors.background.r) &+ f.selectionRanges.count
                    _ = acc
                }
            }
        }
        reader.stackSize = 1 << 20
        reader.start()

        // 突发 10k feed（每块极小）。
        let t0 = DispatchTime.now()
        for i in 0..<10_000 { s.feed("\(i % 10)") }

        // 等 update 静默（>60ms 无 generation 变化），并记录最后一次变化时刻。
        var prevGen: UInt64 = 0
        var lastChange = t0
        _ = waitUntil(timeout: 8) {
            let g = s.currentFrame()?.generation ?? 0
            if g != prevGen { prevGen = g; lastChange = DispatchTime.now() }
            return g > 0 && DispatchTime.now().uptimeNanoseconds - lastChange.uptimeNanoseconds > 60_000_000
        }

        running.set(false)
        while !reader.isFinished { usleep(1_000) }

        let finalGen = try #require(s.currentFrame()).generation
        let spanMs = Double(lastChange.uptimeNanoseconds - t0.uptimeNanoseconds) / 1e6
        // 理论界 ⌈span/4ms⌉+1；+1 余量吸收 leading flush 的 async hop 抖动。
        let bound = Int(ceil(spanMs / 4.0)) + 2
        #expect(finalGen >= 1)
        #expect(Int(finalGen) <= bound, "update=\(finalGen) 应 ≤ \(bound)（span=\(spanMs)ms）")
        // 强证据：10k feed 只换来两位/三位数次 update，合并生效。
        #expect(Int(finalGen) < 1_000, "10k feed 却 \(finalGen) 次 update：节流未生效")
    }
}

@Suite("RenderCoordinator 滚动数据面")
struct RenderScrollTests {

    @Test("24 行视口灌 100 行：TOP 后首行==第1行；离底续 feed offset 不动、viewportActive==false；scrollbar 数学一致")
    func scrollTopThenFeedKeepsViewportPinned() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 20; cfg.rows = 24
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        var blob = ""
        for i in 0..<100 { blob += String(format: "L%04d\r\n", i) }
        s.feed(blob)
        #expect(waitUntil { s.currentFrame() != nil })
        #expect(s.viewportActive)   // 灌完停在底部

        s.scrollViewport(.top)      // 立即 update（同步落新快照）
        #expect(waitUntil { s.currentFrame()?.viewportActive == false })
        let afterTop = try #require(s.currentFrame())
        #expect(afterTop.lineText(0) == "L0000")          // 首行==第 1 行
        let offset0 = try #require(afterTop.scrollbar).offset
        #expect(offset0 == 0)                             // TOP → offset 0

        // 离底继续 feed（视口应钉在历史，不自动回底）。
        let genBefore = afterTop.generation
        s.feed("EXTRA0\r\nEXTRA1\r\n")
        #expect(waitUntil { (s.currentFrame()?.generation ?? 0) > genBefore })
        let afterMore = try #require(s.currentFrame())
        #expect(!afterMore.viewportActive)                // 仍非 active
        #expect(afterMore.lineText(0) == "L0000")         // 仍钉在顶
        #expect(afterMore.scrollbar?.offset == offset0)   // offset 不动

        // scrollbar total/offset/len 数学一致。
        let sb = try #require(afterMore.scrollbar)
        #expect(sb.len == 24)
        #expect(sb.total >= sb.len)
        #expect(sb.offset >= 0)
        #expect(sb.offset + sb.len <= sb.total)
        #expect(sb.total >= 100)                          // 100+ 行历史确实在
    }

    @Test("BOTTOM 回底后 viewportActive==true、首行随内容前移")
    func scrollBottomReactivatesViewport() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 20; cfg.rows = 24
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        var blob = ""
        for i in 0..<100 { blob += String(format: "L%04d\r\n", i) }
        s.feed(blob)
        s.scrollViewport(.top)
        #expect(waitUntil { s.currentFrame()?.viewportActive == false })

        s.scrollViewport(.bottom)
        #expect(waitUntil { s.currentFrame()?.viewportActive == true })
        let atBottom = try #require(s.currentFrame())
        #expect(atBottom.viewportActive)
        #expect(atBottom.lineText(0) != "L0000")   // 底部视口不再是第 1 行
    }
}

@Suite("RenderCoordinator 主题 / 光标（有效色 + 光标样式从 render state 读通）")
struct RenderThemeCursorTests {

    @Test("默认 dark bg；OSC 11 覆盖后变、OSC 111 清除回默认")
    func backgroundOverrideAndReset() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        s.feed("x")   // 触发首帧
        #expect(waitUntil { s.currentFrame() != nil })
        let defaultBg = try #require(s.currentFrame()).colors.background
        #expect(defaultBg == RGBA(r: 0x1e, g: 0x1e, b: 0x1e))   // 注入的占位 dark 默认

        // OSC 11 设背景 = #ff0000（渲染端读有效色，不自合成）。
        s.feed("\u{1b}]11;rgb:ff/00/00\u{07}x")
        #expect(waitUntil { s.currentFrame()?.colors.background == RGBA(r: 255, g: 0, b: 0) })

        // OSC 111 清除背景覆盖 → 回默认。
        s.feed("\u{1b}]111\u{07}x")
        #expect(waitUntil { s.currentFrame()?.colors.background == defaultBg })
    }

    @Test("默认光标 block；DECSCUSR 3 → underline")
    func cursorStyleFromDECSCUSR() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        s.feed("x")
        #expect(waitUntil { s.currentFrame() != nil })
        #expect(s.currentFrame()?.cursor.style == .block)   // TERM_L1_18 默认 block

        // DECSCUSR 3 (CSI 3 SP q) → underline 光标。
        s.feed("\u{1b}[3 qx")
        #expect(waitUntil { s.currentFrame()?.cursor.style == .underline })

        // 光标位置从 render state 读通（可见 + 在视口内）。
        let snap = try #require(s.currentFrame())
        #expect(snap.cursor.visible)
        #expect(snap.cursor.inViewport)
    }
}

@Suite("RenderCoordinator 快照形状与行内容缓存骨架")
struct RenderSnapshotShapeTests {

    @Test("快照维度/行数与配置一致；空隔离会话 cursor 在 (0,0)")
    func snapshotDimensionsMatchConfig() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 40; cfg.rows = 12
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        s.requestImmediateFrame()   // attach 路径：让 currentFrame() 立刻有内容
        #expect(waitUntil { s.currentFrame() != nil })
        let snap = try #require(s.currentFrame())
        #expect(snap.cols == 40)
        #expect(snap.rows == 12)
        #expect(snap.lines.count == 12)
        #expect(snap.colors.palette.count == 256)
        #expect(snap.cursor.x == 0 && snap.cursor.y == 0)
    }

    @Test("未变行跨帧复用 contentHash 稳定；变了的行 contentHash 改变")
    func rowContentHashStableAcrossFrames() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 20; cfg.rows = 6
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        s.feed("AAAA\r\nBBBB\r\n")   // 行 0=AAAA 行 1=BBBB
        #expect(waitUntil { (s.currentFrame()?.lines.count ?? 0) >= 2 })
        let f1 = try #require(s.currentFrame())
        let hashRow0 = f1.lines[0].contentHash
        let hashRow1 = f1.lines[1].contentHash
        #expect(f1.lineText(0) == "AAAA")
        #expect(f1.lineText(1) == "BBBB")

        // 只改行 1（光标回到行 1 覆写）；行 0 内容不变 → contentHash 应稳定。
        s.feed("\u{1b}[2;1HCCCC")   // CUP 到 (row2,col1) 覆写 → 行 1 变 CCCC
        #expect(waitUntil { s.currentFrame()?.lineText(1) == "CCCC" })
        let f2 = try #require(s.currentFrame())
        #expect(f2.lines[0].contentHash == hashRow0)   // 行 0 未变：hash 稳定（缓存命中）
        #expect(f2.lines[1].contentHash != hashRow1)   // 行 1 变了：hash 改变
    }
}
