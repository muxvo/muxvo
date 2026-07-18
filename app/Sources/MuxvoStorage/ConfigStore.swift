// config.json 持久化（MuxvoConfig Codable + 原子读写）。
//
// 权威：APP_L1_01（app:get-config 完整 config 结构）+ APP_L1_02（app:save-config 原子落盘）
// + terminal-session.md §9 / terminal-rendering.md §4.4 默认值合同。形状与默认值亲验 legacy
// 源码：src/main/services/app/config.ts DEFAULT_CONFIG（config 形状 + 默认）、
// src/shared/types/config.types.ts MuxvoConfig/OpenTerminalConfig（类型）、
// src/main/index.ts:1084（openTerminals 实际持久化形状 = {cwd, customName?}）。
//
// 偏差记录（以 legacy 实况 + spec oracle 为准）：
//   ① theme/terminal.themeName 默认：legacy config.ts DEFAULT_CONFIG='light'，但冻结 spec
//      oracle（TERM_L1_10/16）与 legacy defaults.ts='dark' 均为 'dark'——取 'dark'。
//   ② openTerminals 元素：任务简报述及 {id,cwd,customName?}，但 legacy 持久化实况（index.ts:1084）
//      与类型（config.types.ts:60 OpenTerminalConfig）均无 id，为 {cwd, customName?(, active?)}——
//      本实现取 legacy 亲验形状 {cwd, customName?}（APP_L1_01 只约束 openTerminals 为数组，不约束
//      元素形状；新架构稳定 UUID 是否入持久化留裁决，见报告）。
//   ③ ftvLeftWidth/ftvRightWidth：legacy 类型可选，但 APP_L1_01「返回完整结构」要求恒含此二键，
//      故取非可选 + 默认（250/300，legacy config.ts DEFAULT_CONFIG）。
//
// 容错语义（继承 legacy config.ts loadConfig）：文件缺失/损坏 → 全默认；部分字段缺失 → 与默认
// 浅合并（terminal 子字段深合并）。新配置由本入口原子全量写，部分配置仅可能来自跨版本旧文件。
import Foundation

/// app:get-config 返回的 Muxvo 本地配置（APP_L1_01 完整形状）。
public struct MuxvoConfig: Codable, Equatable, Sendable {
    public struct Window: Codable, Equatable, Sendable {
        public var width: Int
        public var height: Int
        public var x: Int
        public var y: Int
        public init(width: Int = 1400, height: Int = 900, x: Int = 100, y: Int = 100) {
            self.width = width
            self.height = height
            self.x = x
            self.y = y
        }
    }

    /// 终端持久化项（legacy 实况 index.ts:1084 = {cwd, customName?}）。
    /// M4b【T-3】增稳定 `id`（= 运行时终端 SessionID，落盘作会话恢复 join 键，terminal-session-restore.md
    /// §2/§3）：与 `terminal-active-sessions.json`（同以运行时 termId 为键）在崩溃→重启周期内一致 join。
    /// 旧 config 无 id → nil（向后兼容，恢复层 best-effort cwd+序匹配退化）。
    public struct OpenTerminal: Codable, Equatable, Sendable {
        public var id: String?
        public var cwd: String
        public var customName: String?
        /// 收起态跨重启（term-grid.md §11）：nil/缺席 = 未收起（旧 config 兼容）；写回时未收起省略（不膨胀）。
        public var minimized: Bool?
        /// 收起终端的会话尺寸快照（§11.4 尺寸门第 1 层，对抗回修 MINOR-1）：仅收起项写回；重启恢复为
        /// 收起态时立即 resize 到此值（注入器直接过门，覆盖全收起重启的持久无源场景）。缺席 = 走心跳拷贝兜底。
        public var cols: Int?
        public var rows: Int?
        public init(
            id: String? = nil, cwd: String, customName: String? = nil, minimized: Bool? = nil,
            cols: Int? = nil, rows: Int? = nil
        ) {
            self.id = id
            self.cwd = cwd
            self.customName = customName
            self.minimized = minimized
            self.cols = cols
            self.rows = rows
        }
    }

    public struct GridLayout: Codable, Equatable, Sendable {
        public var columnRatios: [Double]
        public var rowRatios: [Double]
        public init(columnRatios: [Double] = [1, 1], rowRatios: [Double] = [1, 1]) {
            self.columnRatios = columnRatios
            self.rowRatios = rowRatios
        }
    }

