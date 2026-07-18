// 主题边沿显式 present（settings-dogfood 批；terminal-theme.md §5：主题发布后所有存活 surface
// 必须真正出一帧新色）。isPaused+enableSetNeedsDisplay 驱动下 idle/非 key 面的 needsDisplay 不保证
// 真正出帧——切主题时未聚焦 tile 留在旧色、连续切换闪上一主题快照。修=帧观察者投递内配色边沿检测
// → 显式 draw()。headless（无窗无 GPU）断言缝 forcedPresentCountForTest：计数在 window 守卫之前，
// 恰验「边沿检测触发」；draw() 本体 renderer.canRender 早退安全。
// 命名纪律：TT_theme_edge_present_* / TT_theme_no_present_on_feed 已登记 terminal-theme.md §8.1 案例池
//（spec-coverage 强制 1:1），测试名携池 ID 为真翻牌非伪造。
import AppKit
import Foundation
import Testing
@testable import MuxvoTerm
@testable import MuxvoTermRender

@Suite("主题边沿显式 present（配色变化必出帧）", .serialized)
@MainActor
struct SurfaceThemePresentTests {

    private func makeAttachedView() throws -> (TerminalSession, TerminalSurfaceView) {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.theme = .dark
        let s = try TerminalSession(config: cfg)
        let v = TerminalSurfaceView(session: s, device: nil)   // headless：无 GPU、无窗
        return (s, v)
    }

    /// 等主线程投递（观察者 deliverOn:.main）：Task.sleep 让出 main actor，主队列块得以执行。
    private func waitMain(timeout: TimeInterval = 5, _ cond: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while !cond() {
            if Date() >= deadline { return false }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return cond()
    }

    /// 首帧基线就绪（首次投递已建立边沿基线，消除 applyTheme 抢先竞态）。
    private func awaitBaseline(_ s: TerminalSession, _ v: TerminalSurfaceView) async {
        s.feed("x")
        let ok = await waitMain { v.lastPublishedColorsForTest != nil }
        #expect(ok, "前置：首帧应投递并建立配色基线")
        #expect(v.forcedPresentCountForTest == 0, "基线建立本身不得计边沿")
    }

    @Test("TT_theme_edge_present_single: applyTheme 一次 → 恰一次配色边沿 present")
    func singleThemeEdgePresents() async throws {
        let (s, v) = try makeAttachedView()
        defer { s.close() }
        await awaitBaseline(s, v)

        s.applyTheme(.monokai)
        let ok = await waitMain { v.forcedPresentCountForTest == 1 }
        #expect(ok, "applyTheme 后必须触发一次显式 present（实得 \(v.forcedPresentCountForTest)）")
    }

    @Test("TT_theme_edge_present_consecutive: 连切两主题 → 两次边沿 present（陈旧快照闪回归锚）")
    func consecutiveThemeEdgesEachPresent() async throws {
        let (s, v) = try makeAttachedView()
        defer { s.close() }
        await awaitBaseline(s, v)

        s.applyTheme(.light)
        var ok = await waitMain { v.forcedPresentCountForTest == 1 }
        #expect(ok, "第一个主题边沿应 present（实得 \(v.forcedPresentCountForTest)）")
        s.applyTheme(.monokai)
        ok = await waitMain { v.forcedPresentCountForTest == 2 }
        #expect(ok, "第二个主题边沿应再 present——light 帧不得滞留为未消费陈旧快照（实得 \(v.forcedPresentCountForTest)）")
    }

    @Test("TT_theme_no_present_on_feed: 常规 feed 帧（配色不变）→ 零边沿 present（防逐帧显式 draw 回归性能红线）")
    func regularFeedFramesDoNotForcePresent() async throws {
        let (s, v) = try makeAttachedView()
        defer { s.close() }
        await awaitBaseline(s, v)

        let genBefore = s.currentFrame()?.generation ?? 0
        for i in 0..<20 { s.feed("line \(i)\r\n") }
        let ok = await waitMain { (s.currentFrame()?.generation ?? 0) > genBefore }
        #expect(ok, "前置：feed 应产生新帧")
        try? await Task.sleep(nanoseconds: 200_000_000)   // 让 main 投递排空
        #expect(v.forcedPresentCountForTest == 0,
                "常规 feed 帧不得触发显式 present（实得 \(v.forcedPresentCountForTest)）")
    }
}
