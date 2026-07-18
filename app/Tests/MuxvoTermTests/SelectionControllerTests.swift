// 选区手势 / 复制 / 鼠标上报验收（批 4②；行为规格 terminal-input.md §4/§5）。
// 全走 spawnShell:false 隔离会话 + 快照/查询检查，无 GUI、无 Metal。
// 命名纪律：本批无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import Darwin
import Foundation
import Testing
@testable import MuxvoTerm

private func waitUntil(timeout: TimeInterval = 5, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return true }
        usleep(2_000)
    }
    return cond()
}

private func makeSession(cols: UInt16 = 20, rows: UInt16 = 6) throws -> TerminalSession {
    var cfg = TerminalSession.Config()
    cfg.spawnShell = false
    cfg.cols = cols; cfg.rows = rows
    return try TerminalSession(config: cfg)
}

@Suite("选区手势：press/drag/release → 快照选区区间")
struct SelectionGestureTests {

    @Test("press(0,0)→drag(5,0)→release：行 0 选区区间 0...5 反映在快照")
    func cellDragSelectsRange() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("hello world\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        // drag 端点由 surface 像素半格取整定：落 col 5 右半（px 47，cell 5 = 40..47）→ 含 cell 5。
        s.selectionPress(col: 0, row: 0, surfaceX: 0, surfaceY: 0, timeNs: 0)
        s.selectionDrag(col: 5, row: 0, surfaceX: 47, surfaceY: 0,
                        columns: 20, cellWidthPx: 8, screenHeightPx: 96)
        s.selectionRelease(col: 5, row: 0)

        #expect(waitUntil { !(s.currentFrame()?.selectionRanges.isEmpty ?? true) })
        let snap = try #require(s.currentFrame())
        let range = try #require(snap.selectionRanges.first { $0.row == 0 })
        #expect(range.from == 0)
        #expect(range.to == 5)
        // cell.selected 链路（instance builder 反色驱动）也通。
        #expect(snap.lines[0].cells[0].selected)
        #expect(snap.lines[0].cells[5].selected)
        #expect(!snap.lines[0].cells[6].selected)
        #expect(s.hasSelection())
    }

    @Test("双击词选（CLICK_COUNT 驱动 WORD behavior）：'hello' → 复制得 hello，区间 0...4")
    func doubleClickSelectsWord() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("hello world\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        // 两次 press（间隔 1ms < 500ms、同位置）→ gesture 内建 click_count=2 → WORD。
        s.selectionPress(col: 2, row: 0, surfaceX: 16, surfaceY: 0, timeNs: 0)
        s.selectionRelease(col: 2, row: 0)
        s.selectionPress(col: 2, row: 0, surfaceX: 16, surfaceY: 0, timeNs: 1_000_000)
        s.selectionRelease(col: 2, row: 0)

        #expect(waitUntil { !(s.currentFrame()?.selectionRanges.isEmpty ?? true) })
        #expect(s.copySelectionPlainText() == "hello")
        let snap = try #require(s.currentFrame())
        let range = try #require(snap.selectionRanges.first { $0.row == 0 })
        #expect(range.from == 0)
        #expect(range.to == 4)
    }

    @Test("三击行选（CLICK_COUNT 驱动 LINE behavior）：整行 → 复制得 hello world")
    func tripleClickSelectsLine() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("hello world\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        s.selectionPress(col: 3, row: 0, surfaceX: 24, surfaceY: 0, timeNs: 0)
        s.selectionRelease(col: 3, row: 0)
        s.selectionPress(col: 3, row: 0, surfaceX: 24, surfaceY: 0, timeNs: 1_000_000)
        s.selectionRelease(col: 3, row: 0)
        s.selectionPress(col: 3, row: 0, surfaceX: 24, surfaceY: 0, timeNs: 2_000_000)
        s.selectionRelease(col: 3, row: 0)

        #expect(waitUntil { s.copySelectionPlainText() == "hello world" })
        let snap = try #require(s.currentFrame())
        let range = try #require(snap.selectionRanges.first { $0.row == 0 })
        #expect(range.from == 0)   // 行选从行首
    }