    /// 窗口几何（multi-window.md §4.1，schema v2）：屏坐标 origin(x,y) + 尺寸(width,height)，Double。
    /// WindowManager 自管落盘（§4.4 窗 move/resize 去抖写回）；顶层 legacy `window`（Int）为首窗镜像降级。
    public struct Frame: Codable, Equatable, Sendable {
        public var x: Double
        public var y: Double
        public var width: Double
        public var height: Double
        public init(x: Double, y: Double, width: Double, height: Double) {
            self.x = x
            self.y = y
            self.width = width
            self.height = height
        }
    }

    /// 单窗持久化分组（multi-window.md §4.1，schema v2）：稳定 windowId + 固定编号 + 窗几何 + 本窗终端分组
    /// + 本窗网格比（裁决⑪每窗独立）。OpenTerminal 复用现结构（批A minimized/cols/rows 自动随迁）。
    public struct WindowEntry: Codable, Equatable, Sendable {
        /// 稳定窗 id（生成即固定，不因关窗重排；§4.1/§6.3 编号规则的载体）。
        public var windowId: String
        /// 窗口编号（§6.3 固定编号：首窗 1、后续 2/3…，关窗不重排）。缺席 → 装配层按建窗序兜底。
        public var number: Int?
        /// 窗几何（§4.4 WindowManager 自管）。缺席 → 级联默认 / 首窗一次性迁移旧 autosave 键兜底。
        public var frame: Frame?
        /// 本窗终端分组（§2.1 会话本体不绑窗，此为持久化归属面）。
        public var openTerminals: [OpenTerminal]
        /// 本窗网格列/行比（裁决⑪每窗独立）。缺席 → 默认。
        public var gridLayout: GridLayout?
        public init(
            windowId: String, number: Int? = nil, frame: Frame? = nil,
            openTerminals: [OpenTerminal] = [], gridLayout: GridLayout? = nil
        ) {
            self.windowId = windowId
            self.number = number
            self.frame = frame
            self.openTerminals = openTerminals
            self.gridLayout = gridLayout
        }
    }

    /// 终端子配置（4 键：themeName/fontSize/cursorStyle/cursorBlink，承接 TERM_L1_16-19）。
    /// cursorStyle 存 legacy JSON 字符串（'block' 等）；默认值 = spec §4.4（与
    /// MuxvoTermCore.TermDefaults 同源、等值，两模块无依赖故各自落字面量）。
    public struct TerminalSettings: Codable, Equatable, Sendable {
        public var themeName: String
        public var fontSize: Int
        public var cursorStyle: String
        public var cursorBlink: Bool
        public init(
            themeName: String = "dark", fontSize: Int = 14,
            cursorStyle: String = "block", cursorBlink: Bool = true
        ) {
            self.themeName = themeName
            self.fontSize = fontSize
            self.cursorStyle = cursorStyle
            self.cursorBlink = cursorBlink
        }

        /// 部分字段缺失 → 与默认深合并（legacy config.ts:90 deep merge terminal）。
        public init(from decoder: Decoder) throws {
            let d = TerminalSettings()
            let c = try decoder.container(keyedBy: CodingKeys.self)
            themeName = try c.decodeIfPresent(String.self, forKey: .themeName) ?? d.themeName
            fontSize = try c.decodeIfPresent(Int.self, forKey: .fontSize) ?? d.fontSize
            cursorStyle = try c.decodeIfPresent(String.self, forKey: .cursorStyle) ?? d.cursorStyle
            cursorBlink = try c.decodeIfPresent(Bool.self, forKey: .cursorBlink) ?? d.cursorBlink
        }
    }

