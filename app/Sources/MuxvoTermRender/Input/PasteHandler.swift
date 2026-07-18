// PasteHandler：包裹 libghostty `ghostty_paste_is_safe` / `ghostty_paste_encode`
// （terminal-input.md §3）。纯函数：安全判定 + bracketed 编码，bracketed 标志由调用方
// （查活终端 mode 2004）传入，故本类不需终端句柄、可独立测试。
import CGhosttyVT

public enum PasteHandler {
    /// 是否安全粘贴：含换行 / bracketed 结束序列 `\x1b[201~` → 不安全（vt 判定，与终端态无关）。
    /// 空串视为安全。
    public static func isSafe(_ text: String) -> Bool {
        let bytes = Array(text.utf8).map { CChar(bitPattern: $0) }
        if bytes.isEmpty { return true }
        return bytes.withUnsafeBufferPointer { ghostty_paste_is_safe($0.baseAddress, $0.count) }
    }

    /// 编码粘贴数据 → 待写 PTY 字节。bracketed=true 包 `\x1b[200~…\x1b[201~`；否则换行转 CR。
    /// vt 会剥离不安全控制字节（NUL/ESC/DEL 等替空格）。
    ///
    /// 注意：vt 在编码时**原地改写 data**，故一次给足缓冲、不做「先测尺寸再编码」两段式
    /// （否则第二次会在已被改写的数据上跑）。上界 = 原长 + bracketed 包裹 12 字节，取 +16 冗余；
    /// 万一仍 OUT_OF_SPACE，用返回的所需尺寸 + 全新数据副本重跑一次。
    public static func encode(_ text: String, bracketed: Bool) -> [UInt8] {
        let src = Array(text.utf8).map { CChar(bitPattern: $0) }
        func run(bufLen: Int) -> (GhosttyResult, [CChar], Int) {
            var data = src               // 每次都用未改写的新副本
            var buf = [CChar](repeating: 0, count: max(bufLen, 1))
            var written = 0
            let rc = data.withUnsafeMutableBufferPointer { dp in
                buf.withUnsafeMutableBufferPointer { bp in
                    ghostty_paste_encode(dp.baseAddress, dp.count, bracketed, bp.baseAddress, bp.count, &written)
                }
            }
            return (rc, buf, written)
        }
        var (rc, buf, written) = run(bufLen: src.count + 16)
        if rc == GHOSTTY_OUT_OF_SPACE, written > 0 { (rc, buf, written) = run(bufLen: written) }
        guard rc == GHOSTTY_SUCCESS, written > 0 else { return [] }
        return buf[0..<written].map { UInt8(bitPattern: $0) }
    }
}
