import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

@Suite("DataDirectory 引导")
struct DataDirectoryTests {
    @Test("空目录 bootstrap 建全目录树并写 SCHEMA_VERSION") // 验收 3-①
    func freshBootstrapCreatesLayout() throws {
        try withTempRoot { root in
            let dir = try DataDirectory.bootstrap(at: root)
            #expect(dir.wasCreatedFresh)
            #expect(dir.schemaVersion == SchemaVersionStamp(version: 1, channel: .dev))

            var isDir: ObjCBool = false
            let fm = FileManager.default
            #expect(fm.fileExists(atPath: dir.stateDirectoryURL.path, isDirectory: &isDir) && isDir.boolValue)
            #expect(fm.fileExists(atPath: dir.logsDirectoryURL.path, isDirectory: &isDir) && isDir.boolValue)
            let stamp = try String(contentsOf: dir.schemaVersionURL, encoding: .utf8)
            #expect(stamp == "1 dev\n")
            // fresh 目录不带 graceful-exit 标志
            #expect(!fm.fileExists(atPath: dir.gracefulExitFlagURL.path))
        }
    }

    @Test("bootstrap 建 M4a 编排父目录（worktrees/worker-config/logs/tasks）") // scheduler-worker §2/§4
    func freshBootstrapCreatesOrchestrationDirs() throws {
        try withTempRoot { root in
            let dir = try DataDirectory.bootstrap(at: root)
            var isDir: ObjCBool = false
            let fm = FileManager.default
            #expect(fm.fileExists(atPath: dir.worktreesDirectoryURL.path, isDirectory: &isDir) && isDir.boolValue)
            #expect(fm.fileExists(atPath: dir.workerConfigDirectoryURL.path, isDirectory: &isDir) && isDir.boolValue)
            #expect(fm.fileExists(atPath: dir.taskLogsDirectoryURL.path, isDirectory: &isDir) && isDir.boolValue)
            // 访问器落点：worktrees/worker-config 直挂 root，taskLogs 挂 logs/ 下。
            #expect(dir.worktreesDirectoryURL.lastPathComponent == "worktrees")
            #expect(dir.worktreesDirectoryURL.deletingLastPathComponent().path == root.path)
            #expect(dir.workerConfigDirectoryURL.lastPathComponent == "worker-config")
            #expect(dir.taskLogsDirectoryURL.deletingLastPathComponent().path == dir.logsDirectoryURL.path)
        }
    }

    @Test("已有目录二次 bootstrap 校验通过且不重置") // 验收 3-②
    func secondBootstrapOnExistingDir() throws {
        try withTempRoot { root in
            let first = try DataDirectory.bootstrap(at: root)
            let sentinel = first.stateDirectoryURL.appendingPathComponent("sentinel.txt")
            try Data("不许动".utf8).write(to: sentinel)

            let second = try DataDirectory.bootstrap(at: root)
            #expect(!second.wasCreatedFresh)
            #expect(second.schemaVersion == first.schemaVersion)
            #expect(try String(contentsOf: sentinel, encoding: .utf8) == "不许动")
        }
    }

