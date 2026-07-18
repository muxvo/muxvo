// 终端 golden 生成器（批 4①，terminal-rendering.md §6）。
//
// 用 TerminalRenderer.renderOffscreen 同 encode 路径（buildInstances→encode→离屏 readback）渲
// 固定 fixture → PNG + SHA-256，落 tools/term-golden/golden/。授权清单 specs/term-golden.json。
// 沿用「本机字节冻结、即截即 commit、不进 CI」纪律（§6）：
//   - MUXVO_TERM_GOLDEN=1 门控——未置位早退（trivial pass），常规 app.sh test 不生成、不判红。
//   - 无 GPU（MTLCreateSystemDefaultDevice==nil）早退——降级记录待补。
//   - 同一快照+cursorMode 确定性渲染 → PNG 字节稳定；生成后留工作树由主会话 commit。
import AppKit
import CoreText
import CryptoKit
import Foundation
import Metal
import Testing
@testable import MuxvoTerm
@testable import MuxvoTermRender

// 固定网格与字体（§6：Menlo 14 @2x）。
private let goldenCols = 40
private let goldenRows = 12
private let goldenScale: CGFloat = 2
private let goldenFont = FontConfig(family: "Menlo", size: 14)

/// 一个 golden fixture：id + 说明 + 灌入字节 + 光标模式 + 可选滚动。
private struct GoldenFixture {
    let id: String
    let desc: String
    let feed: String
    let cursor: CursorRenderMode
    /// 灌入后滚动视口（负=向历史上滚）；nil=不滚。
    let scrollDelta: Int?
}

private let fixtures: [GoldenFixture] = [
    GoldenFixture(id: "basic-text", desc: "基础文本：多行 ASCII + 标点",
                  feed: "Muxvo terminal golden\r\nThe quick brown fox jumps\r\n0123456789 !@#$%^&*()_+-=\r\n",
                  cursor: .hidden, scrollDelta: nil),
    GoldenFixture(id: "ansi16", desc: "ANSI 16 色：8 常规 fg + 8 明亮 fg + 背景块",
                  feed: ansi16Feed(), cursor: .hidden, scrollDelta: nil),
    GoldenFixture(id: "truecolor", desc: "24-bit truecolor 背景渐变条",
                  feed: truecolorFeed(), cursor: .hidden, scrollDelta: nil),
    GoldenFixture(id: "cjk-emoji", desc: "CJK + emoji 宽字符（含 grapheme cluster）",
                  feed: "你好，世界！终端\r\nTerminal 🌍✨🚀 日本語\r\n한국어 テスト 中文\r\n",
                  cursor: .hidden, scrollDelta: nil),
    GoldenFixture(id: "sgr-styles", desc: "SGR 样式：粗/斜/下划线/反显/删除线",
                  feed: "\u{1b}[1mBold\u{1b}[0m \u{1b}[3mItalic\u{1b}[0m \u{1b}[4mUnderline\u{1b}[0m\r\n"
                      + "\u{1b}[7mInverse\u{1b}[0m \u{1b}[9mStrike\u{1b}[0m \u{1b}[2mFaint\u{1b}[0m\r\n",
                  cursor: .hidden, scrollDelta: nil),
    GoldenFixture(id: "cursor-block", desc: "实心块光标（solid）落在提示符后",
                  feed: "muxvo$ echo hi", cursor: .solid, scrollDelta: nil),
    GoldenFixture(id: "scrollback-mid", desc: "scrollback 中位：灌 60 行后上滚 24 行",
                  feed: scrollbackFeed(lines: 60), cursor: .hidden, scrollDelta: -24),
]

private func ansi16Feed() -> String {
    var s = ""
    for c in 30...37 { s += "\u{1b}[\(c)m██" }
    s += "\u{1b}[0m\r\n"
    for c in 90...97 { s += "\u{1b}[\(c)m██" }
    s += "\u{1b}[0m\r\n"
    for c in 40...47 { s += "\u{1b}[\(c)m  " }
    s += "\u{1b}[0m\r\n"
    return s
}

private func truecolorFeed() -> String {
    var s = ""
    for x in 0..<36 {
        let r = x * 7
        s += "\u{1b}[48;2;\(r);0;\(255 - r)m "
    }
    s += "\u{1b}[0m\r\n"
    for x in 0..<36 {
        let g = x * 7
        s += "\u{1b}[48;2;0;\(g);\(255 - g)m "
    }
    s += "\u{1b}[0m\r\n"
    return s
}

private func scrollbackFeed(lines: Int) -> String {
    var s = ""
    for n in 1...lines { s += String(format: "line-%02d ", n) + String(repeating: "·", count: 20) + "\r\n" }
    return s
}

