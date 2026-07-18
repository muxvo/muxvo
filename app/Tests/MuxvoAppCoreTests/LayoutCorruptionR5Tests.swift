// m3-layout-r5 红锚（2026-07-07 排版错乱 P0 第五轮）：三个单元级现场同构复现。
//
// 现场（com.muxvo 双 PID 日志 + 截图反解定谳）：
//   S1 窗口边拖拽期 maxWait 每 ~150ms 内联提交中间宽度 ×4 次拖拽 ×3 tile——每次已应用
//      resize 命中活动 Ink 帧即烧录一份永久残骸（09:27:58/09:28:28/09:30:53/09:33:05）。
//   S2 sidebarPreview attach 竞态：provider 建视图时 attach 先于 host 置 drivesSessionResize=false，
//      零 bounds 下 2x2 候选入 settler；passive 早退不撤候选、flushGridSettle/commitGrid 不查角色
//      → 每次聚焦必发一次 session.resize(2,2)，仅靠 <10×2 防御侥幸拦下（09:29:32/09:33:38 实录）。
//   S3 真值失配「自愈」在 settle 在途期逐帧重录（09:28:07 单秒 19 条），每次重录重置 trailing
//      窗——settle-only 路径无 maxWait 兜底，≥12.5Hz 同几何 layout 流可把提交饿死无上限。
//
// 断言全部打在可观测效果（session cols / resize 请求计数）上。红→绿契约：
//   A1 拖拽流零中间提交（红：maxwait 内联 ≥1 次；绿=F1 撤 inLiveResize 豁免后 settle-only）
//   A2 预览 attach 全程零 resize 请求（红：一次被拒 2x2；绿=F2 角色先于 attach + 提交面守卫）
//   A3 失配重录不得饿死 trailing（红：提交被重录重置推迟；绿=F3 settle 在途不重录）
//
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoTerm
import MuxvoTermRender
@testable import MuxvoAppCore

@Suite("m3-layout-r5 排版错乱红锚（拖拽风暴/预览竞态/失配饿死）", .serialized)
@MainActor
struct LayoutCorruptionR5Tests {

    private func makeIsolated() throws -> (SessionRegistry, SessionID) {
        let registry = SessionRegistry()
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        guard case let .success(id) = registry.create(config: cfg) else {
            throw CocoaError(.featureUnsupported)
        }
        return (registry, id)
    }

    private func rect(_ id: String, w: CGFloat, h: CGFloat = 800,
                      role: TermRectRole = .grid) -> TermRect {
        TermRect(terminalId: id, x: 0, y: 0, w: w, h: h, visible: true, role: role)
    }

    /// 装配（照 SurfaceResizeSettleHostTests 时钟纪律）：宽 grid 首帧提交完成 → 确定性基线。
    private func makeAssembly() throws -> (
        registry: SessionRegistry, session: TerminalSession, id: String,
        host: TerminalSurfaceHostViewController, surface: TerminalSurfaceView, wideCols: Int
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
        surface.flushGridSettle()
        let wideCols = Int(s.cols)
        return (registry, s, sid.raw, host, surface, wideCols)
    }

    @Test("A1: 窗口边 live-resize 拖拽流 settle-only——零中间提交，仅静默终值（撤 maxWait 豁免）")
    func liveResizeDragStreamMustBeSettleOnly() throws {
        // 现场同构：09:27:58 s56 拖拽报文流 <80ms 间隔连续几何变化 >150ms。旧语义 maxWait 每
        // ~150ms 内联提交一个中间宽度 → 命中活动 Ink 帧烧录（用户裁决 2026-07-07：松手一次到位）。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }

        // 绿相注记：红相经 liveResizeHintForTest=true 席位复现 maxwait 中间提交（红档
        // logs/m3-r5-red-unit.log：commitCount=1、中途烧 110 列）；F1 撤豁免后席位随之删除，
        // 本测钉住统一契约——连续几何流不分拖拽与否零中间提交。
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        let baseline = Int(a.session.cols)
        var commitCount = 0
        var lastObserved = baseline
        var w: CGFloat = 1200
        let steps = 20
        for i in 0..<steps {
            w -= 24
            a.host.applyLayout([rect(a.id, w: w)], stateId: "drag\(i)")
            a.surface.layout()
            if Int(a.session.cols) != lastObserved { commitCount += 1; lastObserved = Int(a.session.cols) }
            now += 16 // 20×16=320ms：旧代码 maxWait 内联提交 ≥2 次中间宽度（红）
        }
        #expect(commitCount == 0)          // 旧代码红：maxwait 已提交中间宽度
        #expect(Int(a.session.cols) == baseline)

        // 松手：报文静默满 settle 窗 → 终值一次到位。
        now += 100
        a.surface.flushGridSettle()
        let cell = a.surface.cellSizePxForTest
        #expect(Int(a.session.cols) == Int(w * 2) / cell.w)
    }