    @Test("单击无拖动清除旧选区；显式 clearSelection 亦清")
    func singleClickAndClearDiscardSelection() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("hello world\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        // 先拖出一个选区。
        s.selectionPress(col: 0, row: 0, surfaceX: 0, surfaceY: 0, timeNs: 0)
        s.selectionDrag(col: 4, row: 0, surfaceX: 32, surfaceY: 0, columns: 20, cellWidthPx: 8, screenHeightPx: 96)
        s.selectionRelease(col: 4, row: 0)
        #expect(waitUntil { s.hasSelection() })

        // 别处单击（间隔久、位置远 → click_count 回 1 → NO_VALUE → 清除）。
        s.selectionPress(col: 10, row: 2, surfaceX: 80, surfaceY: 32, timeNs: 2_000_000_000)
        s.selectionRelease(col: 10, row: 2)
        #expect(waitUntil { !s.hasSelection() })
        #expect(s.currentFrame()?.selectionRanges.isEmpty ?? false)

        // 再选一次 + 显式 clear。
        s.selectionPress(col: 0, row: 0, surfaceX: 0, surfaceY: 0, timeNs: 4_000_000_000)
        s.selectionDrag(col: 4, row: 0, surfaceX: 32, surfaceY: 0, columns: 20, cellWidthPx: 8, screenHeightPx: 96)
        s.selectionRelease(col: 4, row: 0)
        #expect(waitUntil { s.hasSelection() })
        s.clearSelection()
        #expect(waitUntil { !s.hasSelection() })
    }
}

@Suite("复制：formatter 导出选区纯文本")
struct SelectionCopyTests {

    @Test("多行选区 plain text：尾随空格裁剪（trim），硬换行保留")
    func copyMultiLineTrimmed() throws {
        let s = try makeSession(cols: 20, rows: 6)
        defer { s.close() }
        s.feed("abc   \r\ndef\r\n")   // 行0 = "abc" + 尾随空格；行1 = "def"
        #expect(waitUntil { (s.currentFrame()?.lines.count ?? 0) >= 2 })

        // 从 (0,0) 拖到行 1 末端 → 覆盖行 0 全行 + 行 1。
        s.selectionPress(col: 0, row: 0, surfaceX: 0, surfaceY: 0, timeNs: 0)
        s.selectionDrag(col: 19, row: 1, surfaceX: 152, surfaceY: 16, columns: 20, cellWidthPx: 8, screenHeightPx: 96)
        s.selectionRelease(col: 19, row: 1)

        #expect(waitUntil { s.hasSelection() })
        #expect(s.copySelectionPlainText() == "abc\ndef")
    }

    @Test("无选区复制得 nil")
    func copyWithoutSelectionIsNil() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed("x")
        #expect(waitUntil { s.currentFrame() != nil })
        #expect(!s.hasSelection())
        #expect(s.copySelectionPlainText() == nil)
    }
}

@Suite("鼠标上报：tracking 门控 + Shift 旁通")
struct MouseReportingTests {

    private func press(shift: Bool) -> TerminalMouseReport {
        TerminalMouseReport(action: .press, button: .left, shift: shift, surfaceX: 0, surfaceY: 0)
    }

    @Test("DECSET 1000 开：无 Shift 编码上报（CSI M）/ Shift 旁通走选区（nil）/ 未开不上报（nil）")
    func trackingAndShiftBypass() throws {
        let s = try makeSession(cols: 80, rows: 24)
        defer { s.close() }
        s.feed("x")
        #expect(waitUntil { s.currentFrame() != nil })

        // 未开 tracking → nil（走选区）。
        #expect(s.encodeMouseReport(press(shift: false), screenWidthPx: 640, screenHeightPx: 384,
                                    cellWidthPx: 8, cellHeightPx: 16) == nil)

        // 开 normal tracking（DECSET 1000）。
        s.feed("\u{1b}[?1000h")
        let reported = try #require(s.encodeMouseReport(press(shift: false), screenWidthPx: 640, screenHeightPx: 384,
                                                        cellWidthPx: 8, cellHeightPx: 16))
        #expect(!reported.isEmpty)
        #expect(Array(reported.prefix(3)) == [0x1b, 0x5b, 0x4d])   // CSI M（X10 默认格式）

        // 按住 Shift → 旁通 → nil（走本地选区）。
        #expect(s.encodeMouseReport(press(shift: true), screenWidthPx: 640, screenHeightPx: 384,
                                    cellWidthPx: 8, cellHeightPx: 16) == nil)
    }
}

