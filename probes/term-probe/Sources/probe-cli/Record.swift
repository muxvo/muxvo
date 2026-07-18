// record 子命令：用 PTYHost 录制真实 CLI 输出为 asciinema v2 .cast。
// 自写 recorder 的原因：本机无 asciinema，且需要程序化注入输入（给 CC 发提示词）。
// 事件按 UTF-8 边界缓冲（PTY read 会把多字节字符切在 chunk 边界，
// 直接转 String 会产生替换符，破坏回放保真）。
import Dispatch
import Foundation
import ProbeCore

/// 把 bytes 切成（合法 UTF-8 前缀, 不完整尾部）。尾部 ≤3 字节，留给下个 chunk。
func splitUTF8Boundary(_ bytes: [UInt8]) -> (valid: [UInt8], tail: [UInt8]) {
    guard !bytes.isEmpty else { return ([], []) }
    // 从尾部回看最多 3 字节找多字节序列起点
    var cut = bytes.count
    var i = bytes.count - 1
    var back = 0
    while i >= 0, back < 4 {
        let b = bytes[i]
        if b & 0b1100_0000 == 0b1000_0000 {
            // continuation byte，继续回看
            i -= 1
            back += 1
            continue
        }
        // 找到序列首字节，算期望长度
        let expected: Int
        if b & 0b1000_0000 == 0 { expected = 1 }
        else if b & 0b1110_0000 == 0b1100_0000 { expected = 2 }
        else if b & 0b1111_0000 == 0b1110_0000 { expected = 3 }
        else if b & 0b1111_1000 == 0b1111_0000 { expected = 4 }
        else { expected = 1 } // 非法字节，按 1 算（lossy 交给 String 处理）
        let have = bytes.count - i
        if have < expected { cut = i } // 序列没收完，整段留尾
        break
    }
    return (Array(bytes[0..<cut]), Array(bytes[cut...]))
}

struct TimedSend {
    let at: Double
    let text: String
}

func parseEscapes(_ s: String) -> String {
    s.replacingOccurrences(of: "\\r", with: "\r")
        .replacingOccurrences(of: "\\n", with: "\n")
        .replacingOccurrences(of: "\\t", with: "\t")
}

func runRecord(args: [String]) -> Int32 {
    var out = ""
    var cols: UInt16 = 120
    var rows: UInt16 = 40
    var duration: Double = 60
    var command: String?
    var sends: [TimedSend] = []

    var i = 0
    while i < args.count {
        let a = args[i]
        func next() -> String? {
            i += 1
            return i < args.count ? args[i] : nil
        }
        switch a {
        case "--out": out = next() ?? ""
        case "--cols": cols = UInt16(next() ?? "") ?? cols
        case "--rows": rows = UInt16(next() ?? "") ?? rows
        case "--duration": duration = Double(next() ?? "") ?? duration
        case "--command": command = next()
        case "--send":
            // 格式 "<秒>:<文本>"，文本支持 \r \n \t 转义
            if let v = next(), let colon = v.firstIndex(of: ":"),
               let t = Double(v[..<colon]) {
                sends.append(TimedSend(at: t, text: parseEscapes(String(v[v.index(after: colon)...]))))
            }
        default:
            FileHandle.standardError.write("unknown record arg: \(a)\n".data(using: .utf8)!)
            return 2
        }
        i += 1
    }
    guard !out.isEmpty, command != nil else {
        FileHandle.standardError.write("record requires --out and --command\n".data(using: .utf8)!)
        return 2
    }
    sends.sort { $0.at < $1.at }

    FileManager.default.createFile(atPath: out, contents: nil)
    guard let fh = FileHandle(forWritingAtPath: out) else {
        FileHandle.standardError.write("cannot open \(out)\n".data(using: .utf8)!)
        return 1
    }
    let header: [String: Any] = [
        "version": 2,
        "width": Int(cols),
        "height": Int(rows),
        "timestamp": Int(Date().timeIntervalSince1970),
        "env": ["TERM": "xterm-256color", "SHELL": "/bin/zsh"],
    ]
    let headerData = try! JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])
    fh.write(headerData)
    fh.write("\n".data(using: .utf8)!)

    let queue = DispatchQueue(label: "muxvo.probe.record")
    let sink = CastSink(fh: fh)

    let pty: PTYHost
    do {
        pty = try PTYHost(command: command, cols: cols, rows: rows, queue: queue) { bytes in
            sink.ingest(bytes)
        }
    } catch {
        FileHandle.standardError.write("record spawn failed: \(error)\n".data(using: .utf8)!)
        return 1
    }

    // 主线程时间轴：按计划注入输入，到时收尾
    var sendIdx = 0
    let start = Date()
    while Date().timeIntervalSince(start) < duration {
        let elapsed = Date().timeIntervalSince(start)
        while sendIdx < sends.count, sends[sendIdx].at <= elapsed {
            pty.write(sends[sendIdx].text)
            FileHandle.standardError.write(
                "[record] t=\(Int(elapsed))s sent #\(sendIdx)\n".data(using: .utf8)!)
            sendIdx += 1
        }
        Thread.sleep(forTimeInterval: 0.2)
    }
    pty.terminate()
    queue.sync { sink.finish() } // 残尾 lossy 写出
    try? fh.close()
    print("record done: \(out) bytes=\(sink.bytesTotal) events=\(sink.eventCount) duration=\(Int(duration))s")
    return sink.bytesTotal > 0 ? 0 : 1
}

/// .cast 事件写出器。ingest/finish 仅在 PTY 回调队列上调用（串行），
/// bytesTotal/eventCount 在 pty 终止后读取——@unchecked Sendable 套路同 TerminalSession。
final class CastSink: @unchecked Sendable {
    private let fh: FileHandle
    private let t0 = DispatchTime.now()
    private var tail: [UInt8] = []
    private(set) var bytesTotal: UInt64 = 0
    private(set) var eventCount = 0

    init(fh: FileHandle) {
        self.fh = fh
    }

    func ingest(_ bytes: [UInt8]) {
        var buf = tail
        buf.append(contentsOf: bytes)
        let (valid, rest) = splitUTF8Boundary(buf)
        tail = rest
        bytesTotal += UInt64(bytes.count)
        writeEvent(valid)
    }

    func finish() {
        if !tail.isEmpty {
            writeEvent(tail)
            tail = []
        }
    }

    private func writeEvent(_ bytes: [UInt8]) {
        guard !bytes.isEmpty else { return }
        let t = Double(DispatchTime.now().uptimeNanoseconds - t0.uptimeNanoseconds) / 1e9
        let s = String(decoding: bytes, as: UTF8.self)
        let ev: [Any] = [(t * 1e6).rounded() / 1e6, "o", s]
        if let d = try? JSONSerialization.data(withJSONObject: ev) {
            fh.write(d)
            fh.write("\n".data(using: .utf8)!)
            eventCount += 1
        }
    }
}
