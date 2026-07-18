// GitStatusCache 纯逻辑单测（批A，plan-native §4）：上溯 / gitdir 解析 / porcelain 路径 / 注册比对 /
// 值变判定——全 static 纯函数（FileManager stat 无子进程），并行安全，故独立于串行重进程套件。
// 缓存行为（假时钟 TTL / onChange 守卫 / invalidate，含真 git 探针）在 NativeFsSerialTests 内串行跑。
// 命名纪律：非 spec-ID 翻牌，测试名不像 spec ID。
import Foundation
import Testing
@testable import MuxvoAppCore

@Suite("GitStatusCache 纯逻辑：上溯 / gitdir / porcelain / 注册 / 值变")
struct GitStatusCachePureTests {

    @Test("walkUpForGit：.git 目录=主仓、.git 文件(gitdir)=linked、无 .git=nil（上溯到根）")
    func walkUpClassifies() {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-walk-\(UUID().uuidString)", isDirectory: true)
        let fm = FileManager.default
        defer { try? fm.removeItem(at: root) }

        // ① .git 目录 → 主仓（isLinkedWorktree=false）
        let mainRepo = root.appendingPathComponent("main", isDirectory: true)
        try? fm.createDirectory(at: mainRepo.appendingPathComponent(".git"), withIntermediateDirectories: true)
        let sub = mainRepo.appendingPathComponent("src", isDirectory: true)
        try? fm.createDirectory(at: sub, withIntermediateDirectories: true)
        let w1 = GitStatusCache.walkUpForGit(cwd: sub.path)
        #expect(w1?.isLinkedWorktree == false)
        #expect(w1?.repoRoot == mainRepo.standardizedFileURL.path) // 子目录上溯命中主仓

        // ② .git 文件（gitdir: 指主仓）→ linked worktree；worktreeRoot=找到 .git 文件那层
        let wt = root.appendingPathComponent("wt", isDirectory: true)
        try? fm.createDirectory(at: wt, withIntermediateDirectories: true)
        try? "gitdir: /Users/x/proj/.git/worktrees/wt-1\n"
            .write(to: wt.appendingPathComponent(".git"), atomically: true, encoding: .utf8)
        let w2 = GitStatusCache.walkUpForGit(cwd: wt.path)
        #expect(w2?.isLinkedWorktree == true)
        #expect(w2?.repoRoot == "/Users/x/proj")
        #expect(w2?.worktreeRoot == wt.standardizedFileURL.path)

        // ②b MAJOR-1 回归：cwd 在 worktree **子目录** → worktreeRoot 仍是 worktree 根（registered
        // 比对用它而非 cwd，否则子目录被误判孤儿、徽标消失）。
        let wtSub = wt.appendingPathComponent("src", isDirectory: true)
        try? fm.createDirectory(at: wtSub, withIntermediateDirectories: true)
        let w2b = GitStatusCache.walkUpForGit(cwd: wtSub.path)
        #expect(w2b?.isLinkedWorktree == true)
        #expect(w2b?.worktreeRoot == wt.standardizedFileURL.path)

        // ③ 无 .git → nil（非 git）。用一个不存在的深路径，上溯到根均无 .git。
        let bare = root.appendingPathComponent("bare", isDirectory: true)
        try? fm.createDirectory(at: bare, withIntermediateDirectories: true)
        // 若测试机根目录恰有 /.git 会误判——极不可能，接受。
        #expect(GitStatusCache.walkUpForGit(cwd: bare.path) == nil)
    }

    @Test("parseGitdirFile：取 /.git/worktrees/ 前段为主仓；无 gitdir 行或无该段 → nil")
    func parseGitdir() {
        #expect(GitStatusCache.parseGitdirFile("gitdir: /a/b/proj/.git/worktrees/wt-2\n") == "/a/b/proj")
        #expect(GitStatusCache.parseGitdirFile("gitdir:   /p/.git/worktrees/x") == "/p") // 容错多空格
        #expect(GitStatusCache.parseGitdirFile("nonsense\nno gitdir here") == nil)
        #expect(GitStatusCache.parseGitdirFile("gitdir: /plain/.git") == nil) // 非 worktree 形
    }

    @Test("parseWorktreePaths：porcelain -z 取全部 worktree 值行")
    func parsePorcelainPaths() {
        let out = "worktree /a\u{0}HEAD abc\u{0}branch refs/heads/main\u{0}\u{0}worktree /b/wt\u{0}branch refs/heads/wt-1\u{0}\u{0}"
        #expect(GitStatusCache.parseWorktreePaths(out) == ["/a", "/b/wt"])
    }

    @Test("isRegistered：cwd 归一后在列=true；孤儿（不在列）=false")
    func registeredMatch() {
        let a = FileManager.default.temporaryDirectory.appendingPathComponent("reg-\(UUID().uuidString)").path
        #expect(GitStatusCache.isRegistered(cwd: a, worktreePaths: ["/other", a]) == true)
        #expect(GitStatusCache.isRegistered(cwd: a, worktreePaths: ["/other", "/x"]) == false) // 孤儿
    }

    @Test("statusChanged：isRepo 或 worktreeRegistered 变才 true；checkedAtMs 不参与")
    func changeGuard() {
        let base = GitStatusCache.Status(
            isRepo: true, repoRoot: "/r", isLinkedWorktree: true, worktreeRegistered: true, checkedAtMs: 0)
        #expect(GitStatusCache.statusChanged(old: nil, new: base) == true) // 首次
        var sameValNewTime = base; sameValNewTime.checkedAtMs = 999
        #expect(GitStatusCache.statusChanged(old: base, new: sameValNewTime) == false) // 仅时间变 → 不推
        var repoFlip = base; repoFlip.isRepo = false
        #expect(GitStatusCache.statusChanged(old: base, new: repoFlip) == true)
        var regFlip = base; regFlip.worktreeRegistered = false
        #expect(GitStatusCache.statusChanged(old: base, new: regFlip) == true)
    }
}