@Suite("视口绝对定位 .toOffset（DOGFOOD_M3_11 拇指拖拽会话侧）")
struct ScrollToOffsetTests {

    /// feed 多行制 scrollback，滚到顶取 total/len。
    private func makeScrolled(rows: UInt16 = 6, lines: Int = 100) throws -> (TerminalSession, ScrollbarSnapshot) {
        let s = try makeSession(cols: 40, rows: rows)
        for i in 0..<lines { s.feed("L\(i)-xxxxxxxxxxxxxxxxxxxx\r\n") }
        s.scrollViewport(.top)   // offset 0 + scrollbar 快照填充
        #expect(waitUntil { s.currentFrame()?.scrollbar != nil })
        let sb = try #require(s.currentFrame()?.scrollbar)
        return (s, sb)
    }

    @Test("中段定位：.toOffset(target) → 快照 offset == target（离底、viewportActive false）")
    func toOffsetMidRange() throws {
        let (s, sb) = try makeScrolled()
        defer { s.close() }
        let maxOffset = max(1, sb.total - sb.len)
        let target = maxOffset / 2
        #expect(target > 0 && target < maxOffset, "target 应在中段（\(target) / max \(maxOffset)）")

        s.scrollViewport(.toOffset(target))
        #expect(waitUntil { s.currentFrame()?.scrollbar?.offset == target })
        let off = s.currentFrame()?.scrollbar?.offset ?? -1
        #expect(off == target, "中段定位 offset==目标（实测 \(off)，目标 \(target)）")
        #expect(s.viewportActive == false, "中段离底 viewportActive false")
    }

    @Test("越底 clamp：.toOffset(≥maxOffset) → 贴底、viewportActive 恢复 true")
    func toOffsetBeyondBottomActivates() throws {
        let (s, sb) = try makeScrolled()
        defer { s.close() }
        #expect(s.viewportActive == false, "滚到顶后应离底")   // 前置：确在历史

        s.scrollViewport(.toOffset(sb.total + 10_000))   // 远超 maxOffset → clamp 贴底
        #expect(waitUntil { s.viewportActive })
        #expect(s.viewportActive == true, "≥maxOffset 定位应贴底、viewportActive 恢复 true")
    }
}

// MARK: - DOGFOOD_M3_17：Shift+Click 扩展选区（会话 API 驱动，隔离模式）

/// 内容行 = a..t（col n = 第 n 个小写字母）：copy 边界一目了然、断言精确到 cell。
private let alphabet20 = "abcdefghijklmnopqrst"

/// [lo...hi] 闭区间字母（选区端点两端**均含**，对齐 GhosttySelection「both endpoints inclusive」）。
private func alpha(_ lo: Int, _ hi: Int) -> String {
    String(Array(alphabet20)[lo...hi])
}

/// 建初始选区（普通 press/drag/release）：start = pressCol（gesture 锚点固定端）。surfaceX 取 dragCol 右半含末格。
@MainActor
private func buildSelection(_ s: TerminalSession, from pressCol: Int, to dragCol: Int, row: Int = 0,
                            cols: Int = 20, timeNs: UInt64 = 0) {
    s.selectionPress(col: pressCol, row: row, surfaceX: Double(pressCol * 8), surfaceY: Double(row * 16), timeNs: timeNs)
    s.selectionDrag(col: dragCol, row: row, surfaceX: Double(dragCol * 8 + 7), surfaceY: Double(row * 16),
                    columns: cols, cellWidthPx: 8, screenHeightPx: 96)
    s.selectionRelease(col: dragCol, row: row)
}