    @Test("SCHEMA_VERSION 过新拒绝启动") // 验收 3-③
    func schemaTooNewRejected() throws {
        try withTempRoot { root in
            try Data("2 dev\n".utf8)
                .write(to: root.appendingPathComponent("SCHEMA_VERSION"))
            #expect(throws: DataDirectoryError.schemaTooNew(found: 2, supported: 1)) {
                _ = try DataDirectory.bootstrap(at: root)
            }
        }
    }

    @Test("SCHEMA_VERSION 损坏时报错拒启（不当 fresh 清数据）")
    func corruptSchemaVersionRejected() throws {
        try withTempRoot { root in
            try Data("garbage!!".utf8)
                .write(to: root.appendingPathComponent("SCHEMA_VERSION"))
            do {
                _ = try DataDirectory.bootstrap(at: root)
                Issue.record("应当抛 corruptSchemaVersion")
            } catch let error as DataDirectoryError {
                guard case .corruptSchemaVersion = error else {
                    Issue.record("错误类型不符：\(error)")
                    return
                }
            }
        }
    }

    @Test("channel 不符拒启")
    func channelMismatchRejected() throws {
        try withTempRoot { root in
            try Data("1 prod\n".utf8)
                .write(to: root.appendingPathComponent("SCHEMA_VERSION"))
            #expect(throws: DataDirectoryError.channelMismatch(found: "prod", expected: "dev")) {
                _ = try DataDirectory.bootstrap(at: root, channel: .dev)
            }
        }
    }

    @Test("缺 SCHEMA_VERSION 但 session.db 存在 → 拒绝当 fresh 重置")
    func unrecognizedDirectoryRejected() throws {
        try withTempRoot { root in
            let state = root.appendingPathComponent("state", isDirectory: true)
            try FileManager.default.createDirectory(at: state, withIntermediateDirectories: true)
            try Data("db".utf8).write(to: state.appendingPathComponent("session.db"))
            do {
                _ = try DataDirectory.bootstrap(at: root)
                Issue.record("应当抛 unrecognizedDataDirectory")
            } catch let error as DataDirectoryError {
                guard case .unrecognizedDataDirectory = error else {
                    Issue.record("错误类型不符：\(error)")
                    return
                }
            }
        }
    }

    @Test(
        "老版目录名谓词（大小写不敏感命中，正常名放行）", // 数据目录隔离纪律
        arguments: [
            ("Muxvo Dev", true), ("muxvo dev", true), ("MUXVO DEV", true),
            ("muxvo", true), ("Muxvo", true), ("MUXVO", true),
            ("Muxvo2 Dev", false), ("Muxvo2 Test", false), ("muxvo-data", false),
            ("my-muxvo", false), ("Muxvo Dev 2", false),
        ]
    )
    func forbiddenLegacyRootPredicate(name: String, forbidden: Bool) {
        #expect(DataDirectory.isForbiddenLegacyRootName(name) == forbidden)
    }

    @Test("defaultDevRoot 指向 Muxvo2 Dev 且不命中禁名")
    func defaultDevRootSane() {
        let root = DataDirectory.defaultDevRoot()
        #expect(root.lastPathComponent == "Muxvo2 Dev")
        #expect(root.path.contains("Application Support"))
        #expect(!DataDirectory.isForbiddenLegacyRootName(root.lastPathComponent))
    }

    // MARK: - M7 批3（§7.1）发布数据根 Muxvo2 + R-06 realpath 击穿防线

    @Test("releaseRootName=Muxvo2：非老根名、不命中禁名（R-06：绝不取 Muxvo，APFS 与 muxvo 撞目录）")
    func releaseRootNameSane() {
        #expect(DataDirectory.Layout.releaseRootName == "Muxvo2")
        // 不得等于老版生产根名，且不命中禁名谓词（大小写不敏感兜底任何 muxvo 变体）。
        #expect(DataDirectory.Layout.releaseRootName.lowercased() != "muxvo")
        #expect(!DataDirectory.isForbiddenLegacyRootName(DataDirectory.Layout.releaseRootName))
        // 反例护栏：若有人误改成 "Muxvo"，谓词必红（lowercased 命中 muxvo）。
        #expect(DataDirectory.isForbiddenLegacyRootName("Muxvo"))
    }

    @Test("legacyProdRootURL：~/Library/Application Support/muxvo（realpath 比对基准，只读派生）")
    func legacyProdRootDerivation() {
        let url = DataDirectory.legacyProdRootURL()
        #expect(url.lastPathComponent == "muxvo")
        #expect(url.path.contains("Application Support"))
    }

    @Test("R-06 realpath 击穿谓词：候选根为指向老根的符号链接 → true；独立目录 → false；不存在 → false")
    func legacyRealpathCollisionPredicate() throws {
        try withTempRoot { root in
            let fm = FileManager.default
            // 「老生产根」替身（tmp 内真实目录，绝不碰真实 ~/Library/Application Support/muxvo）。
            let legacy = root.appendingPathComponent("legacy-muxvo", isDirectory: true)
            try fm.createDirectory(at: legacy, withIntermediateDirectories: true)

            // (1) 候选根 = 指向老根的符号链接 → realpath 归一后同一真实路径 → 击穿 true。
            let aliased = root.appendingPathComponent("Muxvo2-alias", isDirectory: true)
            try fm.createSymbolicLink(at: aliased, withDestinationURL: legacy)
            #expect(DataDirectory.isLegacyRealpathCollision(root: aliased, legacyRoot: legacy))

            // (2) 独立真实目录（非别名）→ false。
            let independent = root.appendingPathComponent("Muxvo2", isDirectory: true)
            try fm.createDirectory(at: independent, withIntermediateDirectories: true)
            #expect(!DataDirectory.isLegacyRealpathCollision(root: independent, legacyRoot: legacy))

            // (3) 候选根不存在（fresh 首启常态）→ false（不存在不可能同 inode，避免幽灵路径误判）。
            let absent = root.appendingPathComponent("Muxvo2-absent", isDirectory: true)
            #expect(!DataDirectory.isLegacyRealpathCollision(root: absent, legacyRoot: legacy))
        }
    }

    // MARK: - M4a orch 路径访问器（批4 波3a 收账）

    @Test("orch 路径访问器：policy-rules/accounts/run socket（静态与实例一致；bootstrap 不预建配置文件）")
    func orchPathAccessors() throws {
        try withTempRoot { root in
            let dir = try DataDirectory.bootstrap(at: root)
            #expect(dir.policyRulesURL.lastPathComponent == "policy-rules.json")
            #expect(dir.accountsURL.lastPathComponent == "accounts.json")
            #expect(dir.controlPlaneSocketURL.path
                == root.appendingPathComponent("run/cp.sock").path)
            #expect(dir.runDirectoryURL.path == root.appendingPathComponent("run").path)
            // 静态版（装配层按根构造）与实例版一致。
            #expect(DataDirectory.policyRulesURL(under: root) == dir.policyRulesURL)
            #expect(DataDirectory.accountsURL(under: root) == dir.accountsURL)
            #expect(DataDirectory.controlPlaneSocketURL(under: root) == dir.controlPlaneSocketURL)
            // bootstrap 不预建这两配置文件（缺失各有默认语义：policy=出厂默认 / accounts=空池）。
            let fm = FileManager.default
            #expect(!fm.fileExists(atPath: dir.policyRulesURL.path))
            #expect(!fm.fileExists(atPath: dir.accountsURL.path))
        }
    }

    // MARK: - dogfood-r5 W-A 共享归档池根地基（PR-1；纯函数用例——不读进程 env，可并行）

    @Test("resolveSharedRoot：env 绝对路径覆盖优先；空 env → plist 名；plist 空 → 默认 Muxvo Shared")
    func resolveSharedRootOverrides() {
        // env 绝对路径优先（plist 名被忽略）
        let byEnv = DataDirectory.resolveSharedRoot(env: "/tmp/muxvo-shared-xyz", plistName: "IgnoredName")
        #expect(byEnv?.path == "/tmp/muxvo-shared-xyz")
        // 空 env → plist 名（Application Support 下）
        let byPlist = DataDirectory.resolveSharedRoot(env: nil, plistName: "Muxvo3 Shared")
        #expect(byPlist?.lastPathComponent == "Muxvo3 Shared")
        #expect(byPlist?.path.contains("Application Support") == true)
        // env 空串视同缺省 → plist 名
        let emptyEnv = DataDirectory.resolveSharedRoot(env: "", plistName: "Muxvo3 Shared")
        #expect(emptyEnv?.lastPathComponent == "Muxvo3 Shared")
        // env 与 plist 都缺 → 默认名
        #expect(DataDirectory.resolveSharedRoot(env: nil, plistName: nil)?.lastPathComponent == "Muxvo Shared")
        // plist 空串视同缺省 → 默认名
        #expect(DataDirectory.resolveSharedRoot(env: nil, plistName: "")?.lastPathComponent == "Muxvo Shared")
    }

    @Test("resolveSharedRoot：相对路径 env 拒绝（返回 nil，调用方 fatalError 显性挂配置错误）")
    func resolveSharedRootRejectsRelativeEnv() {
        #expect(DataDirectory.resolveSharedRoot(env: "relative/path", plistName: nil) == nil)
        #expect(DataDirectory.resolveSharedRoot(env: "./x", plistName: nil) == nil)
        #expect(DataDirectory.resolveSharedRoot(env: "~/x", plistName: nil) == nil) // ~ 不展开，非 "/" 开头
        #expect(DataDirectory.resolveSharedRoot(env: "/abs/ok", plistName: nil) != nil) // 反例：绝对路径放行
    }

    @Test("chatArchiveMigrationMarkerURL：落 <root>/state/chat-archive-migrated.json")
    func chatArchiveMigrationMarkerDerivation() throws {
        try withTempRoot { root in
            let marker = DataDirectory.chatArchiveMigrationMarkerURL(under: root)
            #expect(marker.lastPathComponent == "chat-archive-migrated.json")
            #expect(marker.deletingLastPathComponent().lastPathComponent == "state")
            #expect(marker.deletingLastPathComponent().deletingLastPathComponent().path == root.path)
        }
    }

    // MARK: - M7 升级迁移地基（legacy-migration.md；纯派生/纯函数用例——不读进程 env，可并行）

    @Test("legacyMuxvoChatArchiveRootURL：<home>/.muxvo/chat-archive（home 可注入；默认取真实家目录）")
    func legacyMuxvoChatArchiveRootDerivation() {
        let root = DataDirectory.legacyMuxvoChatArchiveRootURL(home: URL(fileURLWithPath: "/Users/x"))
        #expect(root.path == "/Users/x/.muxvo/chat-archive")
        // 默认参 = 真实家目录派生（只断派生形状，不触碰真实目录内容）。
        let real = DataDirectory.legacyMuxvoChatArchiveRootURL()
        #expect(real.lastPathComponent == "chat-archive")
        #expect(real.deletingLastPathComponent().lastPathComponent == ".muxvo")
    }

    @Test("legacyChatArchiveMigrationMarkerURL：落 <root>/state/legacy-chat-archive-migrated.json（独立于 PR-4 marker）")
    func legacyChatArchiveMigrationMarkerDerivation() throws {
        try withTempRoot { root in
            let marker = DataDirectory.legacyChatArchiveMigrationMarkerURL(under: root)
            #expect(marker.lastPathComponent == "legacy-chat-archive-migrated.json")
            #expect(marker.deletingLastPathComponent().lastPathComponent == "state")
            #expect(marker.path != DataDirectory.chatArchiveMigrationMarkerURL(under: root).path)
        }
    }

    @Test("isSharedRootOverridden 真值表：env/plist 任一非空=覆盖；空串视同缺省（与 resolveSharedRoot 语义一致）")
    func sharedRootOverriddenTruthTable() {
        #expect(DataDirectory.isSharedRootOverridden(env: nil, plistName: nil) == false)
        #expect(DataDirectory.isSharedRootOverridden(env: "", plistName: "") == false)
        #expect(DataDirectory.isSharedRootOverridden(env: "/tmp/x", plistName: nil) == true)
        #expect(DataDirectory.isSharedRootOverridden(env: nil, plistName: "Muxvo3 Shared") == true)
        #expect(DataDirectory.isSharedRootOverridden(env: "/tmp/x", plistName: "Muxvo3 Shared") == true)
        // 相对路径 env 虽会被 defaultSharedRoot 侧拒绝（fatalError），门控谓词仍视为「已覆盖」——
        // 宁可不迁也不把真归档误吸进配置错误的池。
        #expect(DataDirectory.isSharedRootOverridden(env: "relative", plistName: nil) == true)
    }

    @Test("M7 门控↔resolveSharedRoot 语义锁（对抗 MINOR-1）：未覆盖 ⟺ 解析落默认形状——两纯函数对同输入永不漂移（plist 名恰为默认名的病态配置除外，门控保守跳过）")
    func gateMatchesResolverSemantics() {
        let cases: [(env: String?, plist: String?)] = [
            (nil, nil), ("", ""), (nil, ""), ("", nil),
            ("/tmp/x", nil), ("/tmp/x", ""), (nil, "Muxvo3 Shared"), ("", "Muxvo3 Shared"),
            ("/tmp/x", "Muxvo3 Shared"), ("relative", nil),
        ]
        for c in cases {
            let overridden = DataDirectory.isSharedRootOverridden(env: c.env, plistName: c.plist)
            let resolved = DataDirectory.resolveSharedRoot(env: c.env, plistName: c.plist)
            let defaultShape = (resolved?.lastPathComponent == "Muxvo Shared")
                && (resolved?.path.contains("Application Support") == true)
            // 覆盖 ⟺ 非默认形状（含相对路径拒绝的 nil）。任何一侧改语义不同步另一侧，此锁即红。
            #expect(overridden == !defaultShape, "env=\(c.env ?? "nil") plist=\(c.plist ?? "nil")")
        }
    }
}

