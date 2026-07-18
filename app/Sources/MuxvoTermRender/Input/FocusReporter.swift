// FocusReporter：包裹 libghostty `ghostty_focus_encode`（terminal-input.md §7）。
// gained → CSI I（`\x1b[I`）、lost → CSI O（`\x1b[O`）。mode 1004 门控由调用方查，本类只编码。
import CGhosttyVT

public enum FocusReporter {
    public static func encode(gained: Bool) -> [UInt8] {
        let ev: GhosttyFocusEvent = gained ? GHOSTTY_FOCUS_GAINED : GHOSTTY_FOCUS_LOST
        var buf = [CChar](repeating: 0, count: 8)
        var written = 0
        let rc = buf.withUnsafeMutableBufferPointer {
            ghostty_focus_encode(ev, $0.baseAddress, $0.count, &written)
        }
        guard rc == GHOSTTY_SUCCESS, written > 0 else { return [] }
        return buf[0..<written].map { UInt8(bitPattern: $0) }
    }
}