/// Shift+单击（press(shiftExtend:true) + release，无拖动）。
@MainActor
private func shiftClick(_ s: TerminalSession, col: Int, row: Int = 0, timeNs: UInt64 = 0) {
    s.selectionPress(col: col, row: row, surfaceX: Double(col * 8), surfaceY: Double(row * 16),
                     timeNs: timeNs, shiftExtend: true)
    s.selectionRelease(col: col, row: row)
}

@Suite("Shift+Click 扩展选区（DOGFOOD_M3_17，会话 API）", .serialized)
@MainActor
struct ShiftClickExtendControllerTests {

    // ① 点选区后 → 扩展 FORWARD：固定端 = 逻辑 start，end 移到点击格。
    @Test("① 点选区后：extend → copy == start..click（FORWARD）")
    func extendAfterSelection() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        buildSelection(s, from: 2, to: 4)   // start=(2,0)
        #expect(s.hasSelection())
        shiftClick(s, col: 10)              // extend (2,0)..(10,0)
        #expect(s.hasSelection(), "扩展不清选区")
        #expect(s.copySelectionPlainText() == alpha(2, 10), "FORWARD 扩展 cols 2..10")
        #expect(s.selectionReversedForTest() == false, "点选区后 → FORWARD")
    }

    // ② 点选区前 → REVERSE 选区（方向保持，不归一化）；copy 仍按终端序。
    @Test("② 点选区前：extend → REVERSE 选区 + copy 顺序正确")
    func extendBeforeSelectionReverses() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        buildSelection(s, from: 10, to: 12)   // start=(10,0)
        #expect(s.hasSelection())
        shiftClick(s, col: 2)                 // extend (10,0)..(2,0) → REVERSE
        #expect(s.hasSelection())
        #expect(s.selectionReversedForTest() == true, "点选区前 → REVERSE（方向保持，未归一化）")
        #expect(s.copySelectionPlainText() == alpha(2, 10), "copy 按终端序 cols 2..10（REVERSE 导出仍正确）")
    }

    // ③ 点选区中间 → 收缩为 start..click（xterm.js incremental 惯例，非最近端收缩）。
    @Test("③ 点选区中间：extend → 收缩为 start..click")
    func extendMiddleShrinks() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        buildSelection(s, from: 2, to: 15)   // start=(2,0)，选区 cols 2..15
        #expect(s.copySelectionPlainText() == alpha(2, 15))
        shiftClick(s, col: 8)                // 点中间 → 收缩 (2,0)..(8,0)
        #expect(s.copySelectionPlainText() == alpha(2, 8), "收缩为 start..click（cols 2..8）")
        #expect(s.selectionReversedForTest() == false)
    }

    // ④ anchor 存续实证：单击→release（无选区）→ shift-click → 期望 anchor..click。
    // 若红 = DATA_ANCHOR release 后 NO_VALUE → 启用备胎 C 并 spec 注记（见报告 anchor 实证结论）。
    @Test("④ anchor 存续实证：单击 release 后 shift-click → anchor..click")
    func anchorSurvivesReleaseForExtend() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        // 单击（press+release，无拖动）→ 普通路径清选区、无活选区，仅 gesture 记 anchor(5,0)。
        s.selectionPress(col: 5, row: 0, surfaceX: 40, surfaceY: 0, timeNs: 0)
        s.selectionRelease(col: 5, row: 0)
        #expect(!s.hasSelection(), "单击无拖动不建选区")

        shiftClick(s, col: 10, timeNs: 100_000_000)   // 取值链②：gesture 活 anchor(5,0) → extend (5,0)..(10,0)
        #expect(s.hasSelection(), "anchor 存续 → shift-click 应扩展（若红=anchor release 后失效，启用备胎 C）")
        #expect(s.copySelectionPlainText() == alpha(5, 10), "anchor..click = cols 5..10")
    }

    // ⑤ 无选区无 anchor 首击 shift+click → 退化普通 press；后续 drag 正常起选。
    @Test("⑤ 无选区无 anchor 首击 shift+click → 退化普通 press + 后续 drag 正常起选")
    func firstShiftClickDegradesThenDragSelects() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        // 首次交互即 shift+press（无选区无 anchor）→ 退化普通 press（单击态，未建选区）。
        s.selectionPress(col: 3, row: 0, surfaceX: 24, surfaceY: 0, timeNs: 0, shiftExtend: true)
        #expect(!s.hasSelection(), "退化普通 press 单击态未建选区")
        // 后续 drag 走普通 gesture cell-drag（extend 位未置）→ 起选 (3,0)..(8,0)。
        s.selectionDrag(col: 8, row: 0, surfaceX: 8 * 8 + 7, surfaceY: 0, columns: 20, cellWidthPx: 8, screenHeightPx: 96)
        s.selectionRelease(col: 8, row: 0)
        #expect(s.hasSelection(), "退化后 drag 正常起选")
        #expect(s.copySelectionPlainText() == alpha(3, 8), "drag 起选 cols 3..8")
    }

    // ⑥ 跨 scrollback：feed 100 行 → 底部建选区 → 上滚 → shift-click viewport 顶 → copy 含跨页整段。
    @Test("⑥ 跨 scrollback：底部建选区 → 上滚 → shift-click 顶 → 跨页整段")
    func extendAcrossScrollback() throws {
        let s = try makeSession(cols: 40, rows: 6)
        defer { s.close() }
        for i in 0..<100 { s.feed("L\(i)-xxxxxxxxxxxxxxxxxxxx\r\n") }
        s.scrollViewport(.bottom)
        #expect(waitUntil { s.currentFrame() != nil })

        buildSelection(s, from: 0, to: 5, row: 4, cols: 40)   // 底部行建选区（tracked 锚点）
        #expect(s.hasSelection())
        s.scrollViewport(.top)                                // 上滚回顶（viewport 顶 = L0）
        #expect(waitUntil { s.viewportActive == false })
        shiftClick(s, col: 0, row: 0)                         // 点 viewport 顶行行首 → extend 到底部锚点

        #expect(s.hasSelection())
        let copy = try #require(s.copySelectionPlainText())
        #expect(copy.hasPrefix("L0-"), "跨页整段应从顶行 L0 行首起（实测头部：\(copy.prefix(24))）")
        let lineCount = copy.split(separator: "\n", omittingEmptySubsequences: false).count
        #expect(lineCount > 50, "跨 scrollback 整段应含大量行（实测 \(lineCount) 行）")
    }

    // ⑦ shift-click 后继续 drag → end 随动、start 不动；release 后选区保留。
    @Test("⑦ shift-click 后 drag：end 随动 start 不动、release 后保留")
    func extendThenDragKeepsFixedStart() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        buildSelection(s, from: 2, to: 5)   // start=(2,0)
        // shift-press（不 release，进入 extend drag 序列）
        s.selectionPress(col: 10, row: 0, surfaceX: 80, surfaceY: 0, timeNs: 0, shiftExtend: true)
        #expect(s.copySelectionPlainText() == alpha(2, 10), "extend press → cols 2..10")
        // 继续 drag：end 随动、start 恒 (2,0)。
        s.selectionDrag(col: 15, row: 0, surfaceX: 15 * 8 + 7, surfaceY: 0, columns: 20, cellWidthPx: 8, screenHeightPx: 96)
        #expect(s.copySelectionPlainText() == alpha(2, 15), "drag → end 到 15，start 仍 2（cols 2..15）")
        s.selectionDrag(col: 8, row: 0, surfaceX: 8 * 8 + 7, surfaceY: 0, columns: 20, cellWidthPx: 8, screenHeightPx: 96)
        #expect(s.copySelectionPlainText() == alpha(2, 8), "drag 回退 → cols 2..8，start 仍固定")
        s.selectionRelease(col: 8, row: 0)
        #expect(s.hasSelection(), "release 后选区保留")
        #expect(s.copySelectionPlainText() == alpha(2, 8))
    }

    // ⑧ extend 后普通 click → 旧选区照清（extend 位不泄漏）。
    @Test("⑧ extend 后普通 click → 旧选区照清（位不泄漏）")
    func normalClickAfterExtendClears() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        buildSelection(s, from: 2, to: 5)
        shiftClick(s, col: 10)
        #expect(s.hasSelection())
        // 别处普通单击（远、久）→ 普通 press 清位 + 单击 NO_VALUE → 清选区。
        s.selectionPress(col: 15, row: 2, surfaceX: 120, surfaceY: 32, timeNs: 3_000_000_000)
        s.selectionRelease(col: 15, row: 2)
        #expect(!s.hasSelection(), "extend 后普通 click 照清旧选区（extend 位不泄漏）")
    }

    // ⑨ 500ms 内连续两次 shift-click → 第二次仍 extend、不升 WORD。
    @Test("⑨ 500ms 内连续两次 shift-click → 仍 extend 不升 WORD")
    func consecutiveShiftClicksStayExtend() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        buildSelection(s, from: 2, to: 4)          // start=(2,0)
        shiftClick(s, col: 10, timeNs: 0)          // extend (2,0)..(10,0)
        #expect(s.copySelectionPlainText() == alpha(2, 10))
        shiftClick(s, col: 14, timeNs: 100_000_000) // +100ms（<500ms）第二次仍 extend，非 WORD
        #expect(s.copySelectionPlainText() == alpha(2, 14), "第二次 shift-click 仍精确扩展 cols 2..14（未升 WORD）")
    }

    // ⑩ DECSET 1000 开 + Shift：encodeMouseReport 返 nil（旁通）+ extend 生效。
    @Test("⑩ tracking 开 + Shift：encodeMouseReport nil（旁通）+ extend 生效")
    func shiftBypassUnderTrackingStillExtends() throws {
        let s = try makeSession(cols: 80, rows: 24)
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        s.feed("\u{1b}[?1000h")   // 开 normal tracking
        #expect(waitUntil { s.currentFrame() != nil })

        // Shift 旁通：编码返 nil → 视图据此改走选区（本层直证旁通）。
        let report = TerminalMouseReport(action: .press, button: .left, shift: true, surfaceX: 0, surfaceY: 0)
        #expect(s.encodeMouseReport(report, screenWidthPx: 640, screenHeightPx: 384,
                                    cellWidthPx: 8, cellHeightPx: 16) == nil, "Shift 旁通 → nil（走选区）")
        // 走选区路径：建选区 + shift extend 照常。
        buildSelection(s, from: 2, to: 4, cols: 80)
        shiftClick(s, col: 10)
        #expect(s.hasSelection())
        #expect(s.copySelectionPlainText() == alpha(2, 10), "tracking 下经旁通仍 extend cols 2..10")
    }

    // ⑪ clearSelection 后 shift-click → anchor 兜底或退化（防御，不崩）。
    @Test("⑪ clearSelection 后 shift-click → 防御退化（不崩、无泄漏）")
    func shiftClickAfterClearIsDefensive() throws {
        let s = try makeSession()
        defer { s.close() }
        s.feed(alphabet20 + "\r\n")
        #expect(waitUntil { s.currentFrame() != nil })

        buildSelection(s, from: 2, to: 8)
        #expect(s.hasSelection())
        s.clearSelection()          // 清选区 + 重置 gesture（anchor 亦清）
        #expect(!s.hasSelection())
        shiftClick(s, col: 12)      // DATA_SELECTION 无、gesture anchor 已重置 → 退化普通 press → 单击清态
        #expect(!s.hasSelection(), "clearSelection 后 shift-click 退化（无 anchor→普通 press 单击态）")
    }
}
