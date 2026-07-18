// GridFloorZoomTests：F8 物理排版空间下限（m3-layout-r5，活体案例六）。
//
// 现场（2026-07-07 23:35，Muxvo2.1修复 PID 68011 日志实锤）：2×2 宫格 tile（713×308pt）里
// Cmd+= 放大字号（cell 17→22px）后，目标列数 1426/22=64 < 80 → F6 固定格数下限钳回 80 列 →
// 80×22px=1760px > 视图 1426px → 右侧 ~15 列 GPU 裁切，文字「横向放大不适配、超框消失」。
// 正常终端 zoom 语义 = 列数变少、文本 reflow 全可见。
//
// F8 契约（用户拍板 2026-07-07 深夜）：下限本体从「固定格数 80×24」改为「固定物理排版空间
// 680×396pt」（= 80×24 @ 默认 Menlo14 cell 17×33@2x）；下限格数 = 该空间在当前 cell 度量下的
// 容量，随字号自动换算。默认字号下与 F6 逐点一致（回归锚=既有 A4/A5/item29 全部不动）。
//
// m3-r7 O1a 改判（用户裁决 2026-07-09，第七轮）：**宽度下限退役**——680pt 纸宽即「三列右裁」
// 恒态主因（<680pt tile 恒钳 80 列左锚右裁 31%+，红档 m3-r7-red-e2e-item39.md + 像素证据）；
// F8 的「随字号换算」语义保留在高度轴（396pt 纸高）。本文件相应改判：列锚全部改 bounds 主导。
//
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID。
import AppKit
import Foundation
import Testing
@testable import MuxvoTerm
@testable import MuxvoTermRender

@Suite("F8 物理排版空间下限（字号缩放适配）", .serialized)
@MainActor
struct GridFloorZoomTests {

    private func makeIsolated() throws -> TerminalSession {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        return try TerminalSession(config: cfg)
    }

    @Test("大字号 + 中等 tile：宽度超过物理下限空间 → 不钳、reflow 全可见（活体案例六现场几何）")
    func largerFontReflowsInMediumTile() throws {
        let s = try makeIsolated()
        defer { s.close() }
        // 现场同构：713×308pt tile + 字号 18（cell 22×42@2x，与 23:35:18 日志一致）。
        let view = TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 18), device: nil)
        view.drivesSessionResize = true
        view.frame = NSRect(x: 0, y: 0, width: 713, height: 308)
        view.attach(s)
        var now: UInt64 = 1_000
        view.settleNowMs = { now }
        now += 200
        view.flushGridSettle()

        let cell = view.cellSizePxForTest
        #expect(cell.w > 17) // 前提自检：字号 18 的 cell 确实宽于默认（判别力所在）
        // 宽向：713pt > 680pt（物理下限空间）→ 永不钳 → 列数 = 真实容量（reflow 全可见）。
        // 旧代码红：固定 80 列 > 容量（1426/22=64）→ 右侧裁切。
        let rawCols = Int(713 * 2) / cell.w
        #expect(rawCols < 80) // 前提自检：现场几何确实低于旧固定下限
        #expect(Int(s.cols) == rawCols)
        // 高向：308pt < 396pt → 钳到物理空间容量（792/ch），仍是裁切窗口（光标跟随，F6b）。
        let floorRows = Int(396 * 2) / cell.h
        #expect(Int(s.rows) == floorRows)

        view.detach()
    }

    @Test("高度下限换算纯函数锚：cellH 33→24 行 / 42→18 行 / 26→30 行（O1a 后宽度轴无下限）")
    func floorFormulaAnchors() {
        // m3-r7 O1a（用户裁决 2026-07-09）：宽度下限退役（列锚已删——680pt 纸宽=三列右裁恒态主因，
        // 红档 m3-r7-red-e2e-item39.md）；F8「物理空间随 cell 换算」语义保留在高度轴。
        #expect(TerminalSurfaceView.gridFloorRows(cellH: 33, scale: 2) == 24) // 默认字号 = F6 原常量逐点一致
        #expect(TerminalSurfaceView.gridFloorRows(cellH: 42, scale: 2) == 18) // 放大：同一块纸排得少 → 下限宽松
        #expect(TerminalSurfaceView.gridFloorRows(cellH: 26, scale: 2) == 30) // 缩小：排得多 → CC 更宽松
    }

    @Test("默认字号小 tile：列=真实容量 42、行钳 24（O1a 改判——宽度随 bounds，高度 F6 语义逐点不变）")
    func defaultFontFloorUnchanged() throws {
        // 原契约「363×300 → 80×24」为 m3-r7 定谳的右裁根因面（80×17=1360px > 726px 视图 → 溢出 38 列）；
        // O1a 改判（2026-07-09）：列=真实容量（无右溢出），行钳 396pt 纸高容量（不变）。
        let s = try makeIsolated()
        defer { s.close() }
        let view = TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 14), device: nil)
        view.drivesSessionResize = true
        view.frame = NSRect(x: 0, y: 0, width: 363, height: 300) // A4 同款小 tile 几何
        view.attach(s)
        var now: UInt64 = 1_000
        view.settleNowMs = { now }
        now += 200
        view.flushGridSettle()
        let cell = view.cellSizePxForTest
        #expect(cell.w == 17 && cell.h == 33) // 前提自检：默认度量
        #expect(Int(s.cols) == Int(363 * 2) / cell.w && Int(s.rows) == 24) // 列随 bounds、行钳纸高
        #expect(Int(s.cols) * cell.w <= Int(363 * 2)) // 视觉根因不变式：无右溢出
        view.detach()
    }
}
