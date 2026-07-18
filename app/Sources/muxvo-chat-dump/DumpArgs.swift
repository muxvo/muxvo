// muxvo-chat-dump 参数解析（chat-data.md §8 双跑 harness）。
//
// 用法：
//   muxvo-chat-dump --cc-base <dir> [--codex-base <dir>] [--mirror <dir>] [--db <path>] <cmd> [flags]
//
// 源推断（§8.3 per-source 主口径）：
//   仅 --cc-base       → CC-only 对照
//   仅 --codex-base    → Codex-only 对照
//   两者都给           → aggregate（多源归并/去重/排序，§5.4）
//
// 目录约定（与 legacy-dump.mts 对齐；见 tools/chat-dual-run/README）：
//   --cc-base    = CC 项目目录（直接含 <hash>/ 子目录，如 ~/.claude/projects）。basename 须为
//                  `projects`——legacy createChatProjectReader 内部 join(ccBasePath,'projects')，
//                  故 legacy 侧取 dirname 还原；本 dump 直接扫此目录。
//   --codex-base = Codex sessions 目录（含 YYYY/MM/DD/，如 ~/.codex/sessions）。两侧均取 dirname
//                  作 codex 根，全局标题读 <root>/.codex-global-state.json。
//   --mirror     = 镜像/归档扁平目录（含 <hash>/ 子目录），直接作 archivePath（可选）。
//   --db         = chat.db 路径（临时实现未用；A2-1 ChatStore 落地后接通预留）。
//
// 命令（cmd）：
//   index                                     全量首扫（性能记录，非 diff 面）
//   projects                                  ProjectInfo[]
//   sessions --project <hash> | --all [--limit N]   SessionSummary[]
//   session  --project <hash> --session <id> [--limit N]  SessionMessage[]
//   search   --query <q>                      SearchResult[]
//   merge-archive --source <dir> --dest <dir> [--marker <path>] [--dry-run]
//     离线归档并入（legacy-archive-reclaim 批）：把归档目录（<hash>/<sessionId>.jsonl 扁平布局，
//     per-分身 legacy 镜像或老版 ~/.muxvo/chat-archive）并入共享池。--dry-run 只读预估不写盘；
//     真跑必须给 --marker（幂等 seal，migrator 语义）。不依赖 --cc-base/--codex-base。
//     ⚠️ --dest 必须显式给出（不从 DataDirectory 派生）——CLI 永不默认指向真实池，防误写。

import Foundation

struct DumpArgs {
    enum Command: Equatable {
        case index
        case projects
        case sessionsProject(hash: String)
        case sessionsAll
        case session(project: String, session: String)
        case search(query: String)
        case mergeArchive(source: URL, dest: URL, marker: URL?, dryRun: Bool)
    }

    /// CC/aggregate 侧读者后端：`shell` = 临时 CCFileSource（默认，逐字复刻 legacy 文件级编排）；
    /// `chatstore` = A2-1 正式 ChatStore（chat.db reconcile + 查询面）——批2 真验收即验此 vs legacy。
    enum Reader: String { case shell, chatstore }

    var ccBase: URL?
    var codexBase: URL?
    var mirror: URL?
    var dbPath: URL?
    var limit: Int?
    var reader: Reader = .shell
    var command: Command

    enum SourceMode { case cc, codex, aggregate }

    var sourceMode: SourceMode {
        switch (ccBase != nil, codexBase != nil) {
        case (true, true): return .aggregate
        case (false, true): return .codex
        default: return .cc
        }
    }

    struct ParseError: Error, CustomStringConvertible {
        let message: String
        var description: String { message }
    }