    public var window: Window
    public var openTerminals: [OpenTerminal]
    public var gridLayout: GridLayout
    // 多窗持久化（multi-window.md §4，schema v2）：每窗一分组（windowId/number/frame/openTerminals/gridLayout）。
    // 缺席（旧扁平 config）→ 空数组，迁移在装配层做（WindowManager.windowsForRestore 合成单窗，§4.2）。
    // 顶层 window/openTerminals/gridLayout 保留作**首窗镜像**（§4.3 双写降级，旧读者回滚仍能恢复首窗）。
    public var windows: [WindowEntry]
    public var ftvLeftWidth: Double
    public var ftvRightWidth: Double
    public var theme: String
    public var fontSize: Int
    public var terminal: TerminalSettings
    public var startupTerminalCount: Int
    // M6 批1（settings-modal.md §0）：设置弹窗五 section 的偏好字段。默认值以裁决书为准
    // （m6-batch0-adjudication.md）：dockBadgeMode 'realtime' / dockBadgeIntervalMin 1（非 5）/
    // language 'zh'（as-built，"跟随系统" 未实现属产品裁决）。缺席回默认，旧 config.json 兼容零风险。
    public var dockBadgeMode: String
    public var dockBadgeIntervalMin: Int
    public var defaultTerminalCwd: String
    public var doubleClickToFocus: Bool
    public var showHiddenFiles: Bool
    public var language: String
    // M5-R1 批2（聊天自动归档开关）：缺席 → 默认开（decodeIfPresent ?? true）。config.request
    // 的 archiveEnabled 双向映射经此字段；warmup 跳扫等行为门控归批2 C。
    public var chatArchiveEnabled: Bool
    // dogfood-r3 问题5（⌘+/-/0 面板缩放）：web 全页面板 CSS zoom 因子，1.0=原始。缺席回 1.0
    //（旧 config.json 兼容零风险，照 ftvLeftWidth 先例）。终端字号另走 terminal.fontSize，两者独立。
    public var panelZoom: Double
    // 右上角批 B2（welcome-overlay.md/tour-overlay.md）：新手引导是否已完成/跳过（legacy prefs
    // tourCompleted 对等）。缺席回 false = 首启弹欢迎卡（旧 config.json 兼容零风险）。
    public var tourCompleted: Bool

    /// 自动更新去打扰（auto-update.md §0；legacy prefs updateDismissal{version,count} 对等）。
    /// count=999 = 该版本永久静默。nil/缺席 = 从未推迟（旧 config 兼容零风险）。
    public struct UpdateDismissalRecord: Codable, Equatable, Sendable {
        public var version: String
        public var count: Int
        public init(version: String, count: Int) {
            self.version = version
            self.count = count
        }
    }
    public var updateDismissal: UpdateDismissalRecord?
    /// What's New 门控（auto-update.md §7；legacy prefs lastSeenVersion 对等）。nil = 首装未记录。
    public var lastSeenVersion: String?
    // hook 首启自动启用批（wait-detector.md §7）：两字段均 internal-only，不进 ConfigSnapshot/
    // PrefsPatch（updateDismissal 先例）。缺席回 false（旧 config.json 兼容零风险）。
    /// 用户主动停用终端等待检测（仅设置页「停用」按钮置 true；任一次成功 install() 置回 false）。
    /// true = 首启自动装配门永久关（§7 opt-out 条款）。
    public var hookUserDisabled: Bool
    /// 首启自动启用一次性轻提示待展示位：自动装成功置 true，web 查询（hookAutoEnableNotice）即消费清
    /// false（WhatsNewGate「查询即写回」先例）。
    public var hookAutoEnabledNoticePending: Bool
    /// M7 批3（legacy-migration.md §7.2）：老版聊天归档首启迁移提示「已展示」一次性闩。迁移在后台
    /// warmup 落 marker（copied>0）后，下次启动读 marker 命中 → 首个 web 查询（legacyMigrationNotice）
    /// 展示底部 toast 并置本闩 true，此后永不再提示。internal-only（同 hook 两字段，不进 ConfigSnapshot）。
    public var legacyChatMigrationNoticeShown: Bool

