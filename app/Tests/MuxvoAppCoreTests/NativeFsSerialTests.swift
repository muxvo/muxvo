// 批A native 侧「重进程」单测统一在此 .serialized 父套件下（plan-native §7.1）。
//
// 为何合一串行（好公民，非根因修复）：这些套件各自跑真 git 子进程 / 真 shell spawn。已确认
// MuxvoTermTests 的进程终态用例（6s `pollUntilExit`）在**并行**下本就是预存 flaky——摘掉本批全部新测、
// 纯基线（856）连跑 3 次仍随机红 2 次，故根因不在本批，属仓库既有并行敏感性（真 PTY 收尸 / kqueue
// 终态观测在负载下超 6s）。本批不改 MuxvoTerm 领地测试；但本批新增子进程会抬并行负载、抬既有 flake 概率，
// 故把重进程套件收进一个 `.serialized` 父套件 → 同刻至多一条本批重进程用例在跑，尽量少往并行门加压。
// 可靠绿口径是 `swift test --no-parallel`（全绿）。纯逻辑/FileManager 用例无子进程，仍并行。
// 命名纪律：非 spec-ID 翻牌，测试名不像 spec ID。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
import MuxvoTermRender
@testable import MuxvoAppCore
@testable import MuxvoTerm

@Suite(.serialized)
struct NativeFsSerialTests {

    // MARK: - InteractiveWorktreeService 真 git 闭环（plan-native §5.4）

    @Suite("InteractiveWorktreeService 真 git 闭环")
    struct WorktreeTests {
        private func makeService() -> InteractiveWorktreeService {
            InteractiveWorktreeService(git: GitTestFixture.git)
        }

        @Test("status 非 git 目录 → isRepo:false（数据不是错误）")
        func statusNonRepo() async {
            let d = FileManager.default.temporaryDirectory
                .appendingPathComponent("muxvo-nonrepo-\(UUID().uuidString)", isDirectory: true)
            try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
            defer { GitTestFixture.cleanup(d) }
            guard case let .worktreeStatus(isRepo, _, _, worktrees) = await makeService().status(cwd: d.path) else {
                Issue.record("应回 worktreeStatus"); return
            }
            #expect(isRepo == false)
            #expect(worktrees.isEmpty)
        }

        @Test("status 主仓 → isRepo:true，worktrees 含主 worktree（isMain:true）")
        func statusMainRepo() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            guard case let .worktreeStatus(isRepo, repoPath, _, worktrees) = await makeService().status(cwd: repo.path) else {
                Issue.record("应回 worktreeStatus"); return
            }
            #expect(isRepo == true)
            #expect(repoPath != nil)
            #expect(worktrees.count == 1)
            #expect(worktrees.first?.isMain == true)
            #expect(worktrees.first?.branch == "main")
        }

        @Test("create → .worktrees/wt-1 落盘 + 应答 branch=wt-1 + .gitignore 含 .worktrees/；随后 status 含之")
        func createProducesWorktree() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let svc = makeService()
            guard case let .worktreeCreated(wtPath, branch, _) = await svc.create(repoPath: repo.path) else {
                Issue.record("应回 worktreeCreated"); return
            }
            #expect(branch == "wt-1")
            let onDisk = repo.appendingPathComponent(".worktrees/wt-1").path
            #expect(FileManager.default.fileExists(atPath: onDisk))
            #expect((wtPath as NSString).lastPathComponent == "wt-1")

            let ignore = (try? String(contentsOf: repo.appendingPathComponent(".gitignore"), encoding: .utf8)) ?? ""
            #expect(ignore.split(separator: "\n").contains { $0.trimmingCharacters(in: .whitespaces) == ".worktrees/" })