/// env 变更用例串行（`.serialized`）：三者都读/写 `MUXVO_SHARED_ROOT`，并行会互扰默认派生断言。
/// 每例起始防御性 unsetenv（消前序残留），只 envOverrideEndToEnd 显式 set 后 defer unset。
@Suite("DataDirectory 共享归档池根覆盖缝（env 变更串行）", .serialized)
struct DataDirectorySharedRootEnvTests {
    @Test("defaultSharedRoot：无 env 时默认派生 Muxvo Shared（Application Support 下，不命中禁名）")
    func defaultDerivesMuxvoShared() {
        unsetenv("MUXVO_SHARED_ROOT")
        let root = DataDirectory.defaultSharedRoot()
        #expect(root.lastPathComponent == "Muxvo Shared")
        #expect(root.path.contains("Application Support"))
        #expect(!DataDirectory.isForbiddenLegacyRootName(root.lastPathComponent))
    }

    @Test("sharedChatHistoryRootURL：无 env 时 = defaultSharedRoot()/chat-history（唯一权威派生）")
    func sharedChatHistoryRootDerivation() {
        unsetenv("MUXVO_SHARED_ROOT")
        let chatRoot = DataDirectory.sharedChatHistoryRootURL()
        #expect(chatRoot.lastPathComponent == "chat-history")
        #expect(chatRoot.deletingLastPathComponent().lastPathComponent == "Muxvo Shared")
        #expect(chatRoot == DataDirectory.chatHistoryDirectoryURL(under: DataDirectory.defaultSharedRoot()))
    }

