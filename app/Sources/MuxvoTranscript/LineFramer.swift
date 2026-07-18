// 行分帧（§2.1）：仅按 \n 分帧、不完整尾行缓冲等续、单行超上限截断。
// 与 harness 无关的纯字节层——CC / Codex 解析器共用，把「哪些字节构成一行」与
// 「这一行怎么解读」解耦。超限行不返 .line 而返 .oversize，交由上层转 parseError。

import Foundation

struct LineFramer {
    enum Frame: Equatable {
        case line(Data)   // 一条完整行（不含结尾 \n）
        case oversize     // 单行越过 maxLineBytes：已丢弃，上层应记 parseError
    }

    let maxLineBytes: Int
    private var buffer = Data()
    /// true 表示正处于「丢弃超限行剩余字节直到下一个 \n」状态（§2.1 截断后续行正常）。
    private var discardingOversize = false

    init(maxLineBytes: Int) {
        self.maxLineBytes = maxLineBytes
    }

    /// 喂入字节块，返回本次可定帧的所有帧；尾部不完整行留在 buffer 等下次。
    mutating func feed(_ chunk: Data) -> [Frame] {
        buffer.append(chunk)
        var frames: [Frame] = []

        while true {
            if discardingOversize {
                // 丢弃超限行残余，直到吃掉一个换行才恢复正常。
                if let nl = buffer.firstIndex(of: 0x0A) {
                    buffer = Data(buffer[buffer.index(after: nl)...])
                    discardingOversize = false
                    continue
                } else {
                    buffer.removeAll(keepingCapacity: true)
                    break
                }
            }

            if let nl = buffer.firstIndex(of: 0x0A) {
                let line = Data(buffer[..<nl])
                buffer = Data(buffer[buffer.index(after: nl)...])
                if line.count > maxLineBytes {
                    frames.append(.oversize)   // 完整但超限：整行丢弃
                } else {
                    frames.append(.line(line))
                }
                continue
            }

            // 尚无换行：若已积超上限则判定超限，进入丢弃态；否则缓冲等续。
            if buffer.count > maxLineBytes {
                frames.append(.oversize)
                discardingOversize = true
                buffer.removeAll(keepingCapacity: true)
            }
            break
        }
        return frames
    }
}
