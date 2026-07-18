// DOGFOOD_M3_16 reflow 丢行止血——受控复现哨（先红后绿）。
//
// 现场（logs/dogfood16-forensics.md）：同一 CC 会话，muxvo2 scrollback 比其他终端「丢一整块
// 连续内容 + 错位拼接重复」。cols 在 ~2 分钟内 44→102→136→60→136→102 六次 rewrap，其中
// 136→60 腰斩 + 60→136 复宽是 reflow 行计账最脆处。字符级 diff 坐实：缺失 1876 字（跨消息
// 焊接）、重复 62 字（孤儿拆片复用）。
//
// 本哨直驱 TerminalSession.resize（headless 隔离模式，无 UI/无 Ink），灌 500 条唯一可校验
// 逻辑行（含 CJK 双宽 + 画框字符 + 软换行长行），施加现场同构宽度风暴，每步经 dumpPlainText
// (unwrap:true) 抽标签序列对账 {无丢失 / 无重复 / 保序}。
//
// 复现层次结论（见 logs/dogfood16-fix-report.md）：若本哨在 headless 直驱下即红 → bug 在
// libghostty reflow 内核；若绿 → reflow 内核对「干净顺序 resize」无损，现场损坏发生在 Ink
// 擦除×reflow 时序交互层（muxvo 侧修复走「减少 resize 连抖」，另见 SurfaceResizeSettleHostTests
// 的 settle-only 直证）。两种结论本哨都如实暴露。
import Foundation
import Testing
import MuxvoTermCore
@testable import MuxvoTerm

@Suite("DOGFOOD_M3_16 reflow 丢行受控复现（headless 直驱 TerminalSession.resize）", .serialized)
struct ReflowStormTests {

    /// 语料行数（forensics §三 复现方案 N≈500）。
    private static let lineCount = 500

    /// 隔离会话（无真 PTY），起始宽网格，足量 scrollback 预算（默认 12MiB，500 行远不触封顶）。
    private func makeSession(cols: UInt16, rows: UInt16) throws -> TerminalSession {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = cols
        cfg.rows = rows
        return try TerminalSession(config: cfg)
    }

    /// 一条唯一可校验逻辑行：`L####␠<CJK+画框+填充，够宽在 136 列也软换行>␠E####`。
    /// 无行内换行（软换行由 vt 按当刻宽度折），逻辑行之间以 \r\n 硬分隔。
    private func corpusLine(_ i: Int) -> String {
        let tag = String(format: "L%04d", i)
        let end = String(format: "E%04d", i)
        // ~180+ 显示列：ASCII 词 + CJK 双宽 + 画框字符，复刻真实 CC 输出的宽字元/折行边界应力。
        let body = "报表発注振り返り │─┼ 回看窗口约37个月 品类投放强度修正 "
            + "断货还原生命周期衰减广告修正 ┐└│ 供应异常标注找本部往季订货记录 "
            + "26SS看板 2024-2025历史insights 只读GET补拉 filler-\(i)-xyzzy-padding"
        return "\(tag) \(body) \(end)"
    }

    /// 灌全部语料（单次 feed，\r\n 硬分隔）。
    private func feedCorpus(_ session: TerminalSession) {
        var blob = String()
        blob.reserveCapacity(Self.lineCount * 220)
        for i in 1...Self.lineCount {
            blob += corpusLine(i)
            blob += "\r\n"
        }
        session.feed(blob)
    }

    /// 从 unwrap dump 抽 `L####` 标签的出现序列（保留重复与顺序）。
    private func extractTags(_ session: TerminalSession) -> [Int] {
        let dump = session.dumpPlainText(trim: true, unwrap: true)
        var tags: [Int] = []
        let scalars = Array(dump.unicodeScalars)
        var idx = 0
        let zero = Unicode.Scalar("0").value, nine = Unicode.Scalar("9").value
        let bigL = Unicode.Scalar("L").value
        while idx < scalars.count {
            if scalars[idx].value == bigL, idx + 4 < scalars.count {
                var digits = 0, value = 0, ok = true
                for k in 1...4 {
                    let v = scalars[idx + k].value
                    if v >= zero && v <= nine { value = value * 10 + Int(v - zero); digits += 1 }
                    else { ok = false; break }
                }
                if ok, digits == 4 {
                    // 只收真标签（1...500），排除正文里偶发的 L#### 误匹配（正文无此形）。
                    if value >= 1, value <= Self.lineCount { tags.append(value) }
                    idx += 5; continue
                }
            }
            idx += 1
        }
        return tags
    }

