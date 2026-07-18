// CC 项目/会话目录扫描（specs/behavior/chat-data.md §1.1）——fs 薄壳，注入 base 目录（不硬编码 ~/.claude）。
// base = `~/.claude/projects/`（live CC）或镜像根 `<dataRoot>/chat-history/`（§6.2，镜像同为扁平项目结构）。
//
// §1.1 逐字：
//  · 遍历 base 下每个**子目录**，目录名即 projectHash（dirName）；非目录项忽略。
//  · jsonlFiles = 子目录内 .jsonl；0 个 → 该目录丢弃（不产 DirFact）。
//  · sessionCount = jsonlFiles 数；totalSize = 各 .jsonl stat.size 之和（单个 stat 失败按 0）。
//  · lastActivity = **目录** mtimeMs（不逐文件求最新）。
//  · displayPath = jsonlFiles[0] 前 **10** 物理行中，首条能 JSON.parse 且含 `cwd` 的记录的 cwd；读不到留空。
//
// 双跑登记（jsonlFiles[0] 顺序）：legacy 取 Node readdirSync 顺序的首个 .jsonl 读 cwd；本层取
// FileManager.contentsOfDirectory 顺序的首个。两者均不保证排序——同项目多会话 cwd 通常一致，displayPath
// 不受影响；仅当同目录不同会话 cwd 分歧时 jsonlFiles[0] 选取差异才可能致 displayPath 偏差（§8 harness 兜底）。
import Foundation

public struct ChatDirectoryScanner {
    /// 扫描根：CC live = `~/.claude/projects/`；镜像 = `<dataRoot>/chat-history/`。
    public let base: URL
    /// displayPath 备忘（dogfood-r4 问题5）：命中 (首 .jsonl mtime,size) 免重读前 10 行取 cwd。nil = 不用备忘
    /// （测试/dump 原行为，每次真读）。
    public let displayPathMemo: DisplayPathMemo?
    /// 目录事实备忘（登记⑩，聊天扫描风暴根治）：命中目录 mtime 免整目录重扫。**只可用于镜像池 base**
    /// （池内写恒 rename/remove 必更目录 mtime；CC live 原地 append 不动目录 mtime，注入即漏更新）。
    /// nil = 不用备忘（cc scanner / 测试 / dump 原行为，每次真扫）。
    public let dirFactMemo: DirFactMemo?

    public init(base: URL, displayPathMemo: DisplayPathMemo? = nil, dirFactMemo: DirFactMemo? = nil) {
        self.base = base
        self.displayPathMemo = displayPathMemo
        self.dirFactMemo = dirFactMemo
    }

    /// 单个项目目录的扫描事实（§1.1）。
    public struct DirFact: Sendable, Equatable {
        public let dirName: String        // projectHash（可为 worktree 目录名，如 `P--worktrees-wt-1`）
        public let displayPath: String    // 首 session 前 10 行首个 cwd；读不到空串
        public let totalSize: Int          // 各 .jsonl stat.size 之和（单失败按 0）
        public let dirMtimeMs: Double      // 目录 mtime 毫秒
        public let files: [FileFact]       // 该目录 .jsonl 文件（sessionCount = files.count）
    }

    /// 单个会话文件事实。
    public struct FileFact: Sendable, Equatable {
        public let sessionId: String      // 文件名去 `.jsonl`
        public let url: URL
        public let size: Int
        public let mtimeMs: Double
    }

    /// 扫全部项目目录 → 事实列表（无 .jsonl 的目录丢弃，§1.1）。base 不存在 → 空。
    /// dirFactMemo 注入时：目录 mtime 命中免整目录重扫（compute 语义与无备忘路径逐字节同源——共用
    /// computeDirFact），收尾 sweepAbsent 标记消失目录；nil 路径行为零变。
    public func scan() -> [DirFact] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(atPath: base.path) else {
            dirFactMemo?.sweepAbsent(visited: [])  // base 不可枚举：全目录视为消失（原行为=空 facts → mirror 全清）
            return []
        }
        var facts: [DirFact] = []
        var visited: Set<String> = []
        for name in entries {
            let dir = base.appendingPathComponent(name, isDirectory: true)
            if let memo = dirFactMemo {
                // 备忘快路：单 stat 取 (isDir, mtime)；mtime 取扫描前快照（compute 期间目录再变 → 下轮必 miss）。
                guard let st = PosixStat.of(dir), st.isDirectory else { continue }
                visited.insert(name)
                if let fact = memo.fact(dirName: name, dirMtimeMs: st.mtimeMs,
                                        compute: { computeDirFact(name: name, dir: dir) }) {
                    facts.append(fact)
                }
                continue
            }
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else { continue }
            if let fact = computeDirFact(name: name, dir: dir) { facts.append(fact) }
        }
        dirFactMemo?.sweepAbsent(visited: visited)
        return facts
    }

    /// 单目录真扫（§1.1 语义原样）：listdir + 逐 .jsonl stat + displayPath。无 .jsonl / 不可枚举 → nil。
    private func computeDirFact(name: String, dir: URL) -> DirFact? {
        let fm = FileManager.default
        guard let inner = try? fm.contentsOfDirectory(atPath: dir.path) else { return nil }
        let jsonl = inner.filter { $0.hasSuffix(".jsonl") }
        if jsonl.isEmpty { return nil }  // 无 .jsonl 目录丢弃

        var files: [FileFact] = []
        var totalSize = 0
        for file in jsonl {
            let url = dir.appendingPathComponent(file, isDirectory: false)
            // PosixStat（st_mtimespec 整数毫秒）而非 FileManager Date：Double 秒往返在 ms 边界丢
            // 尾数会与 Node stat.mtimeMs 差 ±1ms，真数据双跑 724 会话必中（§8.2 mtime floor 红线）。
            let st = PosixStat.of(url)
            let size = st?.size ?? 0   // 单个 stat 失败按 0（§1.1）
            let mtimeMs = Double(st?.mtimeMs ?? 0)
            totalSize += size
            let sessionId = file.hasSuffix(".jsonl") ? String(file.dropLast(".jsonl".count)) : file
            files.append(FileFact(sessionId: sessionId, url: url, size: size, mtimeMs: mtimeMs))
        }

        let dirMtimeMs = Double(PosixStat.of(dir)?.mtimeMs ?? 0)
        // displayPath = 首 .jsonl（files[0] 与 jsonl[0] 同序）前 10 行首个 cwd。命中备忘（同 mtime,size）
        // 免重读；无备忘（nil）走原直读。files 非空（jsonl 非空已 guard），故 first 恒在。
        let displayPath: String
        if let firstFile = files.first {
            if let memo = displayPathMemo {
                displayPath = memo.displayPath(
                    firstJsonlPath: firstFile.url.path,
                    mtimeMs: Int64(firstFile.mtimeMs), size: firstFile.size,
                    compute: { readDisplayPath(firstFile.url) })
            } else {
                displayPath = readDisplayPath(firstFile.url)
            }
        } else {
            displayPath = ""
        }

        return DirFact(
            dirName: name, displayPath: displayPath,
            totalSize: totalSize, dirMtimeMs: dirMtimeMs, files: files)
    }

    /// jsonlFiles[0] 前 10 物理行中首条含 `cwd` 的记录的 cwd（§1.1）；读不到空串。
    private func readDisplayPath(_ file: URL) -> String {
        for line in ChatLineIO.firstLines(url: file, count: 10) {
            guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            if let cwd = obj["cwd"] as? String, !cwd.isEmpty { return cwd }
        }
        return ""
    }
}