    @Test("A2: sidebarPreview attach 全程零 session.resize 请求（含被拒的 2x2）")
    func previewAttachMustNeverIssueResizeRequests() throws {
        // 现场同构：09:29:32/09:33:38 每次聚焦 `resize rejected 2x2（<10×2 防御）`——attach 时
        // drivesSessionResize 尚为默认 true、bounds=0 → 2x2 入 settler；passive 早退不撤候选、
        // 提交面不查角色 → trailing 到期真调 session.resize(2,2)，靠防御侥幸拦下。
        let (registry, sid) = try makeIsolated()
        let s = try #require(registry.session(for: sid))
        defer { registry.close(sid) }
        let provider = SurfaceProvider(registry: registry, device: nil)
        let host = TerminalSurfaceHostViewController(surfaceProvider: provider)
        _ = host.view
        host.view.frame = NSRect(x: 0, y: 0, width: 1487, height: 1022)
        let before = s.resizeRequestCountForTest

        // 聚焦形态报文：仅 sidebarPreview 洞（366×456 = 现场几何）。
        host.applyLayout([rect(sid.raw, w: 366, h: 456, role: .sidebarPreview)], stateId: "s1")
        let preview = try #require(
            host.attachedSurfaceView(forKey: "\(sid.raw)#sidebarPreview") as? TerminalSurfaceView)

        // attach 残留候选若在，trailing 到期即触发提交（真实时钟满 settle 窗后手动 flush，
        // 与生产 timer 同一入口）。
        Thread.sleep(forTimeInterval: 0.12)
        preview.flushGridSettle()

