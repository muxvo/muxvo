// 真 git fixture 工具（批A，plan-native §7.1）：每用例临时目录 git init + 空 commit 起步。
// git 环境封闭——注入 env GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 + `-c user.name/email`：
// 防用户全局 hooks/签名/别名污染，防无身份机器 commit 失败。teardown 先 chmod 回写再递归删
// （PERM_DENIED 用例会留 000 目录）。
import Foundation
import MuxvoKit

enum GitTestFixture {
    /// 隔离 env（服务侧 GitCLI 与 fixture 自跑的 git 同用）。
    static let isoEnv = ["GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"]

    /// 服务注入用 GitCLI（仅隔离 env——服务命令 rev-parse/worktree/branch 均不需提交身份）。
    static var git: GitCLI { GitCLI(environment: isoEnv) }

    /// 建独立临时 git 仓（`init -b main` + 空 commit），返回仓根 URL。调用方 defer `cleanup`。
    static func makeRepo() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-git-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        run(["init", "-b", "main"], in: base.path)
        run(["commit", "--allow-empty", "-m", "init"], in: base.path)
        return base
    }

    /// 在 dir 跑 git（带提交身份 + 隔离 env）。返回原始输出供断言。
    @discardableResult
    static func run(_ args: [String], in dir: String, timeout: TimeInterval = 30) -> GitCLI.Output {
        GitCLI.runSync(
            executable: "git",
            args: ["-C", dir, "-c", "user.name=Muxvo Test", "-c", "user.email=test@muxvo.local"] + args,
            environment: isoEnv, timeout: timeout)
    }

    /// 递归删（chmod 回写先行——PERM_DENIED 用例留 000 目录会阻断删除）。
    static func cleanup(_ url: URL) {
        let fm = FileManager.default
        if let en = fm.enumerator(at: url, includingPropertiesForKeys: nil, options: []) {
            for case let f as URL in en {
                try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: f.path)
            }
        }
        try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        try? fm.removeItem(at: url)
    }
}