    public init(
        window: Window = Window(),
        openTerminals: [OpenTerminal] = [],
        gridLayout: GridLayout = GridLayout(),
        windows: [WindowEntry] = [],
        ftvLeftWidth: Double = 250,
        ftvRightWidth: Double = 300,
        theme: String = "dark",
        fontSize: Int = 14,
        terminal: TerminalSettings = TerminalSettings(),
        startupTerminalCount: Int = 1,
        dockBadgeMode: String = "realtime",
        dockBadgeIntervalMin: Int = 1,
        defaultTerminalCwd: String = "",
        doubleClickToFocus: Bool = false,
        showHiddenFiles: Bool = false,
        language: String = "zh",
        chatArchiveEnabled: Bool = true,
        panelZoom: Double = 1.0,
        updateDismissal: UpdateDismissalRecord? = nil,
        lastSeenVersion: String? = nil,
        tourCompleted: Bool = false,
        hookUserDisabled: Bool = false,
        hookAutoEnabledNoticePending: Bool = false,
        legacyChatMigrationNoticeShown: Bool = false
    ) {
        self.window = window
        self.openTerminals = openTerminals
        self.gridLayout = gridLayout
        self.windows = windows
        self.ftvLeftWidth = ftvLeftWidth
        self.ftvRightWidth = ftvRightWidth
        self.theme = theme
        self.fontSize = fontSize
        self.terminal = terminal
        self.startupTerminalCount = startupTerminalCount
        self.dockBadgeMode = dockBadgeMode
        self.dockBadgeIntervalMin = dockBadgeIntervalMin
        self.defaultTerminalCwd = defaultTerminalCwd
        self.doubleClickToFocus = doubleClickToFocus
        self.showHiddenFiles = showHiddenFiles
        self.language = language
        self.chatArchiveEnabled = chatArchiveEnabled
        self.panelZoom = panelZoom
        self.updateDismissal = updateDismissal
        self.lastSeenVersion = lastSeenVersion
        self.tourCompleted = tourCompleted
        self.hookUserDisabled = hookUserDisabled
        self.hookAutoEnabledNoticePending = hookAutoEnabledNoticePending
        self.legacyChatMigrationNoticeShown = legacyChatMigrationNoticeShown
    }

    /// 顶层部分字段缺失 → 与默认浅合并（legacy config.ts:88 `{...DEFAULT, ...parsed}`）；
    /// terminal 子字段深合并由 TerminalSettings.init(from:) 保证。整体键存在但类型错 → 抛（由
    /// ConfigStore.load 的 try? 收敛为全默认，即「损坏回默认」）。
    public init(from decoder: Decoder) throws {
        let d = MuxvoConfig()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        window = try c.decodeIfPresent(Window.self, forKey: .window) ?? d.window
        openTerminals = try c.decodeIfPresent([OpenTerminal].self, forKey: .openTerminals) ?? d.openTerminals
        gridLayout = try c.decodeIfPresent(GridLayout.self, forKey: .gridLayout) ?? d.gridLayout
        // schema v2：缺席（旧扁平 config）→ 空（迁移在装配层做，§4.2）；present → 逐 entry 容错解码。
        windows = try c.decodeIfPresent([WindowEntry].self, forKey: .windows) ?? d.windows
        ftvLeftWidth = try c.decodeIfPresent(Double.self, forKey: .ftvLeftWidth) ?? d.ftvLeftWidth
        ftvRightWidth = try c.decodeIfPresent(Double.self, forKey: .ftvRightWidth) ?? d.ftvRightWidth
        theme = try c.decodeIfPresent(String.self, forKey: .theme) ?? d.theme
        fontSize = try c.decodeIfPresent(Int.self, forKey: .fontSize) ?? d.fontSize
        terminal = try c.decodeIfPresent(TerminalSettings.self, forKey: .terminal) ?? d.terminal
        startupTerminalCount =
            try c.decodeIfPresent(Int.self, forKey: .startupTerminalCount) ?? d.startupTerminalCount
        dockBadgeMode = try c.decodeIfPresent(String.self, forKey: .dockBadgeMode) ?? d.dockBadgeMode
        dockBadgeIntervalMin =
            try c.decodeIfPresent(Int.self, forKey: .dockBadgeIntervalMin) ?? d.dockBadgeIntervalMin
        defaultTerminalCwd =
            try c.decodeIfPresent(String.self, forKey: .defaultTerminalCwd) ?? d.defaultTerminalCwd
        doubleClickToFocus =
            try c.decodeIfPresent(Bool.self, forKey: .doubleClickToFocus) ?? d.doubleClickToFocus
        showHiddenFiles = try c.decodeIfPresent(Bool.self, forKey: .showHiddenFiles) ?? d.showHiddenFiles
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? d.language
        chatArchiveEnabled =
            try c.decodeIfPresent(Bool.self, forKey: .chatArchiveEnabled) ?? d.chatArchiveEnabled
        panelZoom = try c.decodeIfPresent(Double.self, forKey: .panelZoom) ?? d.panelZoom
        updateDismissal = try c.decodeIfPresent(UpdateDismissalRecord.self, forKey: .updateDismissal)
        lastSeenVersion = try c.decodeIfPresent(String.self, forKey: .lastSeenVersion)
        tourCompleted = try c.decodeIfPresent(Bool.self, forKey: .tourCompleted) ?? d.tourCompleted
        hookUserDisabled =
            try c.decodeIfPresent(Bool.self, forKey: .hookUserDisabled) ?? d.hookUserDisabled
        hookAutoEnabledNoticePending =
            try c.decodeIfPresent(Bool.self, forKey: .hookAutoEnabledNoticePending)
            ?? d.hookAutoEnabledNoticePending
        legacyChatMigrationNoticeShown =
            try c.decodeIfPresent(Bool.self, forKey: .legacyChatMigrationNoticeShown)
            ?? d.legacyChatMigrationNoticeShown
    }