// MARK: - 字节级行读取（scanner / indexer / store 共用）

/// 会话 JSONL 的字节级逐行读取工具（§1/§2/§3/§4 各路径的 fs 读取面）。批2 起替代批1 CodexFile 的整读切行，
/// 支持「前 N 行」「从 offset 续读到 EOF」「tail 从 size-2MB 起读」三态——indexer 断点续解析与 §3.6 tail 读依赖。
enum ChatLineIO {
    /// 读文件前 `count` 物理行（不含结尾 `\n`）。含末行未 `\n` 结尾时该末行照收（对齐 Node readline 末行语义）。
    static func firstLines(url: URL, count: Int) -> [Data] {
        guard count > 0, let handle = try? FileHandle(forReadingFrom: url) else { return [] }
        defer { try? handle.close() }
        var lines: [Data] = []
        var buffer = Data()
        while lines.count < count {
            let chunk = (try? handle.read(upToCount: 64 * 1024)) ?? Data()
            if chunk.isEmpty {
                if !buffer.isEmpty, lines.count < count { lines.append(buffer) }  // EOF：flush 末行
                break
            }
            buffer.append(chunk)
            while lines.count < count, let nl = buffer.firstIndex(of: 0x0A) {
                lines.append(Data(buffer[buffer.startIndex..<nl]))
                buffer = Data(buffer[buffer.index(after: nl)...])
            }
        }
        return lines
    }

    /// 从 `fromOffset` 起读到 EOF 的全部物理行（含末行未 `\n` 结尾）。`skipFirst` 丢首行（tail 读跳残行，§3.6）。
    /// 详情投影（messages 文件直读）用：非 tail 全读 = allLines(url)；tail = allLines(url, fromOffset: size-2MB, skipFirst: true)。
    static func allLines(url: URL, fromOffset: Int = 0, skipFirst: Bool = false) -> [Data] {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return [] }
        defer { try? handle.close() }
        try? handle.seek(toOffset: UInt64(max(0, fromOffset)))
        let data = (try? handle.readToEnd()) ?? Data()
        var lines: [Data] = []
        var start = 0
        let n = data.count
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            var i = 0
            while i < n {
                if raw[i] == 0x0A {
                    lines.append(data.subdata(in: (data.startIndex + start)..<(data.startIndex + i)))
                    start = i + 1
                }
                i += 1
            }
        }
        if start < n { lines.append(data.subdata(in: (data.startIndex + start)..<(data.startIndex + n))) }
        if skipFirst, !lines.isEmpty { lines.removeFirst() }
        return lines
    }

    /// 从 `fromOffset` 起逐**完整**行（`\n` 结尾）回调 body（尾部残行不回调）；返回处理完最后一整行后的字节偏移。
    /// body 参数：(该行字节, 处理后偏移)。indexer 用返回值更新 indexed_bytes（断点落行边界）。
    @discardableResult
    static func forEachLine(url: URL, fromOffset: Int, _ body: (Data, Int) -> Void) -> Int {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return fromOffset }
        defer { try? handle.close() }
        try? handle.seek(toOffset: UInt64(max(0, fromOffset)))
        let data = (try? handle.readToEnd()) ?? Data()
        var lineStart = 0
        var i = 0
        let n = data.count
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            while i < n {
                if raw[i] == 0x0A {
                    let line = data.subdata(in: (data.startIndex + lineStart)..<(data.startIndex + i))
                    body(line, fromOffset + i + 1)
                    lineStart = i + 1
                }
                i += 1
            }
        }
        return fromOffset + lineStart  // 尾部残行不计入（下轮从此处续读）
    }
}