            guard case let .worktreeStatus(_, _, _, worktrees) = await svc.status(cwd: repo.path) else {
                Issue.record("应回 worktreeStatus"); return
            }
            let wt1 = worktrees.first { $0.branch == "wt-1" }
            #expect(wt1 != nil)
            #expect(wt1?.isMain == false)
        }

        @Test("stale 标记（F-D2）：create 后外删 worktree 目录 → status 该行 missing:true，主 worktree missing:false")
        func staleMissingFlag() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let svc = makeService()
            guard case .worktreeCreated = await svc.create(repoPath: repo.path) else {
                Issue.record("应回 worktreeCreated"); return
            }
            // 外部删 worktree 工作目录（git 仍在 .git/worktrees 登记 → list 仍列出为 prunable）。
            try? FileManager.default.removeItem(at: repo.appendingPathComponent(".worktrees/wt-1"))
            guard case let .worktreeStatus(_, _, _, worktrees) = await svc.status(cwd: repo.path) else {
                Issue.record("应回 worktreeStatus"); return
            }
            #expect(worktrees.first { $0.branch == "wt-1" }?.missing == true)
            #expect(worktrees.first { $0.isMain }?.missing == false)
        }

        @Test("编号三源去重：预置孤儿目录 .worktrees/wt-5 → 下一个 create 得 wt-6（max+1）")
        func numberingThreeSourceOrphan() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let orphan = repo.appendingPathComponent(".worktrees/wt-5", isDirectory: true)
            try? FileManager.default.createDirectory(at: orphan, withIntermediateDirectories: true)
            guard case let .worktreeCreated(_, branch, _) = await makeService().create(repoPath: repo.path) else {
                Issue.record("应回 worktreeCreated"); return
            }
            #expect(branch == "wt-6")
        }

        @Test("双发编号不撞（mutateQueue 串行）：连续两 create 得 wt-1 / wt-2")
        func serialNumberingNoCollision() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let svc = makeService()
            guard case let .worktreeCreated(_, b1, _) = await svc.create(repoPath: repo.path),
                  case let .worktreeCreated(_, b2, _) = await svc.create(repoPath: repo.path) else {
                Issue.record("两 create 均应成功"); return
            }
            #expect(Set([b1, b2]) == ["wt-1", "wt-2"])
        }

        @Test(".gitignore 追加幂等：预置 node_modules，create 后含两行且 .worktrees/ 不重复")
        func gitignoreAppendIdempotent() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            try? "node_modules\n".write(
                to: repo.appendingPathComponent(".gitignore"), atomically: true, encoding: .utf8)
            let svc = makeService()
            _ = await svc.create(repoPath: repo.path)
            _ = await svc.create(repoPath: repo.path)
            let ignore = (try? String(contentsOf: repo.appendingPathComponent(".gitignore"), encoding: .utf8)) ?? ""
            let lines = ignore.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            #expect(lines.contains("node_modules"))
            #expect(lines.filter { $0 == ".worktrees/" }.count == 1)
        }

        @Test("拒绝嵌套：repoPath 含 /.worktrees/ → NESTED_WORKTREE")
        func nestedReject() async {
            guard case let .rejected(code, _) = await makeService().create(repoPath: "/some/repo/.worktrees/wt-1") else {
                Issue.record("应 rejected"); return
            }
            #expect(code == "NESTED_WORKTREE")
        }

        @Test("remove：worktree 目录消失 + 自动分支 wt-1 被删")
        func removeDeletesWorktreeAndAutoBranch() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let svc = makeService()
            guard case let .worktreeCreated(wtPath, _, _) = await svc.create(repoPath: repo.path) else {
                Issue.record("create 应成功"); return
            }
            guard case .worktreeRemoved = await svc.remove(worktreePath: wtPath) else {
                Issue.record("应回 worktreeRemoved"); return
            }
            #expect(!FileManager.default.fileExists(atPath: wtPath))
            let branches = GitTestFixture.run(["branch", "--list", "wt-1"], in: repo.path).stdout
            #expect(branches.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }

        @Test("merged 判定：新建 wt-1（在 main HEAD）isMerged:true；wt-1 有独立提交后 isMerged:false")
        func mergedDetection() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let svc = makeService()
            guard case .worktreeCreated = await svc.create(repoPath: repo.path) else {
                Issue.record("create 应成功"); return
            }
            guard case let .worktreeStatus(_, _, _, w1) = await svc.status(cwd: repo.path) else {
                Issue.record("status 应回"); return
            }
            #expect(w1.first { $0.branch == "wt-1" }?.isMerged == true)

            GitTestFixture.run(["commit", "--allow-empty", "-m", "work"], in: repo.appendingPathComponent(".worktrees/wt-1").path)
            guard case let .worktreeStatus(_, _, _, w2) = await svc.status(cwd: repo.path) else {
                Issue.record("status 应回"); return
            }
            #expect(w2.first { $0.branch == "wt-1" }?.isMerged == false)
        }

        // MARK: worktree 自定义名（worktree-popover.md §5：statusSync join + remove/create 清映射）

        /// 带 names store 的 service（store 落独立临时根）。
        private func makeServiceWithNames() -> (InteractiveWorktreeService, WorktreeNamesStore, URL) {
            let root = FileManager.default.temporaryDirectory
                .appendingPathComponent("muxvo-wtnames-\(UUID().uuidString)", isDirectory: true)
            try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let names = WorktreeNamesStore(root: root)
            return (InteractiveWorktreeService(git: GitTestFixture.git, names: names), names, root)
        }

        @Test("WT_NAME_status_joins_custom_name：有映射行 customName 携名；主行/无映射行 nil")
        func statusJoinsCustomName() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let (svc, names, nroot) = makeServiceWithNames(); defer { GitTestFixture.cleanup(nroot) }
            guard case let .worktreeCreated(wtPath, _, _) = await svc.create(repoPath: repo.path),
                  case .worktreeCreated = await svc.create(repoPath: repo.path) else {
                Issue.record("两 create 应成功"); return
            }
            names.set(wtPath, name: "liukun降权限")
            guard case let .worktreeStatus(_, _, _, worktrees) = await svc.status(cwd: repo.path) else {
                Issue.record("应回 worktreeStatus"); return
            }
            #expect(worktrees.first { $0.branch == "wt-1" }?.customName == "liukun降权限")
            #expect(worktrees.first { $0.branch == "wt-2" }?.customName == nil, "无映射行 nil")
            #expect(worktrees.first { $0.isMain }?.customName == nil, "主行恒 nil")
        }

        @Test("WT_NAME_remove_clears_mapping：removeSync 成功 → 该路径映射消失")
        func removeClearsMapping() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let (svc, names, nroot) = makeServiceWithNames(); defer { GitTestFixture.cleanup(nroot) }
            guard case let .worktreeCreated(wtPath, _, _) = await svc.create(repoPath: repo.path) else {
                Issue.record("create 应成功"); return
            }
            names.set(wtPath, name: "要没了")
            guard case .worktreeRemoved = await svc.remove(worktreePath: wtPath) else {
                Issue.record("应回 worktreeRemoved"); return
            }
            #expect(names.get(wtPath) == nil, "名字随 worktree 实体消亡")
        }

        @Test("WT_NAME_create_clears_stale：预置同路径陈名 → createSync 成功清陈名（编号复用防线）")
        func createClearsStaleName() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let (svc, names, nroot) = makeServiceWithNames(); defer { GitTestFixture.cleanup(nroot) }
            // 预置「上一代 wt-1」的陈名（模拟删除后编号复用同路径）。
            let expectedPath = repo.appendingPathComponent(".worktrees/wt-1").path
            names.set(expectedPath, name: "上一代的名字")
            guard case let .worktreeCreated(wtPath, branch, _) = await svc.create(repoPath: repo.path) else {
                Issue.record("create 应成功"); return
            }
            #expect(branch == "wt-1")
            #expect(names.get(wtPath) == nil, "新建即清同路径陈名")
        }

        @Test("纯解析：porcelain 分记录、branch 去前缀、detached；branch-list 去标记；wtNumber / isAutoBranch")
        func pureParsers() {
            let porcelain = "worktree /a\u{0}HEAD abc\u{0}branch refs/heads/main\u{0}\u{0}worktree /a/.worktrees/wt-2\u{0}branch refs/heads/wt-2\u{0}\u{0}"
            let parsed = InteractiveWorktreeService.parseWorktreePorcelain(porcelain, repoPath: "/a")
            #expect(parsed.count == 2)
            #expect(parsed[0].branch == "main" && parsed[0].isMain == true)
            #expect(parsed[1].branch == "wt-2" && parsed[1].isMain == false)

            let merged = InteractiveWorktreeService.parseBranchList("* main\n  wt-1\n+ wt-2\n  (HEAD detached at abc)\n")
            #expect(merged == ["main", "wt-1", "wt-2"])

            #expect(InteractiveWorktreeService.wtNumber("wt-7") == 7)
            #expect(InteractiveWorktreeService.wtNumber("worktree-3") == nil)
            #expect(InteractiveWorktreeService.wtNumber("wt-x") == nil)
            #expect(InteractiveWorktreeService.isAutoBranch("wt-1") == true)
            #expect(InteractiveWorktreeService.isAutoBranch("worktree-9") == true)
            #expect(InteractiveWorktreeService.isAutoBranch("feature/x") == false)
            #expect(InteractiveWorktreeService.mainRepoPath(fromCommonDir: "/a/.git") == "/a")
        }
    }

    // MARK: - GitStatusCache 缓存行为（真 git 探针，plan-native §4）

    @Suite("GitStatusCache 缓存行为：TTL / onChange 守卫 / invalidate")
    @MainActor
    struct GitStatusCacheBehaviorTests {
        private final class Clock { var t: Int64 = 0 }

        @Test("假时钟 TTL（SWR，dogfood-r3 问题6）：未过期命中真值；过期回**旧值**并登记探针；真 miss 回 (nil,nil)")
        func ttlBoundary() {
            let clock = Clock()
            let cache = GitStatusCache(git: GitTestFixture.git, ttlMs: 30_000, nowMs: { clock.t })
            cache.primeForTesting(cwd: "/proj", isRepo: true, worktreeRegistered: false, at: 0)
            clock.t = 29_999
            let hit = cache.lookup(cwd: "/proj")
            #expect(hit.isGitRepo == true && hit.worktreeRegistered == false)
            #expect(!cache.inFlightForTesting.contains("/proj"), "未过期不登记探针")
            clock.t = 30_001
            let stale = cache.lookup(cwd: "/proj")
            #expect(stale.isGitRepo == true && stale.worktreeRegistered == false,
                    "过期回旧值（stale-while-revalidate），不得回 nil 闪灭按钮/徽标")
            #expect(cache.inFlightForTesting.contains("/proj"), "过期须登记后台探针刷新")
            // 真 miss（无条目）仍回 (nil,nil)——冷启动探针点亮口径不变
            let miss = cache.lookup(cwd: "/never-seen")
            #expect(miss.isGitRepo == nil && miss.worktreeRegistered == nil)
        }

        @Test("SWR revalidate 闭环：过期回旧值后探针回填值真变 → onChange 触发 + lookup 转新值")
        func staleRevalidateFlipFires() {
            let clock = Clock()
            let cache = GitStatusCache(git: GitTestFixture.git, ttlMs: 30_000, nowMs: { clock.t })
            cache.primeForTesting(cwd: "/wt", isRepo: true, worktreeRegistered: true, at: 0)
            var fired = 0
            cache.onChange = { fired += 1 }
            clock.t = 30_001
            #expect(cache.lookup(cwd: "/wt").worktreeRegistered == true, "过期窗内平滑显示旧值")
            cache.applyProbeForTesting(cwd: "/wt", result: GitStatusCache.ProbeResult(
                isRepo: true, repoRoot: "/main", isLinkedWorktree: true, registered: .determined(false)))
            #expect(fired == 1, "值真变（已注册→孤儿）须 onChange 重推纠正")
            #expect(cache.lookup(cwd: "/wt").worktreeRegistered == false)
        }

        @Test("onChange 守卫：值变才推——同一稳定主仓连探两次，仅首次触发 onChange")
        func onChangeFiresOnlyOnValueChange() {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            var fired = 0
            let cache = GitStatusCache(git: GitTestFixture.git)
            cache.onChange = { fired += 1 }
            cache.probeNowForTesting(cwd: repo.path)
            #expect(fired == 1)
            cache.probeNowForTesting(cwd: repo.path)
            #expect(fired == 1)
        }

        @Test("probeFailed 保留既有 registered 值（网络卷抖动不闪按钮），且不触发 onChange")
        func probeFailedPreservesValue() {
            let cache = GitStatusCache(git: GitTestFixture.git)
            cache.primeForTesting(cwd: "/wt", isRepo: true, worktreeRegistered: true)
            var fired = 0
            cache.onChange = { fired += 1 }
            cache.applyProbeForTesting(cwd: "/wt", result: GitStatusCache.ProbeResult(
                isRepo: true, repoRoot: "/main", isLinkedWorktree: true, registered: .probeFailed))
            #expect(cache.lookup(cwd: "/wt").worktreeRegistered == true)
            #expect(fired == 0)
        }

        @Test("MAJOR-1 回归：cwd 在已注册 worktree 的子目录 → registered=true（比对用 worktree 根非 cwd）")
        func registeredFromSubdirectory() {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            let wtPath = repo.appendingPathComponent(".worktrees/wt-1").path
            GitTestFixture.run(["worktree", "add", "-b", "wt-1", wtPath], in: repo.path)
            let sub = URL(fileURLWithPath: wtPath).appendingPathComponent("src", isDirectory: true)
            try? FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
            let result = GitStatusCache.probe(cwd: sub.path, git: GitTestFixture.git)
            #expect(result.isLinkedWorktree == true)
            #expect(result.registered == .determined(true)) // 修复前：精确比对 cwd 失配 → false（误判孤儿）
        }

        @Test("determined 值翻转触发 onChange：孤儿(false)→已注册(true)")
        func determinedFlipFires() {
            let cache = GitStatusCache(git: GitTestFixture.git)
            cache.primeForTesting(cwd: "/wt", isRepo: true, worktreeRegistered: false)
            var fired = 0
            cache.onChange = { fired += 1 }
            cache.applyProbeForTesting(cwd: "/wt", result: GitStatusCache.ProbeResult(
                isRepo: true, repoRoot: "/main", isLinkedWorktree: true, registered: .determined(true)))
            #expect(cache.lookup(cwd: "/wt").worktreeRegistered == true)
            #expect(fired == 1)
        }

        @Test("invalidate(prefix)：清 repo 前缀下全部缓存项（自身 + 子路径），无关项保留")
        func invalidatePrefix() {
            let clock = Clock()
            let cache = GitStatusCache(git: GitTestFixture.git, ttlMs: 30_000, nowMs: { clock.t })
            cache.primeForTesting(cwd: "/repo", isRepo: true, worktreeRegistered: nil, at: 0)
            cache.primeForTesting(cwd: "/repo/.worktrees/wt-1", isRepo: true, worktreeRegistered: true, at: 0)
            cache.primeForTesting(cwd: "/elsewhere", isRepo: true, worktreeRegistered: nil, at: 0)
            cache.invalidate(prefix: "/repo")
            #expect(cache.lookup(cwd: "/repo").isGitRepo == nil)
            #expect(cache.lookup(cwd: "/repo/.worktrees/wt-1").isGitRepo == nil)
            #expect(cache.lookup(cwd: "/elsewhere").isGitRepo == true)
        }
    }

    // MARK: - FsRequestRouter 分发（plan-native §5.2）

    @Suite("FsRequestRouter 分发")
    @MainActor
    struct FsRequestRouterTests {
        private func makeRouter(anchor: @escaping (Double, Double, Bool) -> FileMenuAction) -> FsRequestRouter {
            FsRequestRouter(
                fsService: FsService(),
                worktreeService: InteractiveWorktreeService(git: GitTestFixture.git),
                showFileMenu: anchor)
        }

        @Test("showFileMenu：假 anchor 返回的动作原样回 menuAction；不触发 worktree 变更回调")
        func showFileMenuDispatches() async {
            var mutated: [String] = []
            let router = makeRouter(anchor: { _, _, _ in .copyPath })
            router.onWorktreeMutation = { mutated.append($0) }
            guard case let .menuAction(action) = await router.handle(
                .showFileMenu(path: "/x/readme.md", isDirectory: false, x: 10, y: 20)) else {
                Issue.record("应回 menuAction"); return
            }
            #expect(action == .copyPath)
            #expect(mutated.isEmpty)
        }

        @Test("showFileMenu 用户关菜单未选 → dismissed 回传")
        func showFileMenuDismissed() async {
            let router = makeRouter(anchor: { _, _, _ in .dismissed })
            guard case let .menuAction(action) = await router.handle(
                .showFileMenu(path: "/x", isDirectory: true, x: 0, y: 0)) else {
                Issue.record("应回 menuAction"); return
            }
            #expect(action == .dismissed)
        }

        @Test("readDir 透传到 FsService")
        func readDirPassthrough() async {
            let d = FileManager.default.temporaryDirectory
                .appendingPathComponent("muxvo-router-\(UUID().uuidString)", isDirectory: true)
            try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
            defer { GitTestFixture.cleanup(d) }
            FileManager.default.createFile(atPath: d.appendingPathComponent("a").path, contents: Data())
            guard case let .dir(entries, _) = await makeRouter(anchor: { _, _, _ in .dismissed })
                .handle(.readDir(path: d.path)) else {
                Issue.record("应回 dir"); return
            }
            #expect(entries.contains { $0.name == "a" })
        }

        @Test("worktreeCreate 成功 → onWorktreeMutation(repoPath)；worktreeRemove 成功 → onWorktreeMutation(worktreePath)")
        func worktreeMutationCallbacks() async {
            let repo = GitTestFixture.makeRepo(); defer { GitTestFixture.cleanup(repo) }
            var mutated: [String] = []
            let router = makeRouter(anchor: { _, _, _ in .dismissed })
            router.onWorktreeMutation = { mutated.append($0) }
            guard case let .worktreeCreated(wtPath, _, _) = await router.handle(.worktreeCreate(repoPath: repo.path)) else {
                Issue.record("create 应成功"); return
            }
            #expect(mutated == [repo.path])
            guard case .worktreeRemoved = await router.handle(.worktreeRemove(worktreePath: wtPath)) else {
                Issue.record("remove 应成功"); return
            }
            #expect(mutated == [repo.path, wtPath])
        }
    }

    // MARK: - TerminalService 文件面板 / git 门控 / insertText（file-panel.md §0.5, plan-native §3/§4）

    @Suite("TerminalService 文件面板 / git 门控 / insertText")
    @MainActor
    struct FilePanelServiceTests {
        private final class Clock { var t: Int64 = 0 }

        private struct Kit {
            let service: TerminalService
            let store: ConfigStore
            let repo: URL
            let root: URL
            let cache: GitStatusCache
            let clock: Clock
        }

        private func makeKit() -> Kit {
            let root = FileManager.default.temporaryDirectory
                .appendingPathComponent("muxvo-fp-\(UUID().uuidString)", isDirectory: true)
            try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let repo = GitTestFixture.makeRepo()
            let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
            let clock = Clock()
            let cache = GitStatusCache(git: GitTestFixture.git, ttlMs: 30_000, nowMs: { clock.t })
            let service = TerminalService(
                configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
                homePath: repo.path, dataRoot: root, gitStatusCache: cache)
            return Kit(service: service, store: store, repo: repo, root: root, cache: cache, clock: clock)
        }

        private func teardown(_ k: Kit) {
            k.service.registry.shutdownForTeardown()
            GitTestFixture.cleanup(k.repo)
            GitTestFixture.cleanup(k.root)
        }

        @Test("setShowHiddenFiles：config 落盘 + 快照带 showHiddenFiles=true（web 回流为准，无需真终端）")
        func setShowHiddenFilesPersistsAndPushes() {
            let k = makeKit(); defer { teardown(k) }
            var captured: UIState?
            k.service.onState = { captured = $0 }
            k.service.handleAction(.setShowHiddenFiles(value: true))
            #expect(captured?.showHiddenFiles == true)
            let reloaded = ConfigStore(configFileURL: k.root.appendingPathComponent(ConfigStore.configFileName)).load()
            #expect(reloaded.showHiddenFiles == true)
        }

        @Test("fileOpen 对不存在终端 no-op（防悬空，无需真终端）")
        func fileOpenUnknownNoOp() {
            let k = makeKit(); defer { teardown(k) }
            var captured: UIState?
            k.service.onState = { captured = $0 }
            k.service.handleAction(.fileOpen(terminalId: "ghost"))
            #expect(captured?.filePanel == nil)
        }

        /// 单终端 spawn 复用，串起 fileOpen/close + ⌘E toggle + insertText + mapSnapshot 门控填充四组断言
        /// （合并为一发真 spawn，压低并行进程压力）。
        @Test("文件面板生命周期 + insertText + git 门控填充（单 spawn 复用）")
        func filePanelLifecycleAndGating() {
            let k = makeKit(); defer { teardown(k) }
            guard let id = k.service.createStartupTerminals(count: 1).first else {
                Issue.record("应建起始终端"); return
            }
            k.cache.primeForTesting(cwd: k.repo.path, isRepo: true, worktreeRegistered: nil)
            var captured: UIState?
            k.service.onState = { captured = $0 }

            // ① fileOpen → filePanel 置该终端；同一快照 mapSnapshot 填 git 门控（homePath 为主仓）。
            k.service.handleAction(.fileOpen(terminalId: id))
            #expect(captured?.filePanel?.terminalId == id)
            #expect(captured?.terminals.first?.isGitRepo == true)
            #expect(captured?.terminals.first?.worktreeRegistered == nil)

            // ② fileClose → filePanel 清。
            k.service.handleAction(.fileClose)
            #expect(captured?.filePanel == nil)

            // ③ ⌘E toggle：有选中终端 → 开（落该终端）；再切 → 关。
            k.service.toggleFilePanel()
            #expect(k.service.isFilePanelOpen == true)
            #expect(captured?.filePanel?.terminalId == id)
            k.service.toggleFilePanel()
            #expect(k.service.isFilePanelOpen == false)
            #expect(captured?.filePanel == nil)

            // ④ insertText：终端存在 → inserted；不存在 → rejected(notFound)。
            #expect(k.service.handleTermCommand(
                .insertText(terminalId: id, text: "'/path with space' ")) == .inserted(terminalId: id))
            guard case let .rejected(code, _) = k.service.handleTermCommand(
                .insertText(terminalId: "ghost", text: "x")) else {
                Issue.record("应 rejected"); return
            }
            #expect(code == .notFound)

            // ⑤ SWR（dogfood-r3 问题6，修前必红）：TTL 过期后任一推送仍带旧值，不闪灭 worktree 按钮。
            k.clock.t = 30_001
            k.service.handleAction(.fileOpen(terminalId: id))
            #expect(captured?.terminals.first?.isGitRepo == true,
                    "TTL 过期推送须平滑带旧值（修前 nil → 按钮消失）")
        }
    }
}
