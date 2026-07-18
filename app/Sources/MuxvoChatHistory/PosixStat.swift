// posix stat 薄封装：一次 syscall 取 size + mtime，且 mtime 以**整数毫秒**产出，
// 与 Node `stat.mtimeMs` 的 `Math.floor` 逐位对齐。
//
// 为何不用 FileManager.attributesOfItem：Node mtimeMs = tv_sec*1000 + tv_nsec/1e6（double），
// 双跑归一 floor 到整数 ms。本封装直接取 st_mtimespec 整数 (tv_sec, tv_nsec)，
// 算 tv_sec*1000 + tv_nsec/1_000_000（整除，正值 floor==trunc）——与 JS Math.floor(mtimeMs) 恒等，
// 消除 Double 往返在 ms 边界的 ±1 抖动（§8.2 规则2 mtime floor 到整数 ms）。

import Darwin
import Foundation

public enum PosixStat {
    public struct Info {
        public let size: Int
        /// 整数毫秒 mtime（= JS Math.floor(stat.mtimeMs)）。
        public let mtimeMs: Int64
        public let isDirectory: Bool
    }

    public static func of(_ url: URL) -> Info? {
        of(path: url.path)
    }

    public static func of(path: String) -> Info? {
        var st = stat()  // 零值 struct stat（0 参 → 结构体 init）
        guard stat(path, &st) == 0 else { return nil }  // 2 参 → C 函数 stat()
        let ms = Int64(st.st_mtimespec.tv_sec) * 1000 + Int64(st.st_mtimespec.tv_nsec) / 1_000_000
        return Info(
            size: Int(st.st_size),
            mtimeMs: ms,
            isDirectory: (UInt32(st.st_mode) & UInt32(S_IFMT)) == UInt32(S_IFDIR))
    }
}
