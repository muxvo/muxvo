// 数据目录纪律的唯一载体：布局常量、bootstrap、老目录名硬保护。
// dev 数据根 = ~/Library/Application Support/Muxvo2 Dev/（发布目录名与老数据迁移 M7 再定）。
// 字面量纪律（scripts/preflight.sh 第 6 步 grep 强制，范围 app/ 下 *.swift）：
// "graceful_exit.flag" 只允许出现在本文件；"Muxvo2 Dev" 只允许出现在本文件与
// DataDirectoryTests.swift（测试刻意硬编码，常量被改名时能抓住）。
import Foundation

public enum DataDirectoryError: Error, Equatable {
    case schemaTooNew(found: Int, supported: Int)
    case migrationRequired(found: Int, current: Int) // M1 不可达（current=1，解析最小 1），为未来版本预留
    case channelMismatch(found: String, expected: String)
    case corruptSchemaVersion(detail: String)
    case unrecognizedDataDirectory(detail: String)
}

public struct DataDirectory: Sendable {
    public let root: URL
    public let schemaVersion: SchemaVersionStamp
    public let wasCreatedFresh: Bool

    public static let currentSchemaVersion = 1

    enum Layout {
        static let devRootName = "Muxvo2 Dev"
        // M7 批3（legacy-migration.md §7.1 / distribution.md §1.1）：正式发布数据根名。
        // ⚠️严禁 "Muxvo"：APFS 大小写不敏感，"Muxvo" 与老版生产根 "muxvo" 同目录 → 迁移只读防线
        // 物理击穿（R-06）；"Muxvo2" 与老根名不同、且 isForbiddenLegacyRootName 兜住任何 "muxvo" 变体。
        // 发布根 vs dev 根的选择沿用既有 MuxvoDataRootName plist 键机制（defaultDevRoot 读之）：发布
        // 打包（app.sh 发布 env）注入 MuxvoDataRootName="Muxvo2"，dev/test/CLI 无键 → devRootName。
        static let releaseRootName = "Muxvo2"
        static let schemaVersionFile = "SCHEMA_VERSION"
        static let gracefulExitFlagFile = "graceful_exit.flag"
        static let instanceLockFile = "instance.lock"
        static let lastCrashLogFile = "last-crash.json"
        static let stateDirectory = "state"
        static let sessionDatabaseFile = "session.db"
        static let logsDirectory = "logs"
        // M4a 编排布局（scheduler-worker.md §2/§4）——per-task 子目录由调度器按需建，此为父目录名。
        static let worktreesDirectory = "worktrees" // per-task git worktree 工作树根（§2）
        static let consoleHomeDirectory = "console-home" // 指挥台 claude 的 cwd（command-console.md §4；SKILL.md app-owned + CLAUDE.md user-owned）
        // M4c 编排三期批3（pipeline-supervisor.md §7）：模板数据资产双层所有权根。
        static let pipelineTemplatesDirectory = "pipeline-templates" // factory/（app-owned 核 hash 覆写）+ user/（user-owned 永不覆写）
        static let pipelineTemplatesFactorySubdir = "factory"
        static let pipelineTemplatesUserSubdir = "user"
        static let workerConfigDirectory = "worker-config" // per-task 隔离 CLAUDE_CONFIG_DIR 根（§4.1 SEC-02）
        static let taskLogsDirectory = "tasks" // 位于 logsDirectory 下：per-task worker stderr（§4.2）
        static let runDirectory = "run" // per-spawn 瞬态物根（mcp-config、控制面 socket、worker 账本）
        static let controlPlaneSocketFile = "cp.sock" // 位于 runDirectory 下：中央控制面 unix socket（§4.1）
        // M4b 终端会话恢复（terminal-session-restore.md §2）：位于 runDirectory 下，与 pty-children.json
        // /hook.sock 同瞬态运行物域，但内容须跨重启存活作恢复依据（同 pty-children 先例）。0600（SEC-M2）。
        static let terminalActiveSessionsFile = "terminal-active-sessions.json"
        // native 配置文件（各域独立 JSON + 顶层 version 信封；缺失各有默认语义，bootstrap 不预建）：
        static let policyRulesFile = "policy-rules.json" // policy-audit.md §4；缺失=出厂默认，损坏=failsafe
        static let accountsFile = "accounts.json" // scheduler-worker.md §5 账号池；缺失=空池
        static let orchPrefsFile = "orch-prefs.json" // task-center-panel.md §2.4 r8 编排偏好（默认工作根）；缺失=home 默认
        // M5 聊天数据面（chat-data.md §6）——镜像/归档一律落数据根内（严禁 legacy `~/.muxvo/chat-archive/`）。
        static let chatHistoryDirectory = "chat-history" // CC/Codex 会话镜像根（§6.2，扁平 <projectHash>/<sessionId>.jsonl）
        static let chatSyncStateFile = "sync-state.json" // 位于 chatHistoryDirectory 下：{lastSync, fileMtime}（§6.3 裁决 C，记录/断言面非游标）
        static let chatDatabaseFile = "chat.db" // 位于 stateDirectory 下：聊天索引/元数据库（首次同步/首访按需建，bootstrap 不预建）
        static let chatExportsDirectory = "exports" // 聊天导出落盘根（CHAT_L1_06 markdown/json；严禁 legacy `~/.muxvo/exports/`）
        static let chatCustomTitlesFile = "chat-custom-titles.json" // 位于 stateDirectory 下：老版 sessionCustomTitles 持久化（ChatCustomTitlesStore 消费，缺失=空表；不塞 ConfigStore 避终端 config 高频写放大）
        static let worktreeNamesFile = "worktree-names.json" // 位于 stateDirectory 下：worktree 路径→自定义名（WorktreeNamesStore 消费，缺失=空表；绑路径实体非终端生命周期，故不进 openTerminals）
        // dogfood-r5 W-A 中心化共享归档池（所有 Muxvo 分身共用聊天镜像，CC 30 天清理后永不丢）：
        static let sharedRootName = "Muxvo Shared" // 共享归档根名（默认 `<applicationSupport>/Muxvo Shared`；defaultSharedRoot 派生）
        static let chatArchiveMigratedMarkerFile = "chat-archive-migrated.json" // 位于 stateDirectory 下：一次性迁移完成 marker（ChatArchiveMigrator 消费，存在即短路）
        // M7 升级迁移（legacy-migration.md）：老版 Electron 归档 `~/.muxvo/chat-archive/` → 共享池，独立于上行 PR-4 marker（两迁移源不同、各自幂等 seal）。
        static let legacyChatArchiveMigratedMarkerFile = "legacy-chat-archive-migrated.json" // 位于 stateDirectory 下
        // 老版 dev（"Muxvo Dev"）与老版生产（"muxvo"）目录，小写比较（APFS 默认大小写不敏感）
        static let forbiddenLegacyRootNames: Set<String> = ["muxvo dev", "muxvo"]
    }

