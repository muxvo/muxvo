// displayPath 备忘（dogfood-r4 问题5）——ChatDirectoryScanner 每次 scan() 都读每目录首 .jsonl 前 10 物理行
// 取 cwd 作 displayPath；面板每次查询 + 每次 FSEvent reconcile 都重扫 → 同一文件被反复小读。本备忘按
// 首 .jsonl 的 (mtimeMs, size) 命中即复用缓存 displayPath，miss 才真读。
//
// 「同 (path, mtime, size) 内容变更不生效」为**设计内**（对齐 CodexIndexCache 先例；会话文件追加型写必增
// size，rename/覆盖改 mtime，故正常演进都会失效重算——只有「同尺寸原地改 cwd 且不动 mtime」这种不自然写
// 才漏刷，真数据不出现）。字典按路径键覆盖，删除的项目留陈旧项（O(项目数)，可接受，不做换字典逐出）。
import Foundation

public final class DisplayPathMemo: @unchecked Sendable {
    private struct Entry { let mtimeMs: Int64; let size: Int; let displayPath: String }

    private let lock = NSLock()
    private var cache: [String: Entry] = [:]

    public init() {}

    /// 命中 (path, mtimeMs, size) → 复用缓存 displayPath；否则调 `compute()` 真读、存、返回。
    /// `compute` 在锁外执行（不持锁做文件 IO）；并发 miss 各自算、末者胜（同 (mtime,size) 值一致，无害）。
    public func displayPath(
        firstJsonlPath path: String, mtimeMs: Int64, size: Int, compute: () -> String
    ) -> String {
        lock.lock()
        if let hit = cache[path], hit.mtimeMs == mtimeMs, hit.size == size {
            lock.unlock()
            return hit.displayPath
        }
        lock.unlock()
        let value = compute()
        lock.lock()
        cache[path] = Entry(mtimeMs: mtimeMs, size: size, displayPath: value)
        lock.unlock()
        return value
    }
}