@Suite("终端 golden 生成器（MUXVO_TERM_GOLDEN 门控）")
@MainActor
struct TermGoldenGenerator {
    @Test("renderOffscreen 同 encode 路径生成 golden PNG + SHASUMS")
    func generate() throws {
        guard ProcessInfo.processInfo.environment["MUXVO_TERM_GOLDEN"] == "1" else { return }
        guard let device = MTLCreateSystemDefaultDevice() else {
            FileHandle.standardError.write("无 GPU：终端 golden 降级待补\n".data(using: .utf8)!)
            return
        }
        let cache = GlyphCache(font: goldenFont, scale: goldenScale, device: device)
        let renderer = TerminalRenderer(glyphCache: cache, device: device)
        guard renderer.canRender else {
            FileHandle.standardError.write("Metal pipeline 建失败：终端 golden 降级待补\n".data(using: .utf8)!)
            return
        }
        let m = FontMetrics.measure(goldenFont, scale: goldenScale)
        let widthPx = goldenCols * m.widthPx
        let heightPx = goldenRows * m.heightPx

        let outDir = goldenOutDir()
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

        var shasums: [(id: String, sha: String)] = []
        for fx in fixtures {
            var cfg = TerminalSession.Config()
            cfg.cols = UInt16(goldenCols); cfg.rows = UInt16(goldenRows)
            cfg.spawnShell = false
            let s = try TerminalSession(config: cfg)
            defer { s.close() }

            let g0 = s.currentFrame()?.generation ?? 0
            s.feed(fx.feed)
            if let d = fx.scrollDelta { s.scrollViewport(.delta(d)) }
            s.requestImmediateFrame()
            #expect(waitUntil(timeout: 3) { (s.currentFrame()?.generation ?? 0) > g0 },
                    "\(fx.id): 快照未更新")
            let snap = try #require(s.currentFrame())
            let out = try #require(
                renderer.renderOffscreen(snap, cursorMode: fx.cursor, widthPx: widthPx, heightPx: heightPx),
                "\(fx.id): renderOffscreen 返回 nil")

            let png = try #require(pngFromBGRA(out.bytes, width: widthPx, height: heightPx),
                                   "\(fx.id): PNG 编码失败")
            let url = outDir.appendingPathComponent("\(fx.id).png")
            try png.write(to: url)
            let sha = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
            shasums.append((fx.id, sha))
            FileHandle.standardError.write("golden \(fx.id).png  \(png.count)B  \(sha.prefix(12))…\n".data(using: .utf8)!)
        }

        // SHASUMS256.txt（确定性排序，供回归 diff）。
        let manifest = shasums.sorted { $0.id < $1.id }
            .map { "\($0.sha)  \($0.id).png" }.joined(separator: "\n") + "\n"
        try manifest.write(to: outDir.appendingPathComponent("SHASUMS256.txt"), atomically: true, encoding: .utf8)
        FileHandle.standardError.write("golden 清单已写：\(outDir.path)（\(shasums.count) 张）\n".data(using: .utf8)!)
    }
}

// MARK: - 辅助

/// tools/term-golden/golden/（从 #filePath 上溯 4 层到仓库根；可经 MUXVO_TERM_GOLDEN_OUT 覆盖）。
@MainActor private func goldenOutDir() -> URL {
    if let override = ProcessInfo.processInfo.environment["MUXVO_TERM_GOLDEN_OUT"] {
        return URL(fileURLWithPath: override, isDirectory: true)
    }
    var root = URL(fileURLWithPath: #filePath)   // …/muxvo/app/Tests/MuxvoTermGoldenTests/GoldenGenerator.swift
    for _ in 0..<4 { root.deleteLastPathComponent() }   // → …/muxvo
    return root.appendingPathComponent("tools/term-golden/golden", isDirectory: true)
}

/// bgra8（tight rows）→ RGBA NSBitmapImageRep → PNG data。
@MainActor private func pngFromBGRA(_ bgra: [UInt8], width: Int, height: Int) -> Data? {
    guard bgra.count == width * height * 4 else { return nil }
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32),
        let dst = rep.bitmapData else { return nil }
    // BGRA → RGBA（交换 B/R 通道）。
    for p in stride(from: 0, to: bgra.count, by: 4) {
        dst[p] = bgra[p + 2]; dst[p + 1] = bgra[p + 1]; dst[p + 2] = bgra[p]; dst[p + 3] = bgra[p + 3]
    }
    return rep.representation(using: .png, properties: [:])
}

/// 轮询等待条件（golden 生成在 @MainActor 测试线程，会话更新在会话 queue 上异步落）。
@MainActor private func waitUntil(timeout: TimeInterval, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while !cond() {
        if Date() >= deadline { return false }
        usleep(2000)
    }
    return true
}
