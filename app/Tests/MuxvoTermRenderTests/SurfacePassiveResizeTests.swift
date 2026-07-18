// SurfacePassiveResizeTests：sidebarPreview 视图对共享会话网格的被动化（DOGFOOD_M3_10）。
//
// 根因：SurfaceProvider 建的 grid 主视图与 sidebarPreview 小预览是同一全功能 TerminalSurfaceView，
// attach/layout/updateFontSize 全部无条件 syncGridToBounds → session.resize——预览把共享 PTY 压成
// 窄尺寸（TIOCSWINSZ → CC 按窄 cols 硬换行烧进 scrollback，不可逆）。视图对 session 网格的所有权洞。
// 修复：TerminalSurfaceView.drivesSessionResize=false 的视图恒被动（syncGridToBounds 算出 cols/rows
// 之后、session.resize 之前守卫早退，仅保本地 lastGrid 账，绝不下发 resize）。
//
// 全部无 GPU（device:nil）、隔离会话（spawnShell:false）。旧代码（守卫未接线）下预览 layout 把会话
// 压窄 → 红；接线后全程不动 → 绿。
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

@MainActor
private func makeView() -> TerminalSurfaceView {
    TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 14), device: nil)
}

@Suite("sidebarPreview 视图不驱动共享 PTY 网格（DOGFOOD_M3_10）", .serialized)
@MainActor
struct SurfacePassiveResizeTests {

    @Test("A 双视图共享会话：宽 grid 定网格后，被动预览 attach+layout 不改会话 cols")
    func passivePreviewDoesNotResizeSharedSession() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }

        // grid 主视图（默认驱动）定宽网格。
        let gridView = makeView()
        gridView.attach(s)
        gridView.frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
        gridView.layout()
        // DOGFOOD_M3_13 F3：首帧经 settle——注钟 flush 取真基线（~141 列），防基线退化成未提交初值。
        var now: UInt64 = 1_000
        gridView.settleNowMs = { now }
        now += 200
        gridView.flushGridSettle()
        let wideCols = Int(s.cols)
        #expect(wideCols >= 100) // 宽网格前提（1200pt×2 ÷ cell ≈ 141 列，基线必须是已提交真值）

        // 被动预览：drivesSessionResize=false，attach 同会话 + 套窄 frame + layout。
        let previewView = makeView()
        previewView.drivesSessionResize = false
        previewView.attach(s)
        previewView.frame = NSRect(x: 0, y: 0, width: 300, height: 160)
        previewView.layout()

        // 旧代码：预览 layout 把会话压到 ~35 列 → 红。被动化后全程不动。
        #expect(Int(s.cols) == wideCols)

        gridView.detach()
        previewView.detach()
    }

    @Test("B 聚焦形态：grid detach 后仅被动预览存活，改 frame+字号全程会话 cols 不动")
    func passivePreviewSurvivingFocusKeepsSessionGrid() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }

        let gridView = makeView()
        gridView.attach(s)
        gridView.frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
        gridView.layout()
        var now: UInt64 = 1_000
        gridView.settleNowMs = { now }
        now += 200
        gridView.flushGridSettle() // F3：真基线（时钟纪律）
        let wideCols = Int(s.cols)
        #expect(wideCols >= 100)

        let previewView = makeView()
        previewView.drivesSessionResize = false
        previewView.attach(s)
        previewView.frame = NSRect(x: 0, y: 0, width: 300, height: 160)
        previewView.layout()
        #expect(Int(s.cols) == wideCols) // 预览就位即不改网格

        // 聚焦形态：grid 洞 detach，唯一存活视图 = 窄被动预览。
        gridView.detach()
        #expect(Int(s.cols) == wideCols)

        // 预览改窄 frame → layout：旧代码压窄，被动化不动。
        previewView.frame = NSRect(x: 0, y: 0, width: 280, height: 150)
        previewView.layout()
        #expect(Int(s.cols) == wideCols)

        // 字号广播换 cache 度量 → 旧代码按新度量 resize，被动化仅换 cache 不 resize。
        previewView.updateFontSize(18)
        #expect(Int(s.cols) == wideCols)

        previewView.detach()
    }
}