    @Test("defaultSharedRoot：MUXVO_SHARED_ROOT env 绝对路径覆盖端到端生效（setenv/unsetenv 包裹）")
    func envOverrideEndToEnd() {
        setenv("MUXVO_SHARED_ROOT", "/tmp/muxvo-shared-e2e", 1)
        defer { unsetenv("MUXVO_SHARED_ROOT") }
        #expect(DataDirectory.defaultSharedRoot().path == "/tmp/muxvo-shared-e2e")
    }

    @Test("M7 门控壳 sharedRootIsOverridden：读真实 MUXVO_SHARED_ROOT 键端到端（对抗 MINOR-1 装配断点防线；测试 bundle 无 MuxvoSharedRootName plist 键——defaultDerivesMuxvoShared 已依赖此前提）")
    func sharedRootOverriddenShellEndToEnd() {
        unsetenv("MUXVO_SHARED_ROOT")
        #expect(DataDirectory.sharedRootIsOverridden() == false)
        setenv("MUXVO_SHARED_ROOT", "/tmp/muxvo-shared-gate", 1)
        defer { unsetenv("MUXVO_SHARED_ROOT") }
        // 壳与 defaultSharedRoot 读同一 env 键：set 后两者必须同时感知（键名漂移即红）。
        #expect(DataDirectory.sharedRootIsOverridden() == true)
        #expect(DataDirectory.defaultSharedRoot().path == "/tmp/muxvo-shared-gate")
    }
}
