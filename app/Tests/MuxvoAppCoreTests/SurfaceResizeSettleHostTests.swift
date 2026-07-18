// 网格 resize settle + surface detach 契约（DOGFOOD_M3_12）：断言全部打在可观测效果
// （session cols / isAttached）上，不断内部 flag（DOGFOOD_M3_11 B1 教训：入口级击穿会绕过 flag 断言）。
//
//   R1 瞬态窄 rect（settle 窗内宽→窄→宽）不得下发 PTY resize——旧代码红：窄帧立即 TIOCSWINSZ。
//   R2 稳定窄 rect 超 settle 窗后确实 resize（防修死）。
//   R3 连续拖动流：提交有界节流（≥1 次中间提交 = PRD REQ-TERM_GRID-011 实时重排保真；
//      < 步数 = 节流生效）——旧代码红：逐帧全提交。
//   R4 首帧例外：新建 surface 首个有效 rect 立即定网格（e2e item1 / GridSync 同步语义回归锚）。
//   R5 detach 契约：host 摘除 surface 必调 view.detach()（session 置 nil）——旧代码红：僵尸残留。
//   R6 僵尸 fire：被摘 surface 收字号广播不得 resize 活会话——旧代码红：陈旧 bounds×新度量
//      打改活会话网格（M3_12 取证实锤 vt=false pty=true 的活会话版）。
//
// 假时钟经 settleNowMs 注入（照 StateDebouncer/GridResizeSettler 惯例）；headless 无 runloop，
// layout() 显式调、trailing 提交经 flushGridSettle() 显式推进。装配照 SurfacePassiveResizeHostTests。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoTerm
import MuxvoTermRender
@testable import MuxvoAppCore

@Suite("Host 网格 resize settle + detach 契约（DOGFOOD_M3_12）", .serialized)
@MainActor
struct SurfaceResizeSettleHostTests {

    private func makeIsolated() throws -> (SessionRegistry, SessionID) {
        let registry = SessionRegistry()
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        guard case let .success(id) = registry.create(config: cfg) else {
            throw CocoaError(.featureUnsupported)
        }
        return (registry, id)
    }

    private func rect(_ id: String, w: CGFloat, h: CGFloat = 800) -> TermRect {
        TermRect(terminalId: id, x: 0, y: 0, w: w, h: h, visible: true, role: .grid)
    }

