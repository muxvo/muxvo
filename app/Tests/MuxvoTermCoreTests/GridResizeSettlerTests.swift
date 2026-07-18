import Testing

@testable import MuxvoTermCore

@Suite("GridResizeSettler（trailing 80ms + maxWait 150ms 混合，假时钟，DOGFOOD_M3_12）")
struct GridResizeSettlerTests {
    @Test("常量：settle 80ms / maxWait 150ms")
    func constants() {
        #expect(GridResizeSettler.settleMs == 80)
        #expect(GridResizeSettler.maxWaitMs == 150)
    }

    @Test("T1: record 后未满 80ms flush 返回 nil（候选保持）")
    func flushBeforeSettleWindowReturnsNil() {
        let s = GridResizeSettler()
        #expect(s.record(cols: 83, rows: 50, nowMs: 1_000) == .scheduled(dueInMs: 80))
        #expect(s.flush(nowMs: 1_050) == nil) // 50 < 80
        #expect(s.hasPending)
        #expect(s.dueInMs(nowMs: 1_050) == 30)
    }

    @Test("T2: 满 80ms flush 吐终值一次并清空，再 flush 返回 nil")
    func flushAfterSettleWindowEmitsOnce() {
        let s = GridResizeSettler()
        _ = s.record(cols: 83, rows: 50, nowMs: 1_000)
        let v = s.flush(nowMs: 1_080)
        #expect(v?.cols == 83)
        #expect(v?.rows == 50)
        #expect(s.hasPending == false)
        #expect(s.flush(nowMs: 2_000) == nil)
    }

    @Test("T3: 窗内多次 record 只吐最后一条（trailing 覆盖），trailing 窗随每次 record 重置")
    func trailingKeepsOnlyLatest() {
        let s = GridResizeSettler()
        _ = s.record(cols: 141, rows: 48, nowMs: 1_000)
        _ = s.record(cols: 70, rows: 48, nowMs: 1_030)
        _ = s.record(cols: 141, rows: 48, nowMs: 1_060)
        #expect(s.flush(nowMs: 1_100) == nil) // 距最后一次 40 < 80：窗被重置
        let v = s.flush(nowMs: 1_140) // 1140-1060=80
        #expect(v?.cols == 141)
        #expect(s.flush(nowMs: 2_000) == nil)
    }

    @Test("T4: 每 16ms 连续流 → 自首个未提交变化 ~150ms 处 record 返回 .commitNow（maxWait 内联提交）")
    func continuousStreamHitsMaxWaitInline() {
        let s = GridResizeSettler()
        var now: UInt64 = 1_000
        var commits: [(cols: Int, at: UInt64)] = []
        var cols = 141
        for _ in 0..<25 {
            cols -= 2
            if case .commitNow(let c, _) = s.record(cols: cols, rows: 48, nowMs: now) {
                commits.append((c, now))
            }
            now += 16
        }
        // 首提交 = 首个距锚点（1000）≥150ms 的 record 时刻 1160；提交后锚点清空，
        // 下一段锚点 1176 → 第二次提交 1336。25 步 400ms 内恰 2 次内联提交（~6.4Hz ≥ 有界下限）。
        #expect(commits.count == 2)
        #expect(commits[0].at == 1_160)
        #expect(commits[1].at == 1_336)
        // 每次 commitNow 后锚点清空，剩余候选继续走 trailing
        #expect(s.hasPending)
    }

    @Test("T5: cancel 后 flush 返回 nil（候选撤销）")
    func cancelDropsPending() {
        let s = GridResizeSettler()
        _ = s.record(cols: 35, rows: 50, nowMs: 1_000)
        s.cancel()
        #expect(s.hasPending == false)
        #expect(s.flush(nowMs: 5_000) == nil)
        #expect(s.dueInMs(nowMs: 5_000) == nil)
    }

    @Test("T6: maxWait 提交后锚点重置——下一段连续流再满 150ms 才再次 commitNow")
    func maxWaitAnchorResetsAfterCommit() {
        let s = GridResizeSettler()
        var now: UInt64 = 1_000
        var inlineCommits = 0
        // 第一段流：跑到首次 commitNow
        while inlineCommits == 0 {
            if case .commitNow = s.record(cols: Int(now % 100) + 20, rows: 48, nowMs: now) {
                inlineCommits += 1
            } else {
                now += 16
            }
        }
        let firstCommitAt = now
        // 紧接着继续流：下次 commitNow 必须再等 ~150ms（锚点已随提交重置）
        var secondCommitAt: UInt64? = nil
        for _ in 0..<20 {
            now += 16
            if case .commitNow = s.record(cols: Int(now % 100) + 20, rows: 48, nowMs: now) {
                secondCommitAt = now
                break
            }
        }
        #expect(secondCommitAt != nil)
        #expect(secondCommitAt! - firstCommitAt >= GridResizeSettler.maxWaitMs)
    }

    @Test("边界：record 后恰 79ms flush nil、恰 80ms 吐值（&- 溢出安全口径）")
    func settleBoundaryExact() {
        let s = GridResizeSettler()
        _ = s.record(cols: 100, rows: 40, nowMs: 10_000)
        #expect(s.flush(nowMs: 10_079) == nil)
        #expect(s.flush(nowMs: 10_080)?.cols == 100)
    }
}
