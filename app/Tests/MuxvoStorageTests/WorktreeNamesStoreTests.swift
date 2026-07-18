// worktree 自定义名持久化面（worktree-popover.md §5，WorktreeNamesStore）。
//
// 覆盖：WT_NAME_store_roundtrip_persist（读写往返/重读/损坏兜底）、WT_NAME_root_derivation
// （cwd → worktree 根推导：子目录命中、主仓/普通目录/.worktrees 本身 → nil）、key 归一。
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

@Suite("WorktreeNamesStore（worktree 自定义名持久化）")
struct WorktreeNamesStoreTests {
    private let wt = "/repo/.worktrees/wt-19"

    @Test("WT_NAME_store_roundtrip_persist：set 落盘、新实例重读同值、损坏 JSON 空表兜底")
    func roundtripAndCorruptFallback() throws {
        try withTempRoot { root in
            let s1 = WorktreeNamesStore(root: root)
            s1.set(wt, name: "liukun降权限")
            #expect(s1.get(wt) == "liukun降权限")
            // 新实例从盘重读 → 一致（持久绑定：关终端/重启 app 仍在）。
            let s2 = WorktreeNamesStore(root: root)
            #expect(s2.get(wt) == "liukun降权限")
            // 损坏 JSON → 空表兜底不 crash。
            let url = DataDirectory.worktreeNamesURL(under: root)
            try Data("not-json{{".utf8).write(to: url)
            let s3 = WorktreeNamesStore(root: root)
            #expect(s3.all().isEmpty, "损坏 = 空表兜底")
        }
    }

    @Test("空串/nil 清除 + 等值 no-op 不落盘 + remove 幂等")
    func clearAndIdempotence() throws {
        try withTempRoot { root in
            let store = WorktreeNamesStore(root: root)
            store.set(wt, name: "名A")
            let after = store.diskWrites
            store.set(wt, name: "名A") // 等值 → 跳过
            #expect(store.diskWrites == after, "同值重 set 不重复落盘")
            store.set(wt, name: "") // 空串 = 清除
            #expect(store.get(wt) == nil)
            store.set(wt, name: "名B")
            store.set(wt, name: nil)
            #expect(store.get(wt) == nil)
            let before = store.diskWrites
            store.remove(wt) // 已空 → no-op 不落盘
            #expect(store.diskWrites == before)
            #expect(WorktreeNamesStore(root: root).all().isEmpty)
        }
    }

    @Test("key 归一：/var 与 /private/var 写读同 key")
    func canonicalKeyUnifiesVarPrefix() throws {
        try withTempRoot { root in
            // 真实存在的路径才可解符号链接：用系统临时目录（/var/folders/… ↔ /private/var/folders/…）。
            let real = FileManager.default.temporaryDirectory.path // 常为 /var/folders/…
            let alt = real.hasPrefix("/private/") ? String(real.dropFirst("/private".count)) : "/private" + real
            let store = WorktreeNamesStore(root: root)
            store.set(real, name: "同一实体")
            #expect(store.get(alt) == "同一实体", "两种前缀归一到同 key")
        }
    }

    @Test("WT_NAME_backfill_seeds_missing：启动回填只补缺——已有 key 不覆盖、非 worktree/空名跳过、新实例重读可见")
    func backfillSeedsMissing() throws {
        try withTempRoot { root in
            let store = WorktreeNamesStore(root: root)
            store.set("/repo/.worktrees/wt-2", name: "已有的名字")
            store.backfill(from: [
                (cwd: "/repo/.worktrees/wt-19/src", name: "liukun降权限"),  // 子目录 cwd → 归根补入
                (cwd: "/repo/.worktrees/wt-2", name: "回填不该赢"),         // 已有 key → 不覆盖
                (cwd: "/repo", name: "主仓名"),                             // 非 worktree → 跳过
                (cwd: "/repo/.worktrees/wt-3", name: ""),                   // 空名 → 跳过
                (cwd: "/repo/.worktrees/wt-19", name: "后到的候选"),         // 同 key 后到 → 不覆盖（先到先得）
            ])
            #expect(store.get("/repo/.worktrees/wt-19") == "liukun降权限")
            #expect(store.get("/repo/.worktrees/wt-2") == "已有的名字")
            #expect(store.get("/repo/.worktrees/wt-3") == nil)
            #expect(store.all().count == 2, "主仓/空名不入表")
            // 落盘：新实例重读可见。
            #expect(WorktreeNamesStore(root: root).get("/repo/.worktrees/wt-19") == "liukun降权限")
        }
    }

    @Test("WT_NAME_root_derivation：worktree 子目录命中根；主仓/普通目录/.worktrees 本身 → nil")
    func worktreeRootDerivation() {
        // 子目录 → 截至 .worktrees 后一个组件。
        #expect(WorktreeNamesStore.worktreeRoot(forCwd: "/repo/.worktrees/wt-19/src") == "/repo/.worktrees/wt-19")
        // worktree 根本身 → 自身。
        #expect(WorktreeNamesStore.worktreeRoot(forCwd: "/repo/.worktrees/wt-19") == "/repo/.worktrees/wt-19")
        // 主仓/普通目录 → nil。
        #expect(WorktreeNamesStore.worktreeRoot(forCwd: "/repo") == nil)
        #expect(WorktreeNamesStore.worktreeRoot(forCwd: "/Users/x/proj/src") == nil)
        // `.worktrees` 目录本身（标记后无组件）→ nil。
        #expect(WorktreeNamesStore.worktreeRoot(forCwd: "/repo/.worktrees/") == nil)
        // 无尾斜杠的 .worktrees 目录（无 `/.worktrees/` 标记）→ nil。
        #expect(WorktreeNamesStore.worktreeRoot(forCwd: "/repo/.worktrees") == nil)
    }
}