    /// 装配：registry + provider + host + 宽 grid 首帧提交完成（返回 surface 与基线 cols）。
    /// 时钟纪律（DOGFOOD_M3_13 惯例）：surface 在 applyLayout 内创建时 attach 已在真实时钟下
    /// 走过一轮 sync（零 bounds 被拒/或产生候选）——注入假时钟后必须先推进并 flushGridSettle()
    /// drain 一次拿到确定性基线，再开始场景（防真实/假时钟混用的 &- 回绕伪造 maxWait 直提）。
    private func makeAssembly() throws -> (
        registry: SessionRegistry, session: TerminalSession, id: String,
        provider: SurfaceProvider, host: TerminalSurfaceHostViewController,
        surface: TerminalSurfaceView, wideCols: Int
    ) {
        let (registry, sid) = try makeIsolated()
        let s = try #require(registry.session(for: sid))
        let provider = SurfaceProvider(registry: registry, device: nil)
        let host = TerminalSurfaceHostViewController(surfaceProvider: provider)
        _ = host.view
        host.view.frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
        host.applyLayout([rect(sid.raw, w: 1200)], stateId: "s1")
        let surface = try #require(
            host.attachedSurfaceView(forKey: "\(sid.raw)#grid") as? TerminalSurfaceView)
        var now: UInt64 = 1_000
        surface.settleNowMs = { now }
        surface.layout()
        now += 200
        surface.flushGridSettle() // 新代码：trailing 提交首帧；旧代码：first 已直通，flush no-op
        let wideCols = Int(s.cols)
        return (registry, s, sid.raw, provider, host, surface, wideCols)
    }

    @Test("R1: settle 窗内宽→窄→宽瞬态不下发 PTY resize（全程 cols 不下探）")
    func transientNarrowNeverTouchesPTY() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        #expect(a.wideCols >= 10)

        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        // 窄帧到达（布局切换中间帧/回闪）——旧代码此步已 TIOCSWINSZ 半值。
        a.host.applyLayout([rect(a.id, w: 600)], stateId: "s2")
        a.surface.layout()
        #expect(Int(a.session.cols) == a.wideCols) // 旧代码红：cols 已被压 ~70

        // 40ms 后回宽（同 settle 窗内）→ 候选撤销，全程零窄提交。
        now += 40
        a.host.applyLayout([rect(a.id, w: 1200)], stateId: "s3")
        a.surface.layout()
        #expect(Int(a.session.cols) == a.wideCols)

        // 时钟推满 + 显式 flush：无残留候选，终值仍宽。
        now += 200
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == a.wideCols)
    }

    @Test("R2: 稳定窄 rect 超 settle 窗后确实 resize（防修死）")
    func stableNarrowCommitsAfterWindow() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }

        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        // 900pt：窄于基线 1200pt 但换算 ≥F6 下限 80 列（m3-layout-r5 改参：原 600pt 在下限之下，
        // 归 A4 钳制契约管；本测契约=「稳定窄 rect 超窗确实 resize」在 ≥下限区间不变）。
        a.host.applyLayout([rect(a.id, w: 900)], stateId: "s2")
        a.surface.layout()
        now += 90 // > settleMs=80
        a.surface.flushGridSettle()

        let cell = a.surface.cellSizePxForTest
        let expectNarrow = Int(900 * 2) / cell.w // headless 无窗口：cache scale=2（GridSync T1 口径）
        #expect(expectNarrow >= 80) // 前提自检：本测几何在下限之上（下限内行为归 A4）
        #expect(Int(a.session.cols) == expectNarrow)
        #expect(expectNarrow < a.wideCols)
    }

    @Test("R3: 连续拖动流 settle-only（maxWait 豁免退役，m3-layout-r5）——零中间提交，松手 flush 到终值")
    func continuousStreamBoundedCommits() throws {
        // 契约演化：DOGFOOD_M3_12 原语义=逐帧全提交→有界节流（maxWait 内联 ≥1 次）；
        // DOGFOOD_M3_16 仅窗口边 live-resize 保 maxWait；m3-layout-r5 F1 撤销该豁免——拖拽期
        // 每次 maxWait 内联提交都命中活动 Ink 帧烧录永久残骸（2026-07-07 现场四次拖拽实录），
        // 且原豁免所引 PRD-011 只管辖分隔条不覆盖窗口 resize。用户裁决：松手一次到位。
        // 本测与 R10 形态趋同、保留双钉：R10 钉「程序性几何流」、本测钉「拖拽流同一契约」。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }

        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        var lastObserved = Int(a.session.cols)
        var commitCount = 0
        var w: CGFloat = 1200
        let steps = 20
        for i in 0..<steps {
            w -= 24
            a.host.applyLayout([rect(a.id, w: w)], stateId: "drag\(i)")
            a.surface.layout()
            if Int(a.session.cols) != lastObserved {
                commitCount += 1
                lastObserved = Int(a.session.cols)
            }
            now += 16
        }
        #expect(commitCount == 0) // 拖拽全程零中间提交（每个中间宽度都曾是一份 Ink 烧录）

        // 松手：静默满 settle 窗 → 终值精确提交。
        now += 100
        a.surface.flushGridSettle()
        let cell = a.surface.cellSizePxForTest
        #expect(Int(a.session.cols) == Int(w * 2) / cell.w)
    }

    @Test("R4: 首帧经 settle（M3_13 F3 刻意改义）——trailing 到期才提交，终值精确")
    func firstFrameGoesThroughSettle() throws {
        // 原语义「首帧立即直通」被 DOGFOOD_M3_13 F3 刻意废除（错误视口首帧烧写通道，R7 红锚）。
        // 新语义：首帧同经 settler；makeAssembly 已内嵌 推 200ms+flush，此处断言终值精确。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        let cell = a.surface.cellSizePxForTest
        #expect(a.wideCols == Int(1200 * 2) / cell.w)
        #expect(Int(a.session.cols) == a.wideCols)
    }

    @Test("R5: detach 契约——host 摘除 surface 必调 view.detach()（session 置 nil）")
    func hostDetachCallsViewDetach() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }

        let surface = a.surface // 强持有跨过摘除（僵尸场景本体）
        a.host.applyLayout([], stateId: "s2") // 空 rects ⇒ 全部摘除
        #expect(a.host.attachedSurfaceView(forKey: "\(a.id)#grid") == nil)
        #expect(surface.isAttached == false) // 旧代码红：只 removeFromSuperview，session 残留

        // 摘除后推进时钟 + flush 无副作用（无候选、无会话）。
        var now: UInt64 = 99_000
        surface.settleNowMs = { now }
        now += 500
        surface.flushGridSettle()
        #expect(Int(a.session.cols) == a.wideCols)
    }

    @Test("R6: 僵尸 fire——被摘 surface 收字号广播不得 resize 活会话（取证实锤的活会话版）")
    func detachedSurfaceMustNotResizeLiveSessionOnZoom() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }

        let zombie = a.surface // 强持有模拟真实存活（真机取证：被摘 ≥2s 仍收广播）
        a.host.applyLayout([], stateId: "s2") // 模拟聚焦形态：grid 洞缺席 → 摘除；会话仍活
        #expect(a.registry.session(for: SessionID(raw: a.id)) != nil)

        // 字号广播（Cmd+= 链路）：旧代码红——僵尸以陈旧 bounds×新度量打改活会话网格。
        a.provider.applyFontSize(16)
        #expect(Int(a.session.cols) == a.wideCols) // 旧代码红：被僵尸 resize 到 ~2400/新cellW
        _ = zombie // 生命周期锚
    }

    // MARK: - DOGFOOD_M3_13 阶段1 红锚（首帧收编 + 真值对账）

    @Test("R7: 首帧窄 rect 不得无保护直通 PTY——窗口 1024×640 冷启动形态（H-window 实录几何）")
    func firstFrameNarrowRectMustNotBypassSettle() throws {
        let (registry, sid) = try makeIsolated()
        let s = try #require(registry.session(for: sid))
        defer { registry.close(sid) }
        let provider = SurfaceProvider(registry: registry, device: nil)
        let host = TerminalSurfaceHostViewController(surfaceProvider: provider)
        _ = host.view
        host.view.frame = NSRect(x: 0, y: 0, width: 1024, height: 640) // minSize 坍缩窗口
        let initialCols = Int(s.cols) // config 初值 80

        // 错误视口下的首帧窄 rect（用户实测 333×569 同款几何）。
        host.applyLayout([TermRect(terminalId: sid.raw, x: 0, y: 0, w: 333, h: 569,
                                   visible: true, role: .grid)], stateId: "s1")
        let surface = try #require(
            host.attachedSurfaceView(forKey: "\(sid.raw)#grid") as? TerminalSurfaceView)
        var now: UInt64 = 1_000
        surface.settleNowMs = { now }
        surface.flushGridSettle() // drain（时钟纪律）
        surface.layout()
        // 旧代码红：首帧例外直通已把 333×569 换算值（~39 列）烧进 PTY。
        #expect(Int(s.cols) == initialCols)

        // 视口纠正（40ms 内宽 rect 重报，同 settle 窗）→ 推满 → 终值为宽，窄值全程未触 PTY。
        now += 40
        host.applyLayout([rect(sid.raw, w: 1200)], stateId: "s2")
        surface.layout()
        #expect(Int(s.cols) == initialCols) // 仍未提交（trailing 未到期）
        now += 200
        surface.flushGridSettle()
        let cell = surface.cellSizePxForTest
        #expect(Int(s.cols) == Int(1200 * 2) / cell.w)
    }

    @Test("R8: 首帧窄→随即 detach→重建宽——不得冻结窄值（聚焦/重挂冻结流）")
    func narrowFirstFrameThenDetachMustNotFreezeNarrow() throws {
        let (registry, sid) = try makeIsolated()
        let s = try #require(registry.session(for: sid))
        defer { registry.close(sid) }
        let provider = SurfaceProvider(registry: registry, device: nil)
        let host = TerminalSurfaceHostViewController(surfaceProvider: provider)
        _ = host.view
        host.view.frame = NSRect(x: 0, y: 0, width: 1024, height: 640)
        let initialCols = Int(s.cols)

        // 首帧窄 → 立即被摘（候选必须随 detach 撤销，不得抢在摘除前烧写）。
        host.applyLayout([TermRect(terminalId: sid.raw, x: 0, y: 0, w: 333, h: 569,
                                   visible: true, role: .grid)], stateId: "s1")
        let first = try #require(
            host.attachedSurfaceView(forKey: "\(sid.raw)#grid") as? TerminalSurfaceView)
        var now1: UInt64 = 1_000
        first.settleNowMs = { now1 }
        first.flushGridSettle()
        first.layout()
        a_assertNotBurned: do {
            #expect(Int(s.cols) == initialCols) // 旧代码红：first 直通已烧 ~39
        }
        host.applyLayout([], stateId: "s2") // 摘除（detach 撤候选）
        now1 += 500
        first.flushGridSettle() // 迟到 flush 无副作用
        #expect(Int(s.cols) == initialCols)

        // 重建宽（窗口已纠正）→ 会话到位宽值。
        host.view.frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
        host.applyLayout([rect(sid.raw, w: 1200)], stateId: "s3")
        let rebuilt = try #require(
            host.attachedSurfaceView(forKey: "\(sid.raw)#grid") as? TerminalSurfaceView)
        var now2: UInt64 = 50_000
        rebuilt.settleNowMs = { now2 }
        rebuilt.layout()
        now2 += 200
        rebuilt.flushGridSettle()
        let cell = rebuilt.cellSizePxForTest
        #expect(Int(s.cols) == Int(1200 * 2) / cell.w)
    }

    // MARK: - DOGFOOD_M3_16 修复② 非拖拽 settle-only 红锚

    @Test("R10: 非拖拽连续几何流（全屏/布局切换动画，非 live-resize）settle-only——零中间提交，仅终值经 flush")
    func nonDragStreamCommitsOnlyFinalValue() throws {
        // 现场：进/退全屏 + solo⇄平铺切换的动画流在 >150ms 内逐帧几何变化，旧代码 maxWait 逐段
        // 内联提交多个中间宽度 = 每段一次 SIGWINCH+reflow，正是 scrollback 连抖损坏源（DOGFOOD_M3_16）。
        // 新语义：仅窗口边 live-resize 保 maxWait 实时重排；全屏/布局/程序性几何变化 = 非拖拽 →
        // settle-only 只提交终值。headless inLiveResize=false（无真窗口 live-resize），故默认即非拖拽。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }

        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        let baseline = Int(a.session.cols)
        var commitCount = 0
        var lastObserved = baseline
        var w: CGFloat = 1200
        let steps = 20
        for i in 0..<steps {
            w -= 24
            a.host.applyLayout([rect(a.id, w: w)], stateId: "anim\(i)")
            a.surface.layout()
            if Int(a.session.cols) != lastObserved { commitCount += 1; lastObserved = Int(a.session.cols) }
            now += 16 // 20×16=320ms > maxWait 150ms：旧代码此处必内联提交 ≥1 次中间宽度
        }
        // 旧代码红：maxWait 在 320ms 流里内联提交 ≥1 次中间宽度（连抖损坏源）。
        // 新代码绿：非拖拽 settle-only，全程零提交，会话 cols 停基线。
        #expect(commitCount == 0)
        #expect(Int(a.session.cols) == baseline)

        // 松手静默满 settle 窗 → 终值精确提交（防修死：settle-only 仍提交终值）。
        now += 100
        a.surface.flushGridSettle()
        let cell = a.surface.cellSizePxForTest
        #expect(Int(a.session.cols) == Int(w * 2) / cell.w)
    }

    @Test("R9: 会话真值失配自愈——外因烧窄后，几何==lastGrid 的 layout 必须纠正（不早退钉死）")
    func truthMismatchHealsOnNextLayout() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        #expect(a.wideCols >= 10)

        // 外因把会话打窄（模拟任何未知烧写源：错误报文/僵尸/未来缺陷）；视图 lastGrid 仍留宽。
        _ = a.session.resize(cols: 31, rows: 28)
        #expect(Int(a.session.cols) == 31)

        var now: UInt64 = 100_000
        a.surface.settleNowMs = { now }
        a.surface.layout() // 几何未变（cols==lastGrid）——旧代码在此早退，永不纠正
        now += 200
        a.surface.flushGridSettle()
        // 旧代码红：cols 停 31（钉死）；新代码：真值对账触发重提交回宽。
        #expect(Int(a.session.cols) == a.wideCols)

        // 失配纠正候选不得被「几何 flap 回 lastGrid」cancel 掉：再烧一次 + 两次 layout 同值。
        _ = a.session.resize(cols: 31, rows: 28)
        now += 1_000
        a.surface.layout()
        now += 10
        a.surface.layout() // 同值二次 layout（旧 cancel 语义会撤销纠正候选）
        now += 200
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == a.wideCols)
    }
}
