// InkByteReplayTests：m3-layout-r5 红锚E——真实 CC/Ink 字节流 × 事发宽度序列回放，甄别 vendor reflow 边界。
//
// 动机：DOGFOOD_M3_16 的「vendor reflow 无损」结论仅基于合成纯追加行（零擦除/零光标寻址/零 SGR/
// 无 Ink 帧）——本哨用真实 CC 会话的 PTY 原始字节（script(1) 录制：含 Ink 帧重绘、EL/ED 擦除、SGR
// 反色、CJK 双宽）补该盲区。
// oracle：固定宽参考回放（无 resize）的「稳定内容行」（unwrap 逻辑行）在风暴回放（2026-07-07 事发
// 纪元宽度序列中途插入，含 40→19 行骤降）终态中 ①逐行存在 ②首现顺序保持（order-preserving
// subsequence）。**允许额外重复**——Ink 陈旧擦除残骸 = R-D 地板（muxvo/行业固有），非 vendor 损坏；
// 缺行 / 错序才是 vendor reflow 或集成缺陷信号（若红：单开缺陷向上游/自查集成，勿在本单顺手修）。
// 捕获件不进 git（体积+外部生成内容）：环境变量 MUXVO_INK_CAPTURE 指路径；缺省/缺文件本哨静默跳过
// （CI 天然跳过；本地取证跑法见 logs/m3-r5-inkreplay-verdict.md）。
//
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID。
import Foundation
import Testing
@testable import MuxvoTerm

@Suite("真实 Ink 字节流回放甄别（m3-layout-r5 红锚E）", .serialized)
struct InkByteReplayTests {

    private func makeSession() throws -> TerminalSession {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 100; cfg.rows = 40
        return try TerminalSession(config: cfg)
    }

    /// NBSP 归一化：实测发现的唯一 rewrap 伪影——宽/歧义字符（如 ⏺ U+23FA）折行边界后，原字节流的
    /// 普通空格 0x20 在风暴回放的纯文本提取里变 U+00A0（2026-07-07 首跑 hex 实证：ref `e28fba 20`
    /// vs storm `e28fba c2a0`，单字节类替换、内容完整）。属提取层外观伪影非数据损坏（渲染同为空白；
    /// 选区复制保真度 minor，记 backlog）。oracle 容忍之，只盯真丢行/错序。
    private func normalizeNBSP(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{00A0}", with: " ")
    }

    /// 稳定内容行：unwrap 逻辑行中足够长的实质行（滤掉 Ink 瞬态 UI 短行/空行）；保首现顺序、去重。
    private func stableLines(_ dump: String) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in dump.split(separator: "\n", omittingEmptySubsequences: true) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard line.count >= 12 else { continue }
            guard !seen.contains(line) else { continue }
            seen.insert(line)
            out.append(line)
        }
        return out
    }

    @Test("真 CC 字节流经事发宽度风暴：稳定内容行不丢、首现保序（重复=Ink 地板，允许）")
    func realInkBytesSurviveWidthStorm() throws {
        guard let path = ProcessInfo.processInfo.environment["MUXVO_INK_CAPTURE"],
              let data = FileManager.default.contents(atPath: path), data.count > 4_000 else {
            return // 无捕获件：哨位保留、静默跳过（激活方法见文件头）
        }
        let bytes = [UInt8](data)

        // 参考：固定 100×40 一次性回放（无 resize）→ 稳定行基准。
        let ref = try makeSession()
        defer { ref.close() }
        ref.feed(bytes)
        let refLines = stableLines(normalizeNBSP(ref.dumpPlainText(unwrap: true)))
        try #require(refLines.count >= 8) // 捕获件必须有实质内容（防空捕获假绿）

        // 风暴：同字节流，2026-07-07 事发纪元序列在等分偏移处插入（含 29 列窄化与 40→19 行骤降）。
        let storm = try makeSession()
        defer { storm.close() }
        let epochs: [(cols: UInt16, rows: UInt16)] = [
            (88, 40), (39, 40), (58, 40), (29, 19), (76, 19), (50, 40), (88, 19), (100, 40),
        ]
        let chunk = max(1, bytes.count / (epochs.count + 1))
        var off = 0
        for e in epochs {
            let end = min(off + chunk, bytes.count)
            if end > off { storm.feed(Array(bytes[off..<end])); off = end }
            _ = storm.resize(cols: e.cols, rows: e.rows)
        }
        if off < bytes.count { storm.feed(Array(bytes[off...])) }
        let stormDump = normalizeNBSP(storm.dumpPlainText(unwrap: true))

        // ①不丢 ②首现保序（order-preserving subsequence；残骸重复穿插允许）。
        var searchFrom = stormDump.startIndex
        var missing: [String] = []
        var outOfOrder: [String] = []
        for line in refLines {
            if let r = stormDump.range(of: line, range: searchFrom..<stormDump.endIndex) {
                searchFrom = r.upperBound
            } else if stormDump.contains(line) {
                outOfOrder.append(line)
            } else {
                missing.append(line)
            }
        }
        // 取证落盘（仅失败时）：两侧 unwrap dump 供人工对质（区分真丢行 vs CJK 双宽 rewrap 边界
        // 的拼接伪影——奇数宽度下双宽字符不可跨行，rewrap 可能引入 spacer 差异）。
        if !missing.isEmpty || !outOfOrder.isEmpty {
            try? (refLines.joined(separator: "\n")).write(
                toFile: path + ".ref.txt", atomically: true, encoding: .utf8)
            try? stormDump.write(toFile: path + ".storm.txt", atomically: true, encoding: .utf8)
        }
        #expect(missing.isEmpty, "疑似 vendor/集成缺行（前3）：\(missing.prefix(3))")
        #expect(outOfOrder.isEmpty, "疑似 vendor/集成错序（前3）：\(outOfOrder.prefix(3))")
    }
}
