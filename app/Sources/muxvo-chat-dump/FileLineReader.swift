// 流式逐行读（对齐 legacy Node `createReadStream + readline({crlfDelay: Infinity})`）。
//
// 语义对齐：
//  · 行分隔按 `\n`；行内尾随 `\r` 剥除（crlfDelay Infinity 把 `\r\n` 视作一个换行）。
//  · 最后一行无尾随换行也产出（readline 收尾行为）。空行产出为 ""（计入行序）。
//  · body 返回 false → 早停（readFirstLines 满 N / search 命中即停）。
//  · 支持 start 字节偏移（readSession >2MB tail 读，从 size-2MB 起）。
//
// 性能：64KB 分块 + 每块处理完整行、仅保留尾残片（O(n)，避免逐行 removeSubrange 的 O(n²)）。
// \n(0x0A) 不出现在 UTF-8 多字节序列内部，故按 \n 切行不会切断字符，逐行 UTF-8 解码安全。

import Foundation

enum FileLineReader {
    static let newline: UInt8 = 0x0A
    static let carriageReturn: UInt8 = 0x0D

    /// 逐行遍历 url（自 start 偏移起）。body 返回 false 即停。
    static func forEachLine(url: URL, start: UInt64 = 0, _ body: (String) -> Bool) {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return }
        defer { try? handle.close() }
        if start > 0 { try? handle.seek(toOffset: start) }

        // O(n) 流式切行：`scanned` 记录 buffer 已扫过（无 \n）的前缀长度，跨块携带——超长行
        // （base64 图/大 tool 输出，单行远超 chunk）时每块只扫新增字节、不重扫、不逐块整体复制，
        // 避免 O(行长²) 爆炸。每块处理完整行后**一次**丢弃已消费前缀（非逐行 removeSubrange）。
        var buffer = Data()
        var scanned = 0  // buffer[0..<scanned] 已确认无 \n
        let chunkSize = 1 << 16
        while let chunk = try? handle.read(upToCount: chunkSize), !chunk.isEmpty {
            buffer.append(chunk)
            var lineStart = 0
            var searchFrom = scanned
            while let nl = buffer[searchFrom...].firstIndex(of: newline) {  // 绝对索引
                if !body(decodeLine(buffer.subdata(in: lineStart..<nl))) { return }
                lineStart = nl + 1
                searchFrom = lineStart
            }
            if lineStart > 0 { buffer.removeSubrange(0..<lineStart) }  // 每块一次
            scanned = buffer.count  // 剩余尾片已扫、无 \n
        }
        if !buffer.isEmpty {
            _ = body(decodeLine(buffer))
        }
    }

    /// 读前 maxLines 个物理行（含空行，计入预算；对齐 legacy readFirstLines）。
    static func firstLines(url: URL, maxLines: Int) -> [String] {
        var lines: [String] = []
        lines.reserveCapacity(maxLines)
        forEachLine(url: url) { line in
            lines.append(line)
            return lines.count < maxLines
        }
        return lines
    }

    private static func decodeLine(_ data: Data) -> String {
        var d = data
        if d.last == carriageReturn { d = d.dropLast() }
        return String(decoding: d, as: UTF8.self)
    }
}