        #expect(s.resizeRequestCountForTest - before == 0) // 旧代码红：一次被拒 2x2 请求
        #expect(Int(s.cols) == 80)                          // 防御兜底下尺寸未变（两态同）
    }

    @Test("A4: 高度下限钳制 + 宽度随 bounds——小 tile 行钳 396pt 纸高容量、列=真实容量（O1a 改判 2026-07-09）")
    func gridFloorClampsBelowMinimum() throws {
        // 原 F6/F8 契约（活体案例二）：双轴钳 80×24。m3-r7 第七轮改判（用户裁决 O1a，2026-07-09）：
        // **宽度下限退役**——680pt「纸宽」使三列平铺（472pt/tile）恒按 80 列排版左锚右裁 25 列/31%
        //（红档 m3-r7-red-e2e-item39.md + 像素证据），列数恒 bounds 主导；高度下限 396pt 保留
        //（Ink 上擦预算依赖行数下限；矮 tile 裁切窗口 + F6b 光标跟随语义不变）。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        #expect(a.wideCols > 80) // 前提：基线宽（1200pt→141 列）

        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }
        let appliedBefore = a.session.resizeAppliedCountForTest
        let cell = a.surface.cellSizePxForTest

        // 小洞（363×390pt；harness headless cell 17×33）：列=真实容量 42（旧契约红：钳 80 右溢出），
        // 行 390pt<396pt → 钳纸高容量 24。恰一次已应用（预算合规）。
        a.host.applyLayout([rect(a.id, w: 363, h: 390)], stateId: "s2")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == Int(363 * 2) / cell.w)
        #expect(Int(a.session.rows) == 24)
        #expect(a.session.resizeAppliedCountForTest - appliedBefore == 1)

        // 更小的洞（300×300pt）：列跟随缩到 35（旧契约同尺寸短路——宽度恒 80 不动；O1a 后宽度真实
        // 跟随即新目标，恰一次新增已应用）；行仍钳 24。
        a.host.applyLayout([rect(a.id, w: 300, h: 300)], stateId: "s3")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == Int(300 * 2) / cell.w && Int(a.session.rows) == 24)
        #expect(a.session.resizeAppliedCountForTest - appliedBefore == 2)

        // 每轴独立：宽窄高充裕（363×800pt → 列 42、行自由 48——高度轴不受宽度退役影响）。
        a.host.applyLayout([rect(a.id, w: 363, h: 800)], stateId: "s4")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == Int(363 * 2) / cell.w)
        #expect(Int(a.session.rows) == Int(800 * 2) / cell.h)

        // 回宽（1200×800pt）：正常跟随。
        a.host.applyLayout([rect(a.id, w: 1200)], stateId: "s5")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == a.wideCols)
    }

    @Test("A5: 钳制态光标跟随偏移（F6b）——空会话锚顶/满屏锚底/中部跟随，单一来源，非钳制态恒零")
    func clampedContentFollowsCursor() throws {
        // F6b（活体案例四勘误）：F6 初版恒锚底——新 spawn 的 shell 唯一内容（提示符）在网格顶部，
        // 锚底把它裁掉 → 用户新建第 4/5/6 个终端全黑（Muxvo2.1 真机实录）。正确语义 = 可见窗口
        // 必须含光标行：offset = clamp((cursor.y+1)×ch − viewHpx, 0, maxOff)；光标出 viewport
        //（scrollback 回看）→ 锚底。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }
        #expect(a.surface.contentYOffsetPxForTest == 0) // 宽基线：网格随视图，零偏移

        a.host.applyLayout([rect(a.id, w: 363, h: 300)], stateId: "s2")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle() // 钳制 → 80×24，网格高于视图（视图容量 ~18 行 < 24）
        let cell = a.surface.cellSizePxForTest
        let viewHpx = Int(a.surface.bounds.height * 2) // headless cache scale=2
        let maxOff = 24 * cell.h - viewHpx
        #expect(Int(a.session.rows) == 24)
        #expect(maxOff > 0)

        // ①空会话（光标 row0，快照就绪后）：锚顶——F6 初版此处红（恒 maxOff=锚底，全黑根因）。
        a.session.requestImmediateFrame()
        _ = pollUntil { a.session.currentFrame() != nil }
        #expect(a.surface.contentYOffsetPxForTest == 0)

        // ②feed 到光标 row20（超视图容量、未及底）：跟随光标——offset=(21×ch−viewHpx)∈(0,maxOff)。
        for i in 0..<20 { a.session.feed("mid-\(i)\r\n") }
        a.session.requestImmediateFrame()
        _ = pollUntil { (a.session.currentFrame()?.cursor.y ?? -1) == 20 }
        let midOff = 21 * cell.h - viewHpx
        #expect(midOff > 0 && midOff < maxOff) // 前提自检：几何具备三态判别力
        #expect(a.surface.contentYOffsetPxForTest == midOff)

        // ③feed 满屏（光标 row23）：锚底（F6 原正确场景不回归）。
        for i in 0..<30 { a.session.feed("fill-\(i)\r\n") }
        a.session.requestImmediateFrame()
        _ = pollUntil { (a.session.currentFrame()?.cursor.y ?? -1) == 23 }
        #expect(a.surface.contentYOffsetPxForTest == maxOff)

        // ④回宽：网格重新随视图，偏移归零。
        a.host.applyLayout([rect(a.id, w: 1200)], stateId: "s3")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()
        #expect(a.surface.contentYOffsetPxForTest == 0)
    }

    /// 快照泵：renderCoordinator 异步重建快照，轮询到条件成立（≤2s）。
    private func pollUntil(_ cond: () -> Bool) -> Bool {
        for _ in 0..<200 {
            if cond() { return true }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return cond()
    }

    /// 线程安全布尔（照 RenderCoordinatorTests.AtomicFlag 惯例；feeder 线程停止信号用）。
    private final class AtomicFlag: @unchecked Sendable {
        private let lock = NSLock()
        private var v = false
        var value: Bool { lock.withLock { v } }
        func set(_ nv: Bool) { lock.withLock { v = nv } }
    }

    // MARK: - F7 静默门（活体案例五：聚焦进出落在 CC 流式中 → 每次跨界 resize 烧一整帧）
    //   A7 于 2026-07-09（F-A dogfood-r1）自本门辖域移出：zoom 改「短程尾沿 + force 绕门」，见 A7 注释。
    //   T1'（2026-07-10 第八轮）：门语义自「饿死门」改「合并窗」——settle 路径活跃期照旧被扣（A6 不变），
    //   但首次扣下即武装 bounds 尾沿 force（~200ms 到期绕门落地，A11-A14）。案由：聚焦切换×CC spinner
    //   亚 400ms 0 gap 分钟级持续 → 静默窗永不到来，网格永停平铺尺寸（dogfood 测试3 实证）。

    @Test("A6: 输出活跃期 resize 被静默门推迟——停止输出后自动落地终值（F7）")
    func resizeDefersWhileOutputActive() throws {
        // 现场同构：19:34-19:47 三次聚焦进出（93×36↔80×24）落在 CC 流式输出长提示词中，
        // 每次合法 resize 烧一整帧（几百行重复 2-3 份，93/80 两种宽度实录）。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        let baseline = Int(a.session.cols)

        // 模拟流式：真时钟下持续 feed（30ms 间隔 < quietMs），期间做几何变化。
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }
        let feeding = AtomicFlag()
        let s = a.session
        let feeder = Thread {
            while feeding.value { s.feed("stream-tick\r\n"); Thread.sleep(forTimeInterval: 0.03) }
        }
        feeding.set(true); feeder.start()
        defer { feeding.set(false) }
        _ = pollUntil { s.msSinceLastOutput() != nil } // 流式已开

        a.host.applyLayout([rect(a.id, w: 900)], stateId: "s2")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle() // trailing 到期——但输出活跃 → 门挡
        #expect(Int(a.session.cols) == baseline) // 旧代码红：此处已提交 72 列

        // 持续活跃 0.3s 再 flush：settle 路径仍不落地（T1' 注记：settle 路径活跃期恒被扣不变——
        // 「落地」职责移交 bounds 尾沿 force（A11），本测不触发 flushBoundsForceCommit 故照旧全扣）。
        Thread.sleep(forTimeInterval: 0.3)
        now += 300
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == baseline)

        // 停止输出 → 静默满 quietMs 后（重挂 timer 域用假时钟，手动推）→ 终值一次落地。
        feeding.set(false)
        Thread.sleep(forTimeInterval: 0.5) // 真时钟静默 > quietMs(400)
        now += 500
        a.surface.flushGridSettle()
        let cell = a.surface.cellSizePxForTest
        #expect(Int(a.session.cols) == max(Int(900 * 2) / cell.w, 80))
    }

    @Test("A7: 流式中 zoom 短程尾沿 force 提交——末次按键后落地终值，绕输出静默门（F-A dogfood-r1 根治右裁）")
    func zoomForceCommitsShortTrailingWhileOutputActive() throws {
        // 契约取舍变更（2026-07-09 dogfood）：本测原名 zoomDefersWhileOutputActive「输出活跃期 zoom
        // 同受静默门」，其案由 = 17:31「字号连击 6 连发」排版错乱实录的根治锚（连击逐步 reflow 活动
        // Ink 帧，每发烧一份残骸）。但简单静默门有个致命反作用：CC 工作时 spinner 亚 400ms 持续重绘 →
        // 门永不开 → renderFrame 以旧列数 × 新大 cell 出帧，右侧越界 GPU 裁切（左锚无横向滚动）——
        // 用户五轮投诉「放大字号右侧截断」的根因。定版设计（兼顾两历史投诉）：zoom 字形每按即变，
        // PTY resize 改走「末次按键后 ~200ms 短程尾沿 timer + force 提交绕门」——截断窗 ∞→~200ms（无感），
        // 连按只重挂 timer 合并 ≤1 次 resize（连击烧帧不回归，另见 A7b）。本测钉 force 落地一支；
        // A7b 钉连击合并一支。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        let baseline = Int(a.session.cols)
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        let feeding = AtomicFlag()
        let s = a.session
        let feeder = Thread {
            while feeding.value { s.feed("z\r\n"); Thread.sleep(forTimeInterval: 0.03) }
        }
        feeding.set(true); feeder.start()
        defer { feeding.set(false) }
        _ = pollUntil { s.msSinceLastOutput() != nil } // 流式已开（亚 400ms 门内）

        let appliedBefore = a.session.resizeAppliedCountForTest
        a.surface.updateFontSize(18)                                  // 字形即变；仅挂 zoom 尾沿 timer（不立即提交）
        #expect(a.session.resizeAppliedCountForTest == appliedBefore) // 尾沿未到期 → 网格尚未落地
        #expect(Int(a.session.cols) == baseline)

        // 尾沿到期（生产 ~200ms timer；测试经共用入口手动触发，照 flushGridSettle 时钟纪律先例）：
        // 输出仍活跃，force 绕门直落终值——旧契约此处永不落地（右裁），故为红→绿判据。
        a.surface.flushZoomCommit()
        let cell = a.surface.cellSizePxForTest
        let expectedCols = max(Int(1200 * 2) / cell.w, Int(680 * 2) / cell.w) // = drivingGridSizeFromBounds（bounds/floor 取大）
        #expect(a.session.resizeAppliedCountForTest - appliedBefore == 1) // 现代码红：门挡→永不落地（增量 0）
        #expect(Int(a.session.cols) == expectedCols)                     // 收敛到新 cell 换算值 = 无右溢出
        #expect(Int(a.session.cols) != baseline)                         // 新度量网格确实变化
    }

    @Test("A7b: 流式中 zoom 连击合并——快速 ×3 只落 1 次 force resize，终值取末次字号（17:31 连击烧帧不回归）")
    func rapidZoomBurstMergesToSingleForceCommit() throws {
        // 连击合并 = A7 定版的另一半（防 17:31 六连发风暴回归）：亚 400ms feed 中快速 zoom（字号 ramp）
        // 每发只重挂尾沿 timer（前一 invalidate），仅末次幸存回调 force 提交一次 → ≤1 帧 Ink 烧写。
        // 测试以「多次 updateFontSize + 单次 flushZoomCommit」复现「timer 连番重挂、仅末次到期」的合并语义。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        let feeding = AtomicFlag()
        let s = a.session
        let feeder = Thread {
            while feeding.value { s.feed("z\r\n"); Thread.sleep(forTimeInterval: 0.03) }
        }
        feeding.set(true); feeder.start()
        defer { feeding.set(false) }
        _ = pollUntil { s.msSinceLastOutput() != nil }

        let appliedBefore = a.session.resizeAppliedCountForTest
        a.surface.updateFontSize(16)
        a.surface.updateFontSize(18)
        a.surface.updateFontSize(20)                                  // 连击三发：每发重挂 timer（合并）
        #expect(a.session.resizeAppliedCountForTest == appliedBefore) // 连击期无一立即提交（全在尾沿 timer）

        a.surface.flushZoomCommit()                                   // 仅末次幸存回调落地一次
        #expect(a.session.resizeAppliedCountForTest - appliedBefore == 1) // 合并为 1 次 resize（≤1 帧烧写）
        #expect(a.surface.currentFontSize == 20)                      // 字形取末次
        let cell = a.surface.cellSizePxForTest                        // = 字号 20 的度量
        let expectedCols = max(Int(1200 * 2) / cell.w, Int(680 * 2) / cell.w)
        #expect(Int(a.session.cols) == expectedCols)                  // 终值 cols 取末次字号（正确）
    }

    @Test("A8: 守恒——无输出会话（从未 feed）几何变化行为与现状逐一相同，零额外延迟")
    func quietGateNoopForSilentSession() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        #expect(a.session.msSinceLastOutput() == nil) // 从未输出 → 门恒放行

        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }
        a.host.applyLayout([rect(a.id, w: 900)], stateId: "s2")
        a.surface.layout()
        now += 90
        a.surface.flushGridSettle() // settle 80ms 即提交，无静默等待
        let cell = a.surface.cellSizePxForTest
        #expect(Int(a.session.cols) == max(Int(900 * 2) / cell.w, 80))
    }

    @Test("A10: 窄 tile 视觉根因不变式——列数=真实容量、网格像素宽 ≤ 视图像素宽 + 变窄跟随（m3-r7 O1a 绿锚）")
    func narrowTileHasNoRightOverflow() throws {
        // m3-r7 红档同构（三列平铺 472pt，2026-07-09）：as-built（宽度下限 680pt）恒提交 80 列 →
        // 80×17=1360px > 944px 视图 → 右裁 25 列/31%、且变窄提交列钉死不降（红档阶段C/D）。
        // O1a 后绿契约：列数恒 bounds 主导。断言形态遵失败案例库纪律（2026-03-01）：视觉根因条件
        // cols×cellW ≤ boundsPx，禁 cols≥80 类结构断言（那正是六轮把右裁条件判绿的盲区）。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }
        let cell = a.surface.cellSizePxForTest

        a.host.applyLayout([rect(a.id, w: 472)], stateId: "s2")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == Int(472 * 2) / cell.w)                    // bounds 主导（55 列@cell17）
        #expect(Int(a.session.cols) * cell.w <= Int(a.surface.bounds.width * 2)) // 无右溢出（视觉根因不变式）

        // 变窄跟随（红档阶段D 反面：as-built 392pt 仍钉死 80 列、右裁加深至 42%）。
        a.host.applyLayout([rect(a.id, w: 392)], stateId: "s3")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()
        #expect(Int(a.session.cols) == Int(392 * 2) / cell.w)
        #expect(Int(a.session.cols) * cell.w <= Int(a.surface.bounds.width * 2))
    }

    @Test("A3: settle 在途的真值失配不得重录饿死 trailing（静止期失配仍自愈）")
    func inflightMismatchMustNotStarveTrailing() throws {
        // 现场同构：09:28:07 单秒 19 条「真值失配→重提交」。settle-only 路径重录每次重置
        // trailing 且无 maxWait 兜底：同几何 layout 流 <80ms 间隔 → 提交永不成熟（饿死）。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        #expect(a.wideCols >= 10)

        // 外因烧窄（同 R9 场景）：session=31，视图 lastGrid 仍宽、几何不变。
        _ = a.session.resize(cols: 31, rows: 28)
        #expect(Int(a.session.cols) == 31)

        var now: UInt64 = 100_000
        a.surface.settleNowMs = { now }
        a.surface.layout()        // t+0：失配 → 录纠正候选
        now += 40
        a.surface.layout()        // t+40：失配依旧——旧代码重录（重置 trailing 窗）
        now += 30
        a.surface.layout()        // t+70：再重录
        now += 20
        a.surface.flushGridSettle() // t+90：自首录已 90ms>80ms——旧代码窗被重置到 t+70，不吐
        #expect(Int(a.session.cols) == a.wideCols) // 旧代码红：仍 31（饿死）；新代码：t+0 候选成熟自愈
    }

    // MARK: - T1' bounds 尾沿 force（2026-07-10 第八轮：聚焦切换×流式网格饿死根治）
    //   现场：muxvo测试3 六终端平铺，CC「Waiting for background agent」spinner 亚 400ms 0 gap 分钟级
    //   持续，平铺→聚焦后 bounds 提交被 F7 门无限回炉（settle 重试每次再撞门）——PTY 永停平铺网格，
    //   内容缩左上角。字号 zoom 的 F-A force 尾沿不覆盖 bounds 路径（两条不相交的路，六轮+锚测盲区）。

    @Test("A11: 流式中 bounds 变化 force 尾沿落地——门挡后 ~200ms 绕门提交现时几何（T1' 根治聚焦饿死）")
    func boundsForceCommitsShortTrailingWhileOutputActive() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        let baseline = Int(a.session.cols)
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        let feeding = AtomicFlag()
        let s = a.session
        let feeder = Thread {
            while feeding.value { s.feed("focus-stream\r\n"); Thread.sleep(forTimeInterval: 0.03) }
        }
        feeding.set(true); feeder.start()
        defer { feeding.set(false) }
        _ = pollUntil { s.msSinceLastOutput() != nil } // 流式已开（亚 400ms 门内）

        let appliedBefore = a.session.resizeAppliedCountForTest
        a.host.applyLayout([rect(a.id, w: 900)], stateId: "s2") // 聚焦切换同构：surface.frame 原子跃变
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()                            // trailing 到期——输出活跃 → 门挡
        #expect(Int(a.session.cols) == baseline)               // settle 路径被扣（A6 语义不变）
        #expect(a.surface.boundsForceTimerArmedForTest)        // 门首次扣下即武装尾沿 force（T1' 接线）

        // 尾沿到期（生产 ~200ms timer；测试经共用入口手动触发，照 flushGridSettle/flushZoomCommit
        // 时钟纪律先例）：输出仍活跃，force 绕门以现时 bounds 直落——旧契约此处永不落地（聚焦饿死），
        // 故为红→绿判据。
        a.surface.flushBoundsForceCommit()
        let cell = a.surface.cellSizePxForTest
        #expect(a.session.resizeAppliedCountForTest - appliedBefore == 1) // 红：门挡→增量 0
        #expect(Int(a.session.cols) == Int(900 * 2) / cell.w)             // 现时 bounds 容量（O1a 列无下限）
        #expect(Int(a.session.cols) != baseline)
        #expect(Int(a.session.cols) * cell.w <= Int(a.surface.bounds.width * 2)) // 视觉根因不变式：无右溢出
        #expect(!a.surface.boundsForceTimerArmedForTest)                  // 落地即收编，timer 清
    }

    @Test("A12: 流式中 bounds 连变合并——每个新候选 disarm 重来，单次尾沿只落 1 次 force、终值取末次几何")
    func boundsBurstMergesToSingleForceCommit() throws {
        // 合并语义 = T1' 的另一半（保 R5 用户裁决「拖拽中不重排、稳定后一次到位」不减力）：bounds 在变
        // （新几何候选 .scheduled）即 disarm 尾沿，下次门命中重新起算——仅稳定后的末次幸存回调落地一次。
        // 兼防重挂互锁（头号风险）：若 arm 误写成每门命中重挂，force 会被 <200ms 重试链无限推迟。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        let feeding = AtomicFlag()
        let s = a.session
        let feeder = Thread {
            while feeding.value { s.feed("burst\r\n"); Thread.sleep(forTimeInterval: 0.03) }
        }
        feeding.set(true); feeder.start()
        defer { feeding.set(false) }
        _ = pollUntil { s.msSinceLastOutput() != nil }

        let appliedBefore = a.session.resizeAppliedCountForTest
        for w in [900, 700, 500] { // 连变三发：录候选→门挡→武装；下一发 .scheduled disarm 重来
            a.host.applyLayout([rect(a.id, w: CGFloat(w))], stateId: "w\(w)")
            a.surface.layout()
            now += 200
            a.surface.flushGridSettle() // 每发都撞门（输出活跃）
        }
        #expect(a.session.resizeAppliedCountForTest == appliedBefore) // 连变期无一落地（全在尾沿）
        #expect(a.surface.boundsForceTimerArmedForTest)               // 末次门命中后处于武装态

        a.surface.flushBoundsForceCommit()                            // 仅末次幸存回调落地一次
        let cell = a.surface.cellSizePxForTest
        #expect(a.session.resizeAppliedCountForTest - appliedBefore == 1) // 合并为 1 次 resize（≤1 帧烧写）
        #expect(Int(a.session.cols) == Int(500 * 2) / cell.w)             // 终值=现时（末次）bounds，TOCTOU 现读
    }

    @Test("A12b: 门重试链再命中不重挂 force timer——fireDate 恒定（arm-if-not-armed 直测，对抗 MINOR-1 回修）")
    func gateRetryMustNotPostponeBoundsForceDeadline() throws {
        // 攻击面（对抗验收 MINOR-1）：arm 若回归成「每门命中重挂」，A12/item41 仍绿（手动 flush 无法
        // 区分 deadline；item41 门重试间隔>200ms 掩盖）——本测以真 timer fireDate 直测 deadline 恒定：
        // 门首扣武装后，重试链再命中 ×3，fireDate 一毫秒都不得后移（重挂必后移=红）。
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        let feeding = AtomicFlag()
        let s = a.session
        let feeder = Thread {
            while feeding.value { s.feed("retry\r\n"); Thread.sleep(forTimeInterval: 0.03) }
        }
        feeding.set(true); feeder.start()
        defer { feeding.set(false) }
        _ = pollUntil { s.msSinceLastOutput() != nil }

        a.host.applyLayout([rect(a.id, w: 900)], stateId: "s2")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle() // 门首扣 → 武装
        let deadline0 = try #require(a.surface.boundsForceTimerFireDateForTest)

        for i in 1...3 { // 门重试链再命中（同几何候选在途，生产=settle timer 到期重试再撞门）
            Thread.sleep(forTimeInterval: 0.05) // 真墙钟前进——若重挂，新 fireDate 必然后移 ≥50ms
            now += 120
            a.surface.flushGridSettle()
            let deadline = try #require(a.surface.boundsForceTimerFireDateForTest)
            #expect(deadline == deadline0, "重试#\(i) fireDate 后移=重挂回归（arm-if-not-armed 破）")
        }
    }

    @Test("A13: 守恒——静默会话 bounds 变化全程不武装 force timer，settle 80ms 照常落地零额外延迟（A8 同族）")
    func boundsForceTimerStaysDisarmedForSilentSession() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        #expect(a.session.msSinceLastOutput() == nil) // 从未输出 → 门恒放行，force 永不武装

        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }
        let appliedBefore = a.session.resizeAppliedCountForTest
        a.host.applyLayout([rect(a.id, w: 900)], stateId: "s2")
        a.surface.layout()
        #expect(!a.surface.boundsForceTimerArmedForTest)
        now += 90
        a.surface.flushGridSettle() // settle 80ms 即提交，无静默等待、不经 force
        let cell = a.surface.cellSizePxForTest
        #expect(Int(a.session.cols) == Int(900 * 2) / cell.w)
        #expect(a.session.resizeAppliedCountForTest - appliedBefore == 1)
        #expect(!a.surface.boundsForceTimerArmedForTest) // 全程未武装（A13 守恒）
    }

    @Test("A14: 流式中 bounds flap 回已提交值——force timer 撤销、零提交（settle 窗 flap 守恒）")
    func boundsFlapCancelsForceTimerWithZeroCommit() throws {
        let a = try makeAssembly()
        defer { a.registry.close(SessionID(raw: a.id)) }
        let baseline = Int(a.session.cols)
        var now: UInt64 = 10_000
        a.surface.settleNowMs = { now }

        let feeding = AtomicFlag()
        let s = a.session
        let feeder = Thread {
            while feeding.value { s.feed("flap\r\n"); Thread.sleep(forTimeInterval: 0.03) }
        }
        feeding.set(true); feeder.start()
        defer { feeding.set(false) }
        _ = pollUntil { s.msSinceLastOutput() != nil }

        let appliedBefore = a.session.resizeAppliedCountForTest
        a.host.applyLayout([rect(a.id, w: 900)], stateId: "s2")
        a.surface.layout()
        now += 200
        a.surface.flushGridSettle()                     // 门挡 → 武装
        #expect(a.surface.boundsForceTimerArmedForTest)

        a.host.applyLayout([rect(a.id, w: 1200)], stateId: "s3") // flap 回已提交几何
        a.surface.layout()                              // 新候选 .scheduled → disarm（尾沿重新起算）
        #expect(!a.surface.boundsForceTimerArmedForTest)
        a.surface.layout()                              // 同几何再 layout → flap 归零撤候选（真值一致）
        now += 500
        a.surface.flushGridSettle()                     // 无候选可吐
        #expect(a.session.resizeAppliedCountForTest == appliedBefore) // 全程零提交
        #expect(Int(a.session.cols) == baseline)
        #expect(!a.surface.boundsForceTimerArmedForTest)
    }
}