    public static func defaultDevRoot() -> URL {
        // 分身安装覆盖（2026-07-06 用户指示：验收期并行装 Muxvo3 不打扰在用 Muxvo2）：
        // app bundle 的 Info.plist 可携 `MuxvoDataRootName` 键（app.sh MUXVO_DATA_ROOT_NAME 注入）
        // 指定独立数据根——数据/防双开锁随之分离，两 app 并行互不干扰。键缺失（常态：swift test、CLI）
        // = 原默认 devRootName。老目录禁名守卫对覆盖值同样生效（bootstrap → enforceLegacyRootGuard）。
        // M7 批3（§7.1）发布根选择即复用本机制：**发布打包**经 app.sh 发布 env 注入
        // MuxvoDataRootName=`Layout.releaseRootName`（"Muxvo2"）→ 正式发布落 `Muxvo2` 根；dev/dogfood
        // 路径不设该值或设各自分身名，行为不变。此函数名沿用历史（"Dev"），实为通用数据根解析器。
        let name =
            (Bundle.main.object(forInfoDictionaryKey: "MuxvoDataRootName") as? String)
            ?? Layout.devRootName
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(name, isDirectory: true)
    }

    /// dogfood-r5 W-A 中心化共享归档池根（所有 Muxvo 分身共用；CC 30 天清理后永不丢）。覆盖优先级：
    ///   env `MUXVO_SHARED_ROOT`（绝对路径，测试/e2e 隔离；非 "/" 开头 = 配置错误，fatalError 显性挂）
    ///   > Info.plist `MuxvoSharedRootName`（Application Support 下目录名，app.sh MUXVO_SHARED_ROOT_NAME 注入；空视同缺省）
    ///   > 默认 `<applicationSupport>/Muxvo Shared`。
    /// 解析结果一律过 enforceLegacyRootGuard（同 defaultDevRoot 老目录隔离纪律）。解析逻辑抽 resolveSharedRoot
    /// 纯函数供单测（fatalError/守卫留此装配壳，纯函数不 fatalError 保可测）。
    public static func defaultSharedRoot() -> URL {
        let env = ProcessInfo.processInfo.environment["MUXVO_SHARED_ROOT"]
        let plistName = Bundle.main.object(forInfoDictionaryKey: "MuxvoSharedRootName") as? String
        guard let root = resolveSharedRoot(env: env, plistName: plistName) else {
            fatalError("MUXVO_SHARED_ROOT 必须为绝对路径（'/' 开头），实为：\(env ?? "<nil>")")
        }
        enforceLegacyRootGuard(root)
        return root
    }

