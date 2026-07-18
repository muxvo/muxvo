// 生产自动归组（chat-data.md §10，ChatAutoGroupingPolicy + ChatStore 注入面）。
//
// 覆盖 §7 池：CD_autogroup_*（默认关零变/relpadhq 折叠/三类 tmp 模式/目标解析与 old_RelPad 隔离/
// 合成桶/sessions 回查+标签/messages 回查/allRecent 归一）+ CD_codex_worktree_*（fix A 两面）+
// CD_livepage_autogroup_dirset_codex_children（生产 livePage 面）。
// fixture 工法复用 ChatIndexerTests（writeSessionFile/ccUser*）与 ChatStoreTests（codex 三件套）。
import Foundation
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("生产自动归组（§10：RelPad 临时目录塌缩 + Codex worktree 归并）")
struct ChatAutoGroupingTests {

    // 规则目录（真实池实测形态的缩样）：
    static let triageDir = "-Users-t--relpadhq-assistant-triage-6229"
    static let tmpTDir = "-private-var-folders-7c-x-T-relpad-waveauto-abc"
    static let tmpDir = "-tmp-relpad-verdict-xy"
    static let privateTmpDir = "-private-tmp-relpad-fbdraft-zz"
    /// RelPad 目标项目目录（cwd 末段 RelPad → displayName "RelPad"）。
    static let relpadDir = "-Users-t-code-RelPad"

    private func openStore(_ root: URL, policy: ChatAutoGroupingPolicy?, codex: Bool = false)
        throws -> (store: ChatStore, cc: URL, codex: URL?)
    {
        let cc = root.appendingPathComponent("projects", isDirectory: true)
        try FileManager.default.createDirectory(at: cc, withIntermediateDirectories: true)
        let codexURL = codex ? root.appendingPathComponent("dotcodex", isDirectory: true) : nil
        let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
        return (ChatStore(ccBase: cc, codexBase: codexURL, database: db, autoGrouping: policy), cc, codexURL)
    }

    /// 标准 fixture：RelPad 本体 2 会话 + 四类规则目录各 1 会话 + old_RelPad 1 会话。
    private func seedRelPadFixture(cc: URL) throws {
        try writeSessionFile(base: cc, project: Self.relpadDir, session: "rp1",
            lines: [ccUserCwd("relpad 主会话一", cwd: "/Users/t/code/RelPad", session: "rp1")])
        try writeSessionFile(base: cc, project: Self.relpadDir, session: "rp2",
            lines: [ccUserCwd("relpad 主会话二", cwd: "/Users/t/code/RelPad", session: "rp2")])
        try writeSessionFile(base: cc, project: Self.triageDir, session: "tg1",
            lines: [ccUserCwd("triage 自动会话", cwd: "/Users/t/.relpadhq-assistant/triage-6229", session: "tg1")])
        try writeSessionFile(base: cc, project: Self.tmpTDir, session: "wa1",
            lines: [ccUserCwd("waveauto 自动会话", cwd: "/private/var/folders/7c/x/T/relpad-waveauto-abc", session: "wa1")])
        try writeSessionFile(base: cc, project: Self.tmpDir, session: "vd1",
            lines: [ccUserCwd("verdict 自动会话", cwd: "/tmp/relpad-verdict-xy", session: "vd1")])
        try writeSessionFile(base: cc, project: Self.privateTmpDir, session: "fb1",
            lines: [ccUserCwd("fbdraft 自动会话", cwd: "/private/tmp/relpad-fbdraft-zz", session: "fb1")])
        try writeSessionFile(base: cc, project: "-Users-t-code-old-RelPad", session: "old1",
            lines: [ccUserCwd("老版会话", cwd: "/Users/t/code/old_RelPad", session: "old1")])
    }