    // MARK: schema v2 迁移 / 首窗镜像（multi-window.md §4.2/§4.3，纯函数供装配层与单测共用）

    /// 恢复用窗分组（§4.2）：`windows` 非空 → 原样；空（旧扁平 config）→ **合成单窗**（firstWindowId +
    /// number 1 + 顶层 openTerminals/gridLayout 全落首窗 entry，零丢失）。frame 留 nil——顶层 legacy
    /// `window` 从不由本 app 落盘（真几何历来在 NSWindow autosave），故不据其合成；首窗真几何由装配层
    /// 一次性迁移旧 autosave 键补（§4.4）。
    public func windowsForRestore(firstWindowId: String) -> [WindowEntry] {
        if !windows.isEmpty { return windows }
        return [WindowEntry(
            windowId: firstWindowId, number: 1, frame: nil,
            openTerminals: openTerminals, gridLayout: gridLayout)]
    }

    /// 首窗镜像回顶层（§4.3 双写降级）：把 windows[0] 的 openTerminals/gridLayout/frame 镜像回顶层
    /// openTerminals/gridLayout/window——旧读者（回滚单窗构建）仍能读到一套可用首窗状态。windows 空 → no-op。
    public mutating func mirrorFirstWindowToTop() {
        guard let first = windows.first else { return }
        openTerminals = first.openTerminals
        if let g = first.gridLayout { gridLayout = g }
        if let f = first.frame {
            window = Window(
                width: Int(f.width.rounded()), height: Int(f.height.rounded()),
                x: Int(f.x.rounded()), y: Int(f.y.rounded()))
        }
    }

    /// 定位/新建某窗 entry 并施加变更（§4 写侧：按 windowId 定位，缺则以 number 兜底 append）。变更后自动
    /// 镜像首窗回顶层（§4.3）。装配层（WindowManager）与写侧（TerminalService.persist*）共用。
    public mutating func upsertWindowEntry(
        windowId: String, number: Int? = nil, _ mutate: (inout WindowEntry) -> Void
    ) {
        if let idx = windows.firstIndex(where: { $0.windowId == windowId }) {
            mutate(&windows[idx])
        } else {
            var entry = WindowEntry(windowId: windowId, number: number)
            mutate(&entry)
            windows.append(entry)
        }
        mirrorFirstWindowToTop()
    }
}

/// config.json 原子读写。缺失/损坏一律回默认（legacy 容错语义）；save 走 AtomicFile 原子落盘。
public struct ConfigStore {
    public static let configFileName = "config.json"

    public let fileURL: URL

    /// 直传 config.json 完整路径（测试在 $TMPDIR 下用此）。
    public init(configFileURL: URL) {
        fileURL = configFileURL
    }

    /// 由数据目录派生 <root>/config.json（正式路径；DataDirectory.root 为唯一权威根）。
    public init(dataDirectory: DataDirectory) {
        self.init(configFileURL: dataDirectory.root.appendingPathComponent(Self.configFileName))
    }

    /// 读配置。文件不存在或 JSON 损坏 → 全默认（不抛，legacy config.ts loadConfig catch→DEFAULT）。
    public func load() -> MuxvoConfig {
        guard let data = try? Data(contentsOf: fileURL),
              let config = try? JSONDecoder().decode(MuxvoConfig.self, from: data)
        else {
            return MuxvoConfig()
        }
        return config
    }

    /// 原子写 config.json（AtomicFile：tmp→fsync→rename→父目录 fsync）。durability=.standard
    /// （config 较 SCHEMA_VERSION 高频，非 cold-path 关键元数据）。
    public func save(_ config: MuxvoConfig) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        try AtomicFile.write(data, to: fileURL, durability: .standard)
    }
}
