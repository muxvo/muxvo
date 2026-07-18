// 字号缩放渲染消费（DOGFOOD_M3_05）：断链 2「projection.fontSize 无消费者、fontConfig 恒 14」的翻牌。
//
// 覆盖两层，全部无 GPU、只碰内存（隔离会话 spawnShell:false，device:nil）：
//   R2a. TerminalSurfaceView.updateFontSize —— 换 FontConfig → 取新 GlyphCache → cell 度量变化 →
//        走既有 syncGridToBounds/resize 路径按新度量重报 cols/rows（cell 变大→同 view 尺寸格子变少→TIOCSWINSZ）。
//   R2b. SurfaceProvider.applyFontSize —— 广播到所有存活视图 + 之后新建视图采用当前字号（非默认 14）。
//        （sidebarPreview 第二视图同经 provider 建，故一并覆盖。）
//
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
@testable import MuxvoTerm
@testable import MuxvoTermRender

@MainActor
private func makeIsolatedSession(cols: UInt16 = 20, rows: UInt16 = 6) throws -> TerminalSession {
    var cfg = TerminalSession.Config()
    cfg.spawnShell = false
    cfg.cols = cols; cfg.rows = rows
    return try TerminalSession(config: cfg)
}

@Suite("字号缩放渲染消费（DOGFOOD_M3_05）", .serialized)
@MainActor
struct ZoomRenderConsumptionTests {

    // R2a：视图字号消费 + 会话按新度量重报网格
    @Test("updateFontSize 放大：cell 度量增大 + 会话按新度量重报网格（cols/rows 减少，TIOCSWINSZ 路径）")
    func updateFontSizeEnlargesCellAndResizesSession() throws {
        let s = try makeIsolatedSession(cols: 80, rows: 24)
        defer { s.close() }
        let view = TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 14), device: nil)
        view.frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
        view.attach(s) // attach 内 syncGridToBounds 首次记账
        // DOGFOOD_M3_13 F3：attach 首帧经 settle——注钟推满 flush 取真基线（141×48），
        // 否则基线是未提交的 config 初值、rows 断言判别力退化（时钟纪律惯例）。
        var now: UInt64 = 1_000
        view.settleNowMs = { now }
        now += 200
        view.flushGridSettle()

        let cols0 = s.cols, rows0 = s.rows
        let cellH0 = view.cellHeightPxForTest
        #expect(cols0 >= 10 && rows0 >= 2) // 首次网格有效（resize 生效前提：guard cols>=10,rows>=2）

        view.updateFontSize(28)
        #expect(view.currentFontSize == 28)
        #expect(view.cellHeightPxForTest > cellH0) // 字号翻倍 → cell 变高（新 GlyphCache 度量）
        // F-A（dogfood-r1，2026-07-09）：zoom 的 PTY resize 改走短程尾沿 timer（连击合并 + 流式中 force
        // 绕 F7 输出静默门），不再随 updateFontSize 立即提交。静默会话（本测从未 feed）尾沿到期同落终值——
        // 手动经共用入口触发（照 flushGridSettle 时钟纪律先例）后断言网格重报，测试意图（cell 增→网格重报）不变。
        view.flushZoomCommit()
        #expect(s.cols < cols0)                     // 同 view 尺寸 + cell 变大 → cols 减少（重报 TIOCSWINSZ）
        #expect(s.rows < rows0)

        view.detach()
    }

    @Test("updateFontSize 幂等：同字号再调不改度量（guard 早退）；复位回原字号度量还原")
    func updateFontSizeIdempotentAndReset() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }
        let view = TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 14), device: nil)
        view.frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
        view.attach(s)
        let cellH14 = view.cellHeightPxForTest

        view.updateFontSize(14) // 同字号 → 无变化
        #expect(view.currentFontSize == 14)
        #expect(view.cellHeightPxForTest == cellH14)

        view.updateFontSize(28)
        #expect(view.cellHeightPxForTest > cellH14)
        view.updateFontSize(14) // 复位回 14 → 度量还原
        #expect(view.currentFontSize == 14)
        #expect(view.cellHeightPxForTest == cellH14)

        view.detach()
    }

    // R2b：provider 广播 + 新建视图采用当前字号
    @Test("SurfaceProvider.applyFontSize 广播：存活视图字号随之更新 + 之后新建视图采用当前字号")
    func providerBroadcastsAndNewSurfacesAdoptCurrent() throws {
        let reg = SessionRegistry(); defer { reg.shutdownForTeardown() }
        let s1 = try makeIsolatedSession()
        let s2 = try makeIsolatedSession()
        defer { s1.close(); s2.close() }
        let provider = SurfaceProvider(
            registry: reg, font: FontConfig(family: "Menlo", size: 14), device: nil)

        let v1 = provider.makeSurfaceView(for: s1)
        #expect(v1.currentFontSize == 14)

        provider.applyFontSize(22)
        #expect(v1.currentFontSize == 22)       // 存活视图广播更新
        #expect(provider.currentFontSize == 22) // provider 新建默认更新

        let v2 = provider.makeSurfaceView(for: s2)
        #expect(v2.currentFontSize == 22)       // 新建视图采用当前字号（非默认 14）

        v1.detach(); v2.detach()
    }
}