    static func parse(_ argv: [String]) throws -> DumpArgs {
        var ccBase: URL?
        var codexBase: URL?
        var mirror: URL?
        var dbPath: URL?
        var limit: Int?
        var project: String?
        var sessionId: String?
        var query: String?
        var all = false
        var reader: Reader = .shell
        var source: URL?
        var dest: URL?
        var marker: URL?
        var dryRun = false
        var positional: [String] = []

        func dirURL(_ p: String) -> URL { URL(fileURLWithPath: (p as NSString).expandingTildeInPath) }

        var i = 0
        let a = argv
        func next(_ flag: String) throws -> String {
            i += 1
            guard i < a.count else { throw ParseError(message: "\(flag) 缺参数") }
            return a[i]
        }

        while i < a.count {
            let tok = a[i]
            switch tok {
            case "--cc-base": ccBase = dirURL(try next(tok))
            case "--codex-base": codexBase = dirURL(try next(tok))
            case "--mirror": mirror = dirURL(try next(tok))
            case "--db": dbPath = dirURL(try next(tok))
            case "--limit":
                let v = try next(tok)
                guard let n = Int(v) else { throw ParseError(message: "--limit 非整数：\(v)") }
                limit = n
            case "--project": project = try next(tok)
            case "--session": sessionId = try next(tok)
            case "--query": query = try next(tok)
            case "--reader":
                let v = try next(tok)
                guard let r = Reader(rawValue: v) else { throw ParseError(message: "--reader 须 shell|chatstore：\(v)") }
                reader = r
            case "--all": all = true
            case "--source": source = dirURL(try next(tok))
            case "--dest": dest = dirURL(try next(tok))
            case "--marker": marker = dirURL(try next(tok))
            case "--dry-run": dryRun = true
            case "-h", "--help": throw ParseError(message: usage)
            default:
                if tok.hasPrefix("--") { throw ParseError(message: "未知参数：\(tok)") }
                positional.append(tok)
            }
            i += 1
        }

        guard let cmdName = positional.first else {
            throw ParseError(message: "缺子命令\n\(usage)")
        }
        // merge-archive 是独立离线命令，不依赖 CC/Codex 源。
        guard cmdName == "merge-archive" || ccBase != nil || codexBase != nil else {
            throw ParseError(message: "至少给 --cc-base 或 --codex-base")
        }

        let command: Command
        switch cmdName {
        case "index":
            command = .index
        case "projects":
            command = .projects
        case "sessions":
            if all {
                command = .sessionsAll
            } else if let p = project {
                command = .sessionsProject(hash: p)
            } else {
                throw ParseError(message: "sessions 需 --project <hash> 或 --all")
            }
        case "session":
            guard let p = project, let s = sessionId else {
                throw ParseError(message: "session 需 --project <hash> --session <id>")
            }
            command = .session(project: p, session: s)
        case "search":
            guard let q = query else { throw ParseError(message: "search 需 --query <q>") }
            command = .search(query: q)
        case "merge-archive":
            guard let s = source, let d = dest else {
                throw ParseError(message: "merge-archive 需 --source <dir> --dest <dir>")
            }
            guard dryRun || marker != nil else {
                throw ParseError(message: "merge-archive 真跑必须给 --marker <path>（或用 --dry-run 只读预估）")
            }
            command = .mergeArchive(source: s, dest: d, marker: marker, dryRun: dryRun)
        default:
            throw ParseError(message: "未知命令：\(cmdName)\n\(usage)")
        }

        // merge-archive 专属 flag 不得泄漏到其它命令（保持 main 版「未知参数即拒」的严格性）。
        if case .mergeArchive = command {} else {
            guard source == nil, dest == nil, marker == nil, !dryRun else {
                throw ParseError(message: "--source/--dest/--marker/--dry-run 仅 merge-archive 可用")
            }
        }

        return DumpArgs(
            ccBase: ccBase, codexBase: codexBase, mirror: mirror, dbPath: dbPath,
            limit: limit, reader: reader, command: command)
    }

    static let usage = """
    用法：muxvo-chat-dump --cc-base <dir> [--codex-base <dir>] [--mirror <dir>] [--db <path>] <cmd> [flags]
      cmd: index | projects | sessions (--project <hash>|--all) [--limit N]
           | session --project <hash> --session <id> [--limit N] | search --query <q>
           | merge-archive --source <dir> --dest <dir> [--marker <path>] [--dry-run]
      merge-archive 语义：--dry-run 只读预估（不看也不写 marker）；真跑必带 --marker，
      marker 已存在则幂等跳过（seal 后 no-op），有硬失败不写 marker、退出码 65 下次可重跑
    """
}