    /// 对账断言：无丢失 + 无重复 + 保序。失败时给出精确诊断（缺失/重复/首个乱序对）。
    private func assertIntact(_ tags: [Int], step: String) {
        let expected = Array(1...Self.lineCount)
        let seen = Set(tags)
        let missing = expected.filter { !seen.contains($0) }
        var counts: [Int: Int] = [:]
        for t in tags { counts[t, default: 0] += 1 }
        let duplicated = counts.filter { $0.value > 1 }.keys.sorted()
        // 保序：过滤到合法标签后应严格单调递增。
        var firstDisorder: (Int, Int)? = nil
        for k in 1..<tags.count where tags[k] <= tags[k - 1] {
            firstDisorder = (tags[k - 1], tags[k]); break
        }
        #expect(missing.isEmpty,
                "[\(step)] 丢失 \(missing.count) 个标签（无丢失断言）：\(missing.prefix(12))…")
        #expect(duplicated.isEmpty,
                "[\(step)] 重复 \(duplicated.count) 个标签（无重复断言）：\(duplicated.prefix(12))…")
        #expect(firstDisorder == nil,
                "[\(step)] 乱序/焊接（保序断言）：首个逆序对 \(String(describing: firstDisorder))")
    }

    @Test("现场同构全序列风暴 44→102→136→60→136→102：每步 scrollback 无丢失/无重复/保序")
    func fieldStormKeepsAllLines() throws {
        // 起始宽 = 44（forensics 实测事发前 scrollback 静置宽度，最贴近受损行数量级），
        // 走完整六档同构序列——含首要嫌疑 44→102 大幅合并（>2.3×）与 136→60 腰斩（>2.2×）。
        let session = try makeSession(cols: 44, rows: 42)
        defer { session.close() }
        feedCorpus(session)

        // baseline：风暴前必须完整（否则语料/封顶问题，非 reflow bug）。
        assertIntact(extractTags(session), step: "baseline@44")

        // 现场同构 resize 风暴（cell 8×16 默认；宽度是唯一变量）。
        let storm: [(UInt16, UInt16)] = [(102, 42), (136, 51), (60, 51), (136, 51), (102, 42)]
        for (c, r) in storm {
            #expect(session.resize(cols: c, rows: r))
            assertIntact(extractTags(session), step: "after \(c)x\(r)")
        }
    }

    @Test("最大压力：深腰斩 136→30 + 复宽 + 风暴期间续灌（流式中 resize 的现场同构）")
    func deepNarrowWithInterleavedFeedKeepsAllLines() throws {
        // 加压①：腰斩到 30 列（<45% of 136，forensics §五 建议的深窄化）。
        // 加压②：风暴各步之间续灌新语料——复刻现场「CC 正流式吐字时用户切布局」，逼软换行
        //         续行标志在「有活跃写入 + reflow」叠加下崩账（若 vendor 内核有该缺陷即暴露）。
        let session = try makeSession(cols: 136, rows: 51)
        defer { session.close() }

        var fed = 0
        func feedChunk(_ n: Int) {
            var blob = String()
            for _ in 0..<n { fed += 1; blob += corpusLine(fed); blob += "\r\n" }
            session.feed(blob)
        }
        feedChunk(200)
        let storm: [(UInt16, UInt16)] = [(30, 51), (136, 51), (60, 42), (136, 51), (44, 42), (136, 51)]
        for (c, r) in storm {
            #expect(session.resize(cols: c, rows: r))
            feedChunk(50) // 续灌：流式中 resize
        }
        // 全部续灌 200 + 6×50 = 500 行；末态对账（此测标签总数 = fed）。
        let tags = extractTags(session)
        let seen = Set(tags)
        let missing = (1...fed).filter { !seen.contains($0) }
        var counts: [Int: Int] = [:]; for t in tags { counts[t, default: 0] += 1 }
        let dup = counts.filter { $0.value > 1 }.keys.sorted()
        #expect(missing.isEmpty, "深压力丢失 \(missing.count)：\(missing.prefix(12))…")
        #expect(dup.isEmpty, "深压力重复 \(dup.count)：\(dup.prefix(12))…")
    }

    @Test("腰斩再翻倍最小子用例 136→60→136：拆/合双向 rewrap 无丢失/无重复/保序")
    func halveThenDoubleKeepsAllLines() throws {
        let session = try makeSession(cols: 136, rows: 51)
        defer { session.close() }
        feedCorpus(session)
        assertIntact(extractTags(session), step: "baseline@136")

        #expect(session.resize(cols: 60, rows: 51)) // 腰斩（拆分方向）
        assertIntact(extractTags(session), step: "after 60x51（腰斩）")
        #expect(session.resize(cols: 136, rows: 51)) // 复宽（合并方向）
        assertIntact(extractTags(session), step: "after 136x51（复宽）")
    }
}

// MARK: - 修复① 同尺寸硬短路（消除 spurious SIGWINCH/forceFull，DOGFOOD_M3_16）

@Suite("DOGFOOD_M3_16 resize 同尺寸硬短路（不调 ghostty resize、不 forceFull、无 spurious 帧）", .serialized)
struct ResizeSameSizeShortCircuitTests {

    private func waitGen(_ s: TerminalSession, atLeast g: UInt64, timeout: TimeInterval = 5) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if (s.currentFrame()?.generation ?? 0) >= g { return true }
            usleep(2_000)
        }
        return (s.currentFrame()?.generation ?? 0) >= g
    }

    @Test("同尺寸 resize 不触发 render update（generation 不变）；异尺寸仍触发全量重建")
    func sameSizeResizeIsNoOpButDiffStillRebuilds() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 80; cfg.rows = 24
        let s = try TerminalSession(config: cfg)
        defer { s.close() }

        s.feed("hello\r\n")
        #expect(waitGen(s, atLeast: 1)) // 首帧到位（单次 feed → generation 1）
        let gen0 = s.currentFrame()?.generation ?? 0
        #expect(gen0 >= 1)

        // 同尺寸 resize（cols/rows 均未变）：应硬短路——不 forceFull、无新帧。
        // dumpPlainText 的 queue.sync 作屏障，drain 任何已入队的 async update。
        #expect(s.resize(cols: 80, rows: 24)) // 幂等 accepted（会话已在此尺寸）
        _ = s.dumpPlainText()
        let genAfterSame = s.currentFrame()?.generation ?? 0
        #expect(genAfterSame == gen0) // 旧代码红：gen0+1（同尺寸也 requestImmediateUpdate 触发 spurious 帧）

        // 异尺寸 resize：仍须触发全量重建（防过度短路——真几何变化必重排）。
        #expect(s.resize(cols: 100, rows: 30))
        #expect(waitGen(s, atLeast: gen0 + 1))
        let genAfterDiff = s.currentFrame()?.generation ?? 0
        #expect(genAfterDiff > gen0)
        #expect(Int(s.cols) == 100 && Int(s.rows) == 30)
    }
}