    /// 纯解析（单测覆盖三层覆盖缝 + 相对路径拒绝）：env 覆盖非空必须以 "/" 开头（绝对路径），否则返回
    /// nil（调用方 fatalError 显性挂配置错误——纯函数自身不 fatalError 保可测）；env 空/缺 → plist 名（非空）
    /// → 默认 sharedRootName。禁名守卫由 defaultSharedRoot 装配壳施加，与本纯函数纯度分离。
    static func resolveSharedRoot(env: String?, plistName: String?) -> URL? {
        if let env, !env.isEmpty {
            guard env.hasPrefix("/") else { return nil }  // 相对路径 env = 配置错误
            return URL(fileURLWithPath: env, isDirectory: true)
        }
        let name = (plistName?.isEmpty == false) ? plistName! : Layout.sharedRootName
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(name, isDirectory: true)
    }

    /// 纯谓词（单测覆盖）；fatalError 调用点见 enforceLegacyRootGuard。
    static func isForbiddenLegacyRootName(_ lastPathComponent: String) -> Bool {
        Layout.forbiddenLegacyRootNames.contains(lastPathComponent.lowercased())
    }

    /// 老版生产数据根 `~/Library/Application Support/muxvo`（realpath 击穿防线的比较基准；只读派生，
    /// 绝不读写——本仓库对老根一律零触碰，此处仅取其路径做碰撞比对）。
    static func legacyProdRootURL() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("muxvo", isDirectory: true)
    }

    /// R-06 realpath 击穿纯谓词（单测覆盖）：候选根**实际存在**且其符号链接/别名解析后与老版生产根
    /// 同一真实路径 → true（禁名守卫按 lastPathComponent 拦不住「Muxvo2 被建成指向 muxvo 的符号链接」
    /// 之类别名绕过，故加此 realpath 层）。两侧均经 resolvingSymlinksInPath + standardized 归一比较。
    /// 候选根不存在（fresh 首启常态）→ false：不存在的根不可能与老根同 inode，且避免对幽灵路径误判。
    static func isLegacyRealpathCollision(root: URL, legacyRoot: URL) -> Bool {
        guard FileManager.default.fileExists(atPath: root.path) else { return false }
        let rootReal = root.resolvingSymlinksInPath().standardizedFileURL
        let legacyReal = legacyRoot.resolvingSymlinksInPath().standardizedFileURL
        return rootReal == legacyReal
    }

    /// 老版数据目录硬保护（CLAUDE.md 数据目录隔离纪律 + M7 批3 R-06）：误传老目录 = 编程错误，直接挂掉。
    /// 两道防线：①名字（大小写不敏感命中 muxvo/muxvo dev）②realpath 击穿（符号链接/别名指向老生产根）。
    static func enforceLegacyRootGuard(_ root: URL) {
        if isForbiddenLegacyRootName(root.lastPathComponent) {
            fatalError("拒绝把老版数据目录用作 Muxvo2 数据根：\(root.path)")
        }
        if isLegacyRealpathCollision(root: root, legacyRoot: legacyProdRootURL()) {
            fatalError("Muxvo2 数据根 realpath 命中老版生产根（R-06 击穿，拒启）：\(root.path)")
        }
    }

    /// fresh（无 SCHEMA_VERSION 且无 state/session.db）：幂等建目录树 + 末步原子写 SCHEMA_VERSION；
    /// 已有：读 SCHEMA_VERSION 校验（过新/损坏/channel 不符 → throw）；
    /// 无 stamp 但 session.db 存在 → 目录身份不明，拒碰。
    public static func bootstrap(at root: URL, channel: ReleaseChannel = .dev) throws -> DataDirectory {
        enforceLegacyRootGuard(root)
        let fm = FileManager.default
        let schemaURL = root.appendingPathComponent(Layout.schemaVersionFile)
        let stampExists = fm.fileExists(atPath: schemaURL.path)

        // 目录树幂等创建（fresh 与已有都跑，容忍半初始化残留）
        try fm.createDirectory(
            at: root.appendingPathComponent(Layout.stateDirectory, isDirectory: true),
            withIntermediateDirectories: true
        )
        try fm.createDirectory(
            at: root.appendingPathComponent(Layout.logsDirectory, isDirectory: true),
            withIntermediateDirectories: true
        )
        // M4a 编排父目录（scheduler-worker.md §2/§4）：与 state/logs 同幂等语义，fresh 与已有都建。
        try fm.createDirectory(
            at: root.appendingPathComponent(Layout.worktreesDirectory, isDirectory: true),
            withIntermediateDirectories: true
        )
        try fm.createDirectory(
            at: root.appendingPathComponent(Layout.workerConfigDirectory, isDirectory: true),
            withIntermediateDirectories: true
        )
        try fm.createDirectory(
            at: root.appendingPathComponent(Layout.logsDirectory, isDirectory: true)
                .appendingPathComponent(Layout.taskLogsDirectory, isDirectory: true),
            withIntermediateDirectories: true
        )

        if stampExists {
            let stamp = try SchemaVersionStamp.parse(Data(contentsOf: schemaURL))
            guard stamp.version <= currentSchemaVersion else {
                throw DataDirectoryError.schemaTooNew(
                    found: stamp.version, supported: currentSchemaVersion)
            }
            guard stamp.version == currentSchemaVersion else {
                throw DataDirectoryError.migrationRequired(
                    found: stamp.version, current: currentSchemaVersion)
            }
            guard stamp.channel == channel else {
                throw DataDirectoryError.channelMismatch(
                    found: stamp.channel.rawValue, expected: channel.rawValue)
            }
            return DataDirectory(root: root, schemaVersion: stamp, wasCreatedFresh: false)
        }

        let sessionDB = root
            .appendingPathComponent(Layout.stateDirectory, isDirectory: true)
            .appendingPathComponent(Layout.sessionDatabaseFile)
        guard !fm.fileExists(atPath: sessionDB.path) else {
            throw DataDirectoryError.unrecognizedDataDirectory(
                detail: "缺 \(Layout.schemaVersionFile) 但 \(Layout.stateDirectory)/\(Layout.sessionDatabaseFile) 存在，拒绝当 fresh 重置")
        }
        let stamp = SchemaVersionStamp(version: currentSchemaVersion, channel: channel)
        try AtomicFile.write(stamp.serialized(), to: schemaURL, durability: .full) // stamp 最后写
        return DataDirectory(root: root, schemaVersion: stamp, wasCreatedFresh: true)
    }

    // MARK: - 布局访问器（调用方永不拼字面量）

    public var schemaVersionURL: URL { root.appendingPathComponent(Layout.schemaVersionFile) }
    public var gracefulExitFlagURL: URL { root.appendingPathComponent(Layout.gracefulExitFlagFile) }
    public var instanceLockURL: URL { Self.instanceLockURL(under: root) }
    public var lastCrashLogURL: URL { root.appendingPathComponent(Layout.lastCrashLogFile) }
    public var stateDirectoryURL: URL {
        root.appendingPathComponent(Layout.stateDirectory, isDirectory: true)
    }

    public var sessionDatabaseURL: URL {
        stateDirectoryURL.appendingPathComponent(Layout.sessionDatabaseFile)
    }

    public var logsDirectoryURL: URL {
        root.appendingPathComponent(Layout.logsDirectory, isDirectory: true)
    }

    /// M4a 编排：per-task git worktree 工作树根（§2；隔离纪律内，git 管理态仍在主仓 .git/worktrees/）。
    public var worktreesDirectoryURL: URL { Self.worktreesDirectoryURL(under: root) }

    /// M4a 编排：per-task 隔离 worker 设置作用域根（§4.1 SEC-02，隔离 CLAUDE_CONFIG_DIR 的父）。
    public var workerConfigDirectoryURL: URL {
        root.appendingPathComponent(Layout.workerConfigDirectory, isDirectory: true)
    }

    /// M4a 编排：per-task worker stderr 日志根（§4.2，位于 logs/ 下）。
    public var taskLogsDirectoryURL: URL {
        logsDirectoryURL.appendingPathComponent(Layout.taskLogsDirectory, isDirectory: true)
    }

    /// M4a 编排：per-spawn 瞬态物根（mcp-config / 控制面 socket / worker 账本；§4.1）。
    public var runDirectoryURL: URL { Self.runDirectoryURL(under: root) }

    /// M4a 编排：中央控制面 unix socket 路径（§4.1；proxy `--socket` 目标）。
    public var controlPlaneSocketURL: URL { Self.controlPlaneSocketURL(under: root) }

    /// M4a 策略：policy-rules.json 路径（policy-audit.md §4；PolicyConfigLoader 消费，缺失=出厂默认）。
    public var policyRulesURL: URL { Self.policyRulesURL(under: root) }

    /// M4a 账号池：accounts.json 路径（scheduler-worker.md §5；AccountStore 消费，缺失=空池）。
    public var accountsURL: URL { Self.accountsURL(under: root) }

    /// M4a 编排偏好：orch-prefs.json 路径（task-center-panel.md §2.4 r8；OrchPrefsStore 消费，缺失=home 默认）。
    public var orchPrefsURL: URL { Self.orchPrefsURL(under: root) }

    /// M5 聊天镜像根：`<root>/chat-history/`（chat-data.md §6.2；ChatMirror 首次同步按需建，bootstrap 不预建）。
    public var chatHistoryDirectoryURL: URL { Self.chatHistoryDirectoryURL(under: root) }

    /// M5 同步态：`<root>/chat-history/sync-state.json`（§6.3 裁决 C；ChatSyncState 原子写、DATA_L1_07 断言）。
    public var chatSyncStateURL: URL { Self.chatSyncStateURL(under: root) }

    /// M5 聊天库：`<root>/state/chat.db`（ChatDatabase 消费；与 session.db 同置 state/ 下）。
    public var chatDatabaseURL: URL { Self.chatDatabaseURL(under: root) }

    /// M5-R1 聊天自定义标题：`<root>/state/chat-custom-titles.json`（ChatCustomTitlesStore 消费，缺失=空表）。
    public var chatCustomTitlesURL: URL { Self.chatCustomTitlesURL(under: root) }

    /// 静态版供 AppLifecycle 在 bootstrap 之前拿锁用（lock 在数据目录内）。
    static func instanceLockURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.instanceLockFile)
    }

    /// 静态版（装配层在 bootstrap 前/外按根构造 orch 路径，同 instanceLockURL 体例）。
    /// 静态版（装配层在 bootstrap 前/外按根构造 worktrees 根，供 WorktreeManager 注入）。
    public static func worktreesDirectoryURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.worktreesDirectory, isDirectory: true)
    }

    /// 指挥台 console-home 根（command-console.md §4，M4b' T5）：ConsoleHomeManager 在此确保
    /// `.claude/skills/muxvo-console/SKILL.md`（app-owned）+ `CLAUDE.md`（user-owned）。
    public static func consoleHomeDirectoryURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.consoleHomeDirectory, isDirectory: true)
    }

    /// M4c 模板资产根 `<root>/pipeline-templates/`（pipeline-supervisor.md §7，批3 T1）：
    /// TemplateStore 在此确保 `factory/`（app-owned 核 hash 覆写）+ `user/`（user-owned 永不覆写）。
    public static func pipelineTemplatesDirectoryURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.pipelineTemplatesDirectory, isDirectory: true)
    }

    public static func pipelineTemplatesFactoryURL(under root: URL) -> URL {
        pipelineTemplatesDirectoryURL(under: root)
            .appendingPathComponent(Layout.pipelineTemplatesFactorySubdir, isDirectory: true)
    }

    public static func pipelineTemplatesUserURL(under root: URL) -> URL {
        pipelineTemplatesDirectoryURL(under: root)
            .appendingPathComponent(Layout.pipelineTemplatesUserSubdir, isDirectory: true)
    }

    public static func runDirectoryURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.runDirectory, isDirectory: true)
    }

    public static func controlPlaneSocketURL(under root: URL) -> URL {
        runDirectoryURL(under: root).appendingPathComponent(Layout.controlPlaneSocketFile)
    }

    /// M4b 终端会话恢复锚点文件 `<root>/run/terminal-active-sessions.json`
    /// （terminal-session-restore.md §2；TerminalActiveSessionsStore 消费，缺失=空/首启）。
    public static func terminalActiveSessionsURL(under root: URL) -> URL {
        runDirectoryURL(under: root).appendingPathComponent(Layout.terminalActiveSessionsFile)
    }

    public static func policyRulesURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.policyRulesFile)
    }

    public static func accountsURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.accountsFile)
    }

    public static func orchPrefsURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.orchPrefsFile)
    }

    /// 静态版（ChatMirror 在装配层按根构造镜像根，同 worktreesDirectoryURL 体例）。
    public static func chatHistoryDirectoryURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.chatHistoryDirectory, isDirectory: true)
    }

    public static func chatSyncStateURL(under root: URL) -> URL {
        chatHistoryDirectoryURL(under: root).appendingPathComponent(Layout.chatSyncStateFile)
    }

    public static func chatDatabaseURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.stateDirectory, isDirectory: true)
            .appendingPathComponent(Layout.chatDatabaseFile)
    }

    /// M5-R1：聊天自定义标题 `<root>/state/chat-custom-titles.json`（老版 sessionCustomTitles；
    /// ChatCustomTitlesStore 消费，缺失=空表。独立文件不塞 ConfigStore，避终端 config 高频写放大）。
    public static func chatCustomTitlesURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.stateDirectory, isDirectory: true)
            .appendingPathComponent(Layout.chatCustomTitlesFile)
    }

    /// worktree 自定义名 `<root>/state/worktree-names.json`（WorktreeNamesStore 消费，缺失=空表）。
    public static func worktreeNamesURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.stateDirectory, isDirectory: true)
            .appendingPathComponent(Layout.worktreeNamesFile)
    }

    /// M5 聊天导出根：`<root>/exports/`（CHAT_L1_06；ChatAssembly export 落盘，按需建）。
    public static func chatExportsDirectoryURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.chatExportsDirectory, isDirectory: true)
    }

    /// dogfood-r5 W-A：共享归档池的聊天镜像根 `<sharedRoot>/chat-history/`（唯一权威——
    /// ChatMirror/ChatRestore/ChatArchiveMigrator 一律经此派生，绝不字面量拼路径）。
    /// 复用 chatHistoryDirectoryURL 布局常量，与 per-分身镜像根同构（reader 同一份代码读两侧）。
    public static func sharedChatHistoryRootURL() -> URL {
        chatHistoryDirectoryURL(under: defaultSharedRoot())
    }

    /// dogfood-r5 W-A：一次性迁移完成 marker `<root>/state/chat-archive-migrated.json`
    /// （ChatArchiveMigrator 消费；存在即短路 no-op，缺失/不完整迁移会重跑，对比-跳过幂等）。
    public static func chatArchiveMigrationMarkerURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.stateDirectory, isDirectory: true)
            .appendingPathComponent(Layout.chatArchiveMigratedMarkerFile)
    }

    /// M7 升级迁移（legacy-migration.md）：老版 Electron 聊天归档根 `~/.muxvo/chat-archive/`——迁移源
    /// **唯一派生点**（preflight 步6 grep 固化：`.muxvo` 字面量此外仅 AppDelegate 既有新手引导踪迹检测与
    /// 测试）。chat-data.md §6.2 豁免：仅作一次性**只读**迁移源（marker 门控、迁毕不再读），仍严禁写入/
    /// 常驻读/watch。`home` 可注入供单测（$HOME 覆盖不影响 FileManager user-domain，测试一律经参数传
    /// fixture 根，不靠环境变量）。
    public static func legacyMuxvoChatArchiveRootURL(
        home: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> URL {
        home.appendingPathComponent(".muxvo", isDirectory: true)
            .appendingPathComponent("chat-archive", isDirectory: true)
    }

    /// M7 升级迁移完成 marker `<root>/state/legacy-chat-archive-migrated.json`（per-分身，独立于 PR-4
    /// marker——首分身 seal 只封自己，其余分身各自补迁，chat-data.md §6.5 既有裁决沿用）。
    public static func legacyChatArchiveMigrationMarkerURL(under root: URL) -> URL {
        root.appendingPathComponent(Layout.stateDirectory, isDirectory: true)
            .appendingPathComponent(Layout.legacyChatArchiveMigratedMarkerFile)
    }

    /// M7 升级迁移门控（纯函数，单测真值表）：共享根被覆盖（env `MUXVO_SHARED_ROOT` 或 plist
    /// `MuxvoSharedRootName` 任一**非空**）= 隔离/验收池，真实老归档只准进正式默认池「Muxvo Shared」。
    /// 空串视同缺省（与 resolveSharedRoot 的 plist 空串语义一致）。
    static func isSharedRootOverridden(env: String?, plistName: String?) -> Bool {
        if let env, !env.isEmpty { return true }
        if let plistName, !plistName.isEmpty { return true }
        return false
    }

    /// 装配壳（AppDelegate 消费；纯函数 isSharedRootOverridden 判定，与 defaultSharedRoot 同源读
    /// env/plist——两处读法漂移即门控失真，故取值表达式保持逐字一致）。
    public static func sharedRootIsOverridden() -> Bool {
        isSharedRootOverridden(
            env: ProcessInfo.processInfo.environment["MUXVO_SHARED_ROOT"],
            plistName: Bundle.main.object(forInfoDictionaryKey: "MuxvoSharedRootName") as? String)
    }
}
