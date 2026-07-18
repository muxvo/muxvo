// Codex 源纯函数内核（ChatModels-free）：projectHash 编码 / sessionId 提取 / 搜索 snippet 窗口 /
// 目录发现。行为权威 specs/behavior/chat-data.md §5，对照 legacy codex-chat-source.ts（读行为不抄结构）。
//
// 纪律：这些函数不依赖四输出类型（ChatModels），只吃/吐 String / URL / 内部结构，可独立单测。
// 与 CC 侧编码红线（§0/§5.3 CD_codex_projecthash_matches_cc）在此实现——UTF-16 码元逐字符对齐 JS。
import Foundation

/// cwd → projectHash 编码（§5.3 红线）。legacy `cwd.replace(/[^a-zA-Z0-9-]/g,'-')`（codex-chat-source.ts:37-40）。
///
/// 必须与 CC 目录名编码逐字符一致（同 cwd 两源产同 projectHash，聚合层才能归并进同一项目）。
/// JS `replace` 无 `u` flag → 按 **UTF-16 码元** 迭代：BMP 字符（含中文）是单码元，非 [A-Za-z0-9-] 即整体 `-`；
/// 非 BMP（emoji）是代理对两码元，各自 `-` → 一个 emoji 出 `--`（§7 NIT，与 JS 一致此处刻意复刻）。
enum CodexProjectHash {
    static func encode(_ cwd: String) -> String {
        if cwd.isEmpty { return "" }  // legacy `if (!cwd) return ''`
        let dash: UTF16.CodeUnit = 0x2D  // '-'
        var units: [UTF16.CodeUnit] = []
        units.reserveCapacity(cwd.utf16.count)
        for u in cwd.utf16 {
            let allowed =
                u == dash
                || (u >= 0x30 && u <= 0x39)   // 0-9
                || (u >= 0x41 && u <= 0x5A)   // A-Z
                || (u >= 0x61 && u <= 0x7A)   // a-z
            units.append(allowed ? u : dash)
        }
        return String(decoding: units, as: UTF16.self)
    }
}

/// 从 rollout 文件名提取 sessionId（§5.1）。legacy extractSessionId(43-52）：
/// `rollout-YYYY-MM-DDTHH-MM-SS-{UUID}.jsonl` 去 `.jsonl`、按 `-` 切、取末 5 段 join（UUID 5 组），
/// 不足 5 段用整 base。注：`_buildSummary`/index 优先用 session_meta.payload.id（id 权威），本函数是文件名兜底。
enum CodexSessionId {
    static func extract(fromFileName fileName: String) -> String {
        // node basename(filename, '.jsonl')：先去目录、再去 .jsonl 后缀。
        var base = (fileName as NSString).lastPathComponent
        if base.hasSuffix(".jsonl") { base = String(base.dropLast(".jsonl".count)) }
        let parts = base.components(separatedBy: "-")
        if parts.count >= 5 {
            return parts.suffix(5).joined(separator: "-")
        }
        return base
    }
}

/// Codex 搜索 snippet（§5.3 per-source：命中前 30 + query + 后 30，非 CC 的 170）。
/// legacy search(407-455)：`start = message.toLowerCase().indexOf(query.toLowerCase())`；
/// `snippet = message.slice(max(0, start-30), start + query.length + 30)`。
///
/// 复刻 legacy 的 UTF-16 语义（红线）：indexOf 在 **lowercased** 串上取码元偏移，slice 施于 **原始** message
/// 同一码元偏移，query 长度用 **原始 query** 的 UTF-16 长度。lowercased 若改变长度，与 legacy 同样按 lowered
/// 偏移切原串（legacy 既有行为，双跑同源对照）。无命中返回 nil（调用方跳过该文件）。
enum CodexSnippet {
    static let after = 30
    static let before = 30

    static func make(message: String, query: String) -> String? {
        let loweredMsgUnits = Array(message.lowercased().utf16)
        let loweredQueryUnits = Array(query.lowercased().utf16)
        guard let start = firstIndex(of: loweredQueryUnits, in: loweredMsgUnits) else { return nil }

        let origUnits = Array(message.utf16)
        let origLen = origUnits.count
        let queryLen = query.utf16.count
        // JS slice(a,b)：a<0 已被 max(0,...) 挡；a/b 超长各自 clamp 到 len；a>=b → ''。
        let a = min(max(0, start - before), origLen)
        let b = min(start + queryLen + after, origLen)
        guard a < b else { return "" }
        return String(decoding: origUnits[a..<b], as: UTF16.self)
    }

    /// UTF-16 码元级子串首现下标（对齐 JS String.indexOf）。needle 空串返回 0（同 JS indexOf('')）。
    private static func firstIndex(of needle: [UTF16.CodeUnit], in haystack: [UTF16.CodeUnit]) -> Int? {
        if needle.isEmpty { return 0 }
        if needle.count > haystack.count { return nil }
        let last = haystack.count - needle.count
        var i = 0
        while i <= last {
            var j = 0
            while j < needle.count && haystack[i + j] == needle[j] { j += 1 }
            if j == needle.count { return i }
            i += 1
        }
        return nil
    }
}

/// Codex 会话目录发现（§5.1）。根 `<codexBase>/sessions/YYYY/MM/DD/*.jsonl`，三层数字校验，
/// 每层读失败静默跳过（legacy findAllSessionFiles:204-245）。fs 薄壳——纯扫描、不解析文件内容。
enum CodexDirectory {
    /// 返回 sessions 下全部 `.jsonl` 绝对路径（顺序不保证，消费方另按 mtime 排序）。
    static func findAllSessionFiles(sessionsDir: URL) -> [URL] {
        let fm = FileManager.default
        var out: [URL] = []
        guard let years = try? fm.contentsOfDirectory(atPath: sessionsDir.path) else { return out }
        for year in years where isDigits(year, count: 4) {
            let yearDir = sessionsDir.appendingPathComponent(year, isDirectory: true)
            guard let months = try? fm.contentsOfDirectory(atPath: yearDir.path) else { continue }
            for month in months where isDigits(month, count: 2) {
                let monthDir = yearDir.appendingPathComponent(month, isDirectory: true)
                guard let days = try? fm.contentsOfDirectory(atPath: monthDir.path) else { continue }
                for day in days where isDigits(day, count: 2) {
                    let dayDir = monthDir.appendingPathComponent(day, isDirectory: true)
                    guard let entries = try? fm.contentsOfDirectory(atPath: dayDir.path) else { continue }
                    for entry in entries where entry.hasSuffix(".jsonl") {
                        out.append(dayDir.appendingPathComponent(entry, isDirectory: false))
                    }
                }
            }
        }
        return out
    }

    /// 对齐 legacy 三层正则 `^\d{N}$`：长度精确、全 ASCII 数字。
    static func isDigits(_ s: String, count: Int) -> Bool {
        guard s.utf8.count == count else { return false }
        return s.utf8.allSatisfy { $0 >= 0x30 && $0 <= 0x39 }
    }
}
