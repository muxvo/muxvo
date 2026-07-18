// SurfaceGridSyncTests：首帧网格 scale 同源与左上 1/4 修复（DOGFOOD_M3_07）。
//
// 根因：syncGridToBounds 分子优先信 MTKView 惰性刷新的 drawableSize（首帧竞态窗口内可为
// contentsScale=1 的半像素陈旧值），分母 cell metrics 恒 @cache.scale——分子分母 scale 异源
// → cols/rows 各减半写死 lastGrid → 内容困在左上 1/4。
// 修复口径：分子 = bounds(pt) × renderer.glyphCache.scale（与分母同一 cache 实例构造性同源）。
//
// 全部无 GPU（device:nil）、隔离会话（spawnShell:false）；T2/T3 用伪 scale 窗口（不 orderFront，
// 无 SIGTRAP）。红锚用例在 attach 前显式赋 1x drawableSize 制造陈旧态，并以 precondition 断言
// 陈旧值已生效——未来 macOS 行为变化时 loud-fail 而非假绿。
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

/// 伪 backing scale 窗口：backingScaleFactor 只读且随屏，测试用子类 override 伪造 1x/2x。
private final class FakeScaleWindow: NSWindow {
    var fakeScale: CGFloat = 2
    override var backingScaleFactor: CGFloat { fakeScale }
}

@MainActor
private func makeFakeScaleWindow(scale: CGFloat, size: NSSize) -> FakeScaleWindow {
    let window = FakeScaleWindow(
        contentRect: NSRect(origin: .zero, size: size),
        styleMask: [.borderless], backing: .buffered, defer: true)
    window.fakeScale = scale
    window.contentView = NSView(frame: NSRect(origin: .zero, size: size))
    // 不 orderFront：headless；本套件只验网格换算，不依赖 key 状态。
    return window
}

@Suite("首帧网格 scale 同源与左上 1/4 修复（DOGFOOD_M3_07）", .serialized)
@MainActor
struct SurfaceGridSyncTests {

    @Test("T1 无窗口 + 陈旧 1x drawableSize：首帧网格必须按 bounds×cache.scale 换算（不信 drawableSize）")
    func staleDrawableSizeWithoutWindow() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }
        let view = TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 14), device: nil)
        view.frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
        // 制造陈旧态：drawableSize 停在 1x（首帧竞态窗口内 MTKView 的真实形态）。
        view.drawableSize = CGSize(width: 1200, height: 800)
        #expect(view.drawableSize == CGSize(width: 1200, height: 800)) // precondition：陈旧值已生效

        view.attach(s)
        // DOGFOOD_M3_13 F3：首帧经 settle——注钟推满 flush 后断言（时钟纪律惯例）。
        var now: UInt64 = 1_000
        view.settleNowMs = { now }
        now += 200
        view.flushGridSettle()

        let cell = view.cellSizePxForTest
        #expect(cell.w > 0 && cell.h > 0)
        // 权威口径 = bounds(pt) × cache.scale(=2，无窗口用 init 缓存) ÷ cell px。
        // 旧代码分子取陈旧 drawableSize(1x) → cols/rows 各减半 → 红。
        #expect(Int(s.cols) == Int(view.bounds.width * 2) / cell.w)
        #expect(Int(s.rows) == Int(view.bounds.height * 2) / cell.h)

        view.detach()
    }

    @Test("T2 伪 Retina(2x) 真窗口 + 陈旧 1x drawableSize：最贴近产线首帧形态的红锚")
    func staleDrawableSizeInRetinaWindow() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }
        // 680×460：两轴换算均 ≥F6 下限 80×24（m3-layout-r5 改参：原 680×340 行数 20 落于下限之下，
        // 归 A4 钳制契约管；本测契约=scale 同源换算，几何仅需在下限之上）。
        let window = makeFakeScaleWindow(scale: 2, size: NSSize(width: 700, height: 480))
        defer { window.contentView = nil }
        let view = TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 14), device: nil)
        view.frame = NSRect(x: 0, y: 0, width: 680, height: 460)
        window.contentView?.addSubview(view) // viewDidMoveToWindow → refreshGlyphCacheForScale@2

        // 制造陈旧态（addSubview 与 attach 之间无 runloop 泵，AppKit 无机会覆写——确定性）。
        view.drawableSize = CGSize(width: 680, height: 460)
        #expect(view.drawableSize == CGSize(width: 680, height: 460)) // precondition

        view.attach(s)
        var now: UInt64 = 1_000
        view.settleNowMs = { now }
        now += 200
        view.flushGridSettle() // F3：首帧经 settle

        let cell = view.cellSizePxForTest
        #expect(cell.w > 0 && cell.h > 0)
        // 权威口径 = bounds × backingScaleFactor(2)。旧代码 680/cell.w（半值）→ 红。
        #expect(Int(s.cols) == Int(view.bounds.width * 2) / cell.w)
        #expect(Int(s.rows) == Int(view.bounds.height * 2) / cell.h)

        view.detach()
    }

    @Test("T3 非 Retina(1x) 窗口守卫：网格 = bounds×1 ÷ cell@1（防硬编 ×2 式假修）")
    func scaleOneWindowGuard() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }
        // 920×500 @1x：两轴换算均 ≥F6 下限 80×24（m3-layout-r5 改参：原 630×340 @1x 两轴皆在
        // 下限之下，归 A4；本测契约=1x 不得硬编 ×2，几何仅需在下限之上）。
        let window = makeFakeScaleWindow(scale: 1, size: NSSize(width: 940, height: 520))
        defer { window.contentView = nil }
        let view = TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 14), device: nil)
        view.frame = NSRect(x: 0, y: 0, width: 920, height: 500)
        window.contentView?.addSubview(view) // refreshGlyphCacheForScale@1 → cell 度量换 1x

        view.attach(s)
        var now: UInt64 = 1_000
        view.settleNowMs = { now }
        now += 200
        view.flushGridSettle() // F3：首帧经 settle

        let cell = view.cellSizePxForTest
        #expect(cell.w > 0 && cell.h > 0)
        #expect(Int(s.cols) == Int(view.bounds.width * 1) / cell.w)
        #expect(Int(s.rows) == Int(view.bounds.height * 1) / cell.h)

        view.detach()
    }

    @Test("T4 attach 于零 bounds：resize 被 cols>=10 守卫拒、会话保持初值；设 frame+layout 后网格到位")
    func zeroBoundsAttachThenLayout() throws {
        let s = try makeIsolatedSession(cols: 20, rows: 6)
        defer { s.close() }
        let view = TerminalSurfaceView(font: FontConfig(family: "Menlo", size: 14), device: nil)
        // frame=.zero attach（产线形态：SurfaceProvider 先 attach 后 addSubview/设 frame）。
        view.attach(s)
        var now: UInt64 = 1_000
        view.settleNowMs = { now }
        now += 200
        view.flushGridSettle() // 零 bounds 不产生候选（m3-layout-r5 F2 装配中态守卫）→ flush 无事发生
        #expect(s.cols == 20 && s.rows == 6) // 保持 config 初值

        view.frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
        view.layout() // 产线由 frame 变化触发；测试显式调
        now += 200
        view.flushGridSettle() // F3：首帧经 settle

        let cell = view.cellSizePxForTest
        #expect(cell.w > 0 && cell.h > 0)
        #expect(Int(s.cols) == Int(view.bounds.width * 2) / cell.w)
        #expect(Int(s.rows) == Int(view.bounds.height * 2) / cell.h)

        view.detach()
    }
}
