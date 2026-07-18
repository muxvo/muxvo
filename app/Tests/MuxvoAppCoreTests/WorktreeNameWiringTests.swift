// worktree 自定义名接线（worktree-popover.md §5）：.renameSubmit 正向链——终端 cwd 在 worktree 内
// → 名字持久绑定 worktree 根（WorktreeNamesStore）；主仓 cwd 不写；空串清除；同 worktree 最后改名赢。
// 范式仿 ChatCustomTitleWiringTests（handleAction 直调，titles 链平行零共享）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
import MuxvoTerm
@testable import MuxvoAppCore

@Suite("worktree 自定义名接线（renameSubmit → WorktreeNamesStore）", .serialized)
@MainActor
struct WorktreeNameWiringTests {
    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-wtname-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// 装配注入了 worktreeNamesStore 的 service（返回 store 供断言）。
    private func makeService(root: URL) -> (TerminalService, WorktreeNamesStore) {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let names = WorktreeNamesStore(root: root)
        let service = TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: root.path, dataRoot: root, worktreeNamesStore: names)
        return (service, names)
    }

    /// 建 `<root>/.worktrees/<branch>` 目录（真目录，spawn cwd 需存在）。
    private func makeWorktreeDir(root: URL, branch: String) -> String {
        let dir = root.appendingPathComponent(".worktrees", isDirectory: true)
            .appendingPathComponent(branch, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.path
    }

    @Test("WT_NAME_rename_binds_worktree：终端 cwd 在 worktree 内 → store 命中 worktree 根（trim 后）")
    func renameBindsWorktree() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, names) = makeService(root: root)
        let wtPath = makeWorktreeDir(root: root, branch: "wt-19")
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: wtPath)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.handleAction(.renameSubmit(terminalId: termId, name: "  liukun降权限  "))
        #expect(names.get(wtPath) == "liukun降权限", "trim 后写入 worktree 根")
    }

    @Test("WT_NAME_rename_clear_removes：空串改名 → 该 worktree 映射被清除")
    func renameEmptyClears() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, names) = makeService(root: root)
        let wtPath = makeWorktreeDir(root: root, branch: "wt-3")
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: wtPath)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.handleAction(.renameSubmit(terminalId: termId, name: "旧名"))
        #expect(names.get(wtPath) == "旧名")
        service.handleAction(.renameSubmit(terminalId: termId, name: "   "))
        #expect(names.get(wtPath) == nil, "空名清除映射")
    }

    @Test("WT_NAME_rename_main_repo_ignored：终端 cwd 在主仓（无 .worktrees 标记）→ store 零写入")
    func renameMainRepoIgnored() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, names) = makeService(root: root)
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.handleAction(.renameSubmit(terminalId: termId, name: "主仓名"))
        #expect(names.all().isEmpty, "主仓 cwd 不写映射（主行恒显 branch）")
    }

    @Test("WT_NAME_last_rename_wins：同 worktree 两终端先后改名 → store 值 = 后者")
    func lastRenameWins() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, names) = makeService(root: root)
        let wtPath = makeWorktreeDir(root: root, branch: "wt-7")
        // 第二终端 cwd 用 worktree 子目录（前缀命中同根）。
        let sub = URL(fileURLWithPath: wtPath, isDirectory: true).appendingPathComponent("src", isDirectory: true)
        try? FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
        guard case let .created(t1, _) = service.handleTermCommand(.create(cwd: wtPath)),
              case let .created(t2, _) = service.handleTermCommand(.create(cwd: sub.path)) else {
            Issue.record("前置：两终端应创建成功"); return
        }
        defer {
            _ = service.handleTermCommand(.close(terminalId: t1))
            _ = service.handleTermCommand(.close(terminalId: t2))
        }
        service.handleAction(.renameSubmit(terminalId: t1, name: "先名"))
        service.handleAction(.renameSubmit(terminalId: t2, name: "后名"))
        #expect(names.get(wtPath) == "后名", "同 key 覆写 = 最后改名赢（子目录 cwd 亦归同根）")
    }

    @Test("worktreeNamesStore=nil：rename 全链 no-op（不崩、service 存活）")
    func nilStoreNoOp() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let service = TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: root.path, dataRoot: root)
        let wtPath = makeWorktreeDir(root: root, branch: "wt-1")
        guard case let .created(termId, _) = service.handleTermCommand(.create(cwd: wtPath)) else {
            Issue.record("前置：终端应创建成功"); return
        }
        defer { _ = service.handleTermCommand(.close(terminalId: termId)) }
        service.handleAction(.renameSubmit(terminalId: termId, name: "x")) // 不崩
        #expect(service.panelMode == .terminal, "service 存活")
    }
}
