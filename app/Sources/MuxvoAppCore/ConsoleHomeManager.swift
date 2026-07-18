// 指挥台 console-home 双层所有权管理（M4b' B4' T5，command-console.md §4）。
//
// `<dataRoot>/console-home/` = 指挥台 claude 的 cwd。双层所有权：
//   · `.claude/skills/muxvo-console/SKILL.md` = **app-owned**：每次开台核 hash——失配即以出厂版
//     （ConsoleSkillResource.skillMarkdown）覆写（升级更新 + 防漂移 + 版本头）。两次开台字节幂等。
//   · `CLAUDE.md` = **user-owned**：首次缺失时生成最小默认，存在即**永不覆写**（用户自定义面）。
import CryptoKit
import Foundation
import MuxvoStorage

public enum ConsoleHomeManager {
    /// console-home 根 = <dataRoot>/console-home（路径字面量归 DataDirectory.Layout，preflight step 6 纪律）。
    public static func consoleHomeURL(dataRoot: URL) -> URL {
        DataDirectory.consoleHomeDirectoryURL(under: dataRoot)
    }

    /// muxvo-console skill 落盘位置（console-home/.claude/skills/muxvo-console/SKILL.md）。
    public static func skillFileURL(dataRoot: URL) -> URL {
        consoleHomeURL(dataRoot: dataRoot)
            .appendingPathComponent(".claude/skills/muxvo-console/SKILL.md", isDirectory: false)
    }

    /// user-owned CLAUDE.md 位置。
    public static func claudeMdURL(dataRoot: URL) -> URL {
        consoleHomeURL(dataRoot: dataRoot).appendingPathComponent("CLAUDE.md", isDirectory: false)
    }

    /// 确保 console-home 布局（开台前调）：app-owned SKILL.md 核 hash 覆写 + user-owned CLAUDE.md 首生。
    /// 返回 console-home 根 URL（供 spawn cwd）。幂等：SKILL.md 与出厂一致则零写、CLAUDE.md 存在则不动。
    @discardableResult
    public static func ensure(dataRoot: URL) throws -> URL {
        let home = consoleHomeURL(dataRoot: dataRoot)
        let skillFile = skillFileURL(dataRoot: dataRoot)
        try FileManager.default.createDirectory(
            at: skillFile.deletingLastPathComponent(), withIntermediateDirectories: true)

        // app-owned SKILL.md：核 hash（对出厂 known-good digest），失配/缺失 → 以出厂版覆写。
        let want = ConsoleSkillResource.skillMarkdown
        let wantDigest = sha256(want)
        let currentDigest = (try? String(contentsOf: skillFile, encoding: .utf8)).map { sha256($0) }
        if currentDigest != wantDigest {
            try AtomicFile.write(Data(want.utf8), to: skillFile, durability: .full)
        }

        // user-owned CLAUDE.md：仅缺失时生成，存在即永不覆写。
        let claudeMd = claudeMdURL(dataRoot: dataRoot)
        if !FileManager.default.fileExists(atPath: claudeMd.path) {
            try AtomicFile.write(Data(ConsoleSkillResource.defaultClaudeMd.utf8), to: claudeMd, durability: .full)
        }
        return home
    }

    /// sha256 hex（skill 核 hash 键）。
    static func sha256(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