    @Test("CD_autogroup_disabled_by_default_zero_change：policy nil → 规则目录各自独立条目、sessions/allRecent 原语义")
    func disabledByDefaultZeroChange() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: nil)
            try seedRelPadFixture(cc: s.cc)
            let projects = try s.store.projects()
            // 全部 6 个目录各自成条（RelPad/triage/tmp×3/old_RelPad），无折叠、无合成桶。
            #expect(projects.count == 6)
            #expect(projects.contains { $0.projectHash == Self.triageDir })
            #expect(projects.contains { $0.projectHash == Self.tmpTDir })
            #expect(!projects.contains { $0.projectHash == "muxvo-autogroup-relpad" })
            #expect(projects.first { $0.projectHash == Self.relpadDir }?.sessionCount == 2)
            // sessions(RelPad) 不含规则目录会话；allRecent 中 triage 会话 hash 保持原目录名。
            let sessions = try s.store.sessions(projectHash: Self.relpadDir, limit: 50)
            #expect(Set(sessions.map(\.sessionId)) == ["rp1", "rp2"])
            let recent = try s.store.allRecentSessions(limit: 50)
            #expect(recent.first { $0.sessionId == "tg1" }?.projectHash == Self.triageDir)
            #expect(recent.first { $0.sessionId == "tg1" }?.worktreeLabel == nil)
        }
    }

    @Test("CD_autogroup_relpadhq_merged_into_target：relpadhq 系折叠进 RelPad（count/size 累加、无独立条目）")
    func relpadhqMergedIntoTarget() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad)
            try seedRelPadFixture(cc: s.cc)
            let projects = try s.store.projects()
            let target = projects.first { $0.projectHash == Self.relpadDir }
            #expect(target != nil)
            #expect(target?.sessionCount == 6, "2 本体 + 4 规则目录")
            #expect(!projects.contains { $0.projectHash == Self.triageDir }, "无独立条目")
            // totalSize 累加：目标 totalSize > 仅本体两文件之和（规则目录文件并入）。
            let ownSize = ["rp1", "rp2"].compactMap { sid -> Int? in
                let p = s.cc.appendingPathComponent(Self.relpadDir).appendingPathComponent("\(sid).jsonl").path
                return (try? FileManager.default.attributesOfItem(atPath: p))?[.size] as? Int
            }.reduce(0, +)
            #expect((target?.totalSize ?? 0) > ownSize)
        }
    }

    @Test("CD_autogroup_tmp_relpad_patterns：-T-relpad-/-tmp-relpad-/-private-tmp-relpad- 三类模式均命中")
    func tmpRelpadPatterns() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad)
            try seedRelPadFixture(cc: s.cc)
            let projects = try s.store.projects()
            for dir in [Self.tmpTDir, Self.tmpDir, Self.privateTmpDir] {
                #expect(!projects.contains { $0.projectHash == dir }, "\(dir) 应被折叠")
            }
        }
    }

    @Test("CD_autogroup_target_dynamic_case_insensitive_old_relpad_excluded：目标小写匹配；old_RelPad 不吸不作目标")
    func targetCaseInsensitiveOldRelpadExcluded() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad)
            try seedRelPadFixture(cc: s.cc)
            let projects = try s.store.projects()
            // old_RelPad 独立健在、条目不变（displayName "old_RelPad" ≠ "relpad"）。
            let old = projects.first { $0.projectHash == "-Users-t-code-old-RelPad" }
            #expect(old?.sessionCount == 1)
            // 目标 = displayName "RelPad"（大小写不敏感命中）的真条目，非合成桶。
            #expect(projects.first { $0.projectHash == Self.relpadDir }?.sessionCount == 6)
            #expect(!projects.contains { $0.projectHash == "muxvo-autogroup-relpad" })
        }
    }

    @Test("CD_autogroup_no_target_synthetic_bucket：无 RelPad 条目 → 合成桶承接归组")
    func noTargetSyntheticBucket() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad)
            try writeSessionFile(base: s.cc, project: Self.triageDir, session: "tg1",
                lines: [ccUserCwd("triage", cwd: "/Users/t/.relpadhq-assistant/triage-6229", session: "tg1")])
            let projects = try s.store.projects()
            let bucket = projects.first { $0.projectHash == "muxvo-autogroup-relpad" }
            #expect(bucket?.displayName == "RelPad")
            #expect(bucket?.sessionCount == 1)
            #expect(!projects.contains { $0.projectHash == Self.triageDir })
        }
    }

    @Test("CD_autogroup_sessions_dirset_and_label：sessions(目标) 查得规则目录会话且带来源标签")
    func sessionsDirsetAndLabel() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad)
            try seedRelPadFixture(cc: s.cc)
            let sessions = try s.store.sessions(projectHash: Self.relpadDir, limit: 50)
            #expect(Set(sessions.map(\.sessionId)) == ["rp1", "rp2", "tg1", "wa1", "vd1", "fb1"])
            let tg = sessions.first { $0.sessionId == "tg1" }
            #expect(tg?.projectHash == Self.relpadDir)
            #expect(tg?.worktreeLabel == "assistant-triage-6229", "规则 token 后整段")
            #expect(sessions.first { $0.sessionId == "wa1" }?.worktreeLabel == "waveauto-abc")
            #expect(sessions.first { $0.sessionId == "rp1" }?.worktreeLabel == nil, "本体会话无标签")
        }
    }

    @Test("CD_autogroup_messages_lookup_in_rule_dir：messages(目标, sid) 在规则目录回查到会话文件")
    func messagesLookupInRuleDir() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad)
            try seedRelPadFixture(cc: s.cc)
            let msgs = try s.store.messages(projectHash: Self.relpadDir, sessionId: "tg1", limit: nil)
            #expect(msgs.contains { msgText($0) == "triage 自动会话" })
        }
    }

    @Test("CD_autogroup_allrecent_outputhash_normalized：allRecent 中规则目录会话 projectHash 归一为目标")
    func allRecentOutputHashNormalized() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad)
            try seedRelPadFixture(cc: s.cc)
            let recent = try s.store.allRecentSessions(limit: 50)
            let tg = recent.first { $0.sessionId == "tg1" }
            #expect(tg?.projectHash == Self.relpadDir)
            #expect(tg?.worktreeLabel == "assistant-triage-6229")
            #expect(recent.first { $0.sessionId == "old1" }?.projectHash == "-Users-t-code-old-RelPad")
        }
    }

    @Test("CD_autogroup_penraft_rules：penraft 渲染 job 目录折叠进 Penraft 目标（多组与 relpad 并行互不串）")
    func penraftRulesMultiGroup() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .standard)
            try seedRelPadFixture(cc: s.cc)
            try writeSessionFile(base: s.cc, project: "-Users-t-code-Penraft", session: "pr1",
                lines: [ccUserCwd("penraft 主会话", cwd: "/Users/t/code/Penraft", session: "pr1")])
            let jobDir = "-private-var-folders-7c-x-T-penraft-render-job-20260514-111028-858"
            try writeSessionFile(base: s.cc, project: jobDir, session: "job1",
                lines: [ccUserCwd("渲染 job 会话", cwd: "/private/var/folders/7c/x/T/penraft-render/job-20260514-111028-858", session: "job1")])
            let projects = try s.store.projects()
            // penraft job 折叠进 Penraft（非 RelPad），relpad 系折叠进 RelPad（非 Penraft）——多组互不串。
            #expect(!projects.contains { $0.projectHash == jobDir })
            #expect(projects.first { $0.projectHash == "-Users-t-code-Penraft" }?.sessionCount == 2)
            #expect(projects.first { $0.projectHash == Self.relpadDir }?.sessionCount == 6)
            // sessions(Penraft) 查得 job 会话且带来源标签（token 后整段）。
            let sessions = try s.store.sessions(projectHash: "-Users-t-code-Penraft", limit: 50)
            #expect(Set(sessions.map(\.sessionId)) == ["pr1", "job1"])
            #expect(sessions.first { $0.sessionId == "job1" }?.worktreeLabel == "render-job-20260514-111028-858")
        }
    }

    // MARK: - fix A（Codex worktree 归并）

    /// Codex fixture：父 cwd + worktree 子 cwd 各一会话。
    private func seedCodexWorktree(codexBase: URL) throws {
        try FileManager.default.createDirectory(at: codexBase, withIntermediateDirectories: true)
        try writeCodex(base: codexBase, y: "2026", m: "07", d: "06",
            filename: "rollout-2026-07-06T00-00-00-11111111-1111-4111-8111-111111111111.jsonl",
            lines: [codexMetaLine(id: "11111111-1111-4111-8111-111111111111", cwd: "/Users/t/proj"),
                    codexUserLine("父会话")])
        try writeCodex(base: codexBase, y: "2026", m: "07", d: "07",
            filename: "rollout-2026-07-07T00-00-00-22222222-2222-4222-8222-222222222222.jsonl",
            lines: [codexMetaLine(id: "22222222-2222-4222-8222-222222222222", cwd: "/Users/t/proj/.worktrees/wt-9"),
                    codexUserLine("worktree 子会话")])
    }

    @Test("CD_codex_worktree_merged_into_parent：Codex worktree 项目并入父条目（不再漏成独立 wt-9）")
    func codexWorktreeMergedIntoParent() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad, codex: true)
            try seedCodexWorktree(codexBase: s.codex!)
            // 前置自证：codex 源层可见两项目（scan 是 fail-open 设计，高负载下读失败=静默空——
            // 2026-07-16 实测 load>15 窗口本前置可翻；此时红=环境非产品逻辑，参照 flaky 台账处置）。
            let raw = CodexSessionSource(codexBasePath: s.codex!).getProjects()
            #expect(raw.count == 2, "前置：codex 扫描应见父+子两项目（失败=环境读压力，非归并逻辑）")
            let projects = try s.store.projects()
            #expect(!projects.contains { $0.displayName == "wt-9" }, "老缺陷：漏出独立 wt-9 条目")
            let parent = projects.first { $0.projectHash == "-Users-t-proj" }
            #expect(parent?.sessionCount == 2)
        }
    }

    @Test("CD_codex_worktree_sessions_query_parent：sessions(父) 查得 Codex 子会话且带 worktreeLabel")
    func codexWorktreeSessionsQueryParent() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad, codex: true)
            try seedCodexWorktree(codexBase: s.codex!)
            let sessions = try s.store.sessions(projectHash: "-Users-t-proj", limit: 50)
            #expect(sessions.count == 2)
            let child = sessions.first { $0.sessionId == "22222222-2222-4222-8222-222222222222" }
            #expect(child?.projectHash == "-Users-t-proj")
            #expect(child?.worktreeLabel == "wt-9")
        }
    }

    @Test("CD_livepage_autogroup_dirset_codex_children：livePage 项目面含规则目录/Codex 子会话；isAll 归组键归一")
    func livePageAutogroupAndCodexChildren() throws {
        try withTempRoot { root in
            let s = try openStore(root, policy: .relpad, codex: true)
            try seedRelPadFixture(cc: s.cc)
            try seedCodexWorktree(codexBase: s.codex!)
            try s.store.reconcile()
            // 项目面（RelPad 目标）：规则目录 CC 会话进页。
            let (page, _) = try s.store.liveSessionsPage(
                projectHash: Self.relpadDir, after: nil, pageSize: 50)
            #expect(Set(page.map(\.sessionId)).isSuperset(of: ["rp1", "rp2", "tg1", "wa1", "vd1", "fb1"]))
            #expect(page.first { $0.sessionId == "tg1" }?.worktreeLabel == "assistant-triage-6229")
            // 项目面（Codex 父）：子 worktree 会话扩查进页。
            let (codexPage, _) = try s.store.liveSessionsPage(
                projectHash: "-Users-t-proj", after: nil, pageSize: 50)
            #expect(codexPage.contains { $0.sessionId == "22222222-2222-4222-8222-222222222222" })
            // isAll：规则目录会话归组键/outputHash 归一为目标 hash。
            let (all, _) = try s.store.liveSessionsPage(projectHash: nil, after: nil, pageSize: 50)
            #expect(all.first { $0.sessionId == "tg1" }?.projectHash == Self.relpadDir)
        }
    }
}
