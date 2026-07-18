// swift-tools-version: 6.0
// Muxvo 正式 app 包。M3 批 0 起接入 vendor libghostty-vt（Track B）与终端 5 target 骨架。
//
// - 构建一律走 scripts/app.sh（--scratch-path 指到 ~/Library/Caches/muxvo-build/，
//   构建产物不进坚果云同步盘；vendor/artifacts 符号链接由 app.sh 启动时检测/创建）。
// - vendor 链接沿用 probes/term-probe 已验证模式：CGhosttyVT 走普通 C target，
//   cSettings/-Xcc `-I <vendor>/include`；静态库用 `-Xlinker <vendor>/lib/libghostty-vt.a`
//   直喂绝对路径（避免 -l 选到同目录 dylib）+ `-lc++`（vt 内含 C++ highway）——
//   链接 flag 只挂在最终链接产物（MuxvoApp）上。SwiftPM 只禁「被依赖的包」用
//   unsafeFlags，muxvo-app 是 root，先例成立（既有 -sectcreate 已在用）。
// - Info.plist 用 -sectcreate 嵌进可执行文件（既有机制，不动）：swift run 直跑不做
//   .app bundle；GRDB .exact(7.8.0) pin 不动。
import PackageDescription
import Foundation

let pkgDir = Context.packageDirectory
let vendorInclude = "\(pkgDir)/vendor/artifacts/include"
let vendorLib = "\(pkgDir)/vendor/artifacts/lib"

// MUXVO_NO_VENDOR=1：vendor 资产不可用时的手动降级逃生舱（设计附件 A §1.3 C-lite）。
// 置位则剔除依赖 libghostty-vt 的三 target（CGhosttyVT/MuxvoTerm/MuxvoTermRender）及
// MuxvoApp 对渲染层的依赖与 vt 链接 flag；CMuxvoPTY/MuxvoTermCore 无 vendor 依赖保留。
// ⚠️ CI 不默认用此开关——CI 走方案 B 拉预构建产物覆盖全部 Swift 测试；此开关仅在
//    release 资产意外不可用时手动降级，避免 CI 长红阻塞 push main。
let noVendor = ProcessInfo.processInfo.environment["MUXVO_NO_VENDOR"] == "1"

// MuxvoApp 现只依赖 MuxvoAppCore（复合窗口/服务/VC 全在库里，M3 dogfood②-C 为 e2e harness
// 可复用而抽出）；MuxvoApp/MuxvoAppCore 均需 vendor 渲染栈，一并入 vendorTargets（逃生舱剔除）。
let appDeps: [Target.Dependency] = ["MuxvoAppCore"]

let appLinkerSettings: [LinkerSetting] = [
    .linkedFramework("AppKit"),
    .linkedFramework("WebKit"),
    .unsafeFlags([
        "-Xlinker", "-sectcreate",
        "-Xlinker", "__TEXT",
        "-Xlinker", "__info_plist",
        "-Xlinker", "\(pkgDir)/Sources/MuxvoApp/Resources/Info.plist",
    ]),
] + (noVendor ? [] : [
    // vt 静态库直喂绝对路径（避免 -l 选到 dylib）；highway C++ 需 -lc++。
    // -force_load 保证整库确被链入最终产物——骨架期 MuxvoApp 尚未调用会话 API，
    // 无此则链接器惰性丢弃未引用的归档成员，vt 链接冒烟形同虚设（批 1 起 MuxvoApp
    // 真实调用会话核心后可回退为惰性链接以瘦身）。
    .unsafeFlags([
        "-Xlinker", "-force_load",
        "-Xlinker", "\(vendorLib)/libghostty-vt.a",
        "-lc++",
    ]),
])

// 依赖 libghostty-vt 的终端 target——逃生舱置位时整体剔除。
let vendorTargets: [Target] = noVendor ? [] : [
    // C 伞头：转发 vendor <ghostty/vt.h>，-I 指 vendor include（平移探针方案）
    .target(
        name: "CGhosttyVT",
        cSettings: [.unsafeFlags(["-I", vendorInclude])]
    ),
    // 会话核心：依赖 MuxvoKit + MuxvoTermCore + CGhosttyVT + CMuxvoPTY；
    // Swift 侧 import CGhosttyVT 编 clang module 需 -Xcc -I<vendorInclude>
    .target(
        name: "MuxvoTerm",
        dependencies: ["MuxvoKit", "MuxvoTermCore", "CGhosttyVT", "CMuxvoPTY"],
        swiftSettings: [.unsafeFlags(["-Xcc", "-I\(vendorInclude)"])]
    ),
    // Metal 渲染层：依赖 MuxvoTerm + MuxvoKit，链渲染框架；输入链（批3③）直调
    // ghostty key encoder/paste/focus C API，故加 CGhosttyVT
    .target(
        name: "MuxvoTermRender",
        dependencies: ["MuxvoTerm", "MuxvoTermCore", "MuxvoKit", "CGhosttyVT"],
        swiftSettings: [.unsafeFlags(["-Xcc", "-I\(vendorInclude)"])],
        linkerSettings: [
            .linkedFramework("Metal"),
            .linkedFramework("MetalKit"),
            .linkedFramework("CoreText"),
            .linkedFramework("QuartzCore"),
            .linkedFramework("AppKit"),
        ]
    ),
    // 会话核心测试（真 PTY 集成 + 隔离模式）：测试 bundle 是最终链接产物，需挂 vt 静态库
    .testTarget(
        name: "MuxvoTermTests",
        dependencies: ["MuxvoTerm", "MuxvoBridge", "MuxvoTestSupport"],
        swiftSettings: [.unsafeFlags(["-Xcc", "-I\(vendorInclude)"])],
        linkerSettings: [
            .unsafeFlags(["-Xlinker", "\(vendorLib)/libghostty-vt.a", "-lc++"])
        ]
    ),
    // 渲染层测试（GlyphCache 多页 LRU/FontConfig/Theme——LRU/packing 纯逻辑层无 GPU 可测；
    // 触 Metal 纹理的用例须守 MTLCreateSystemDefaultDevice()==nil 即跳过，CI VM 无 GPU）
    .testTarget(
        name: "MuxvoTermRenderTests",
        dependencies: ["MuxvoTermRender", "MuxvoTerm", "MuxvoTestSupport", "CGhosttyVT"],
        swiftSettings: [.unsafeFlags(["-Xcc", "-I\(vendorInclude)"])],
        linkerSettings: [
            .unsafeFlags(["-Xlinker", "\(vendorLib)/libghostty-vt.a", "-lc++"]),
            .linkedFramework("Metal"),
            .linkedFramework("MetalKit"),
            .linkedFramework("CoreText"),
        ]
    ),
    // bench_input_to_pixel 宿主（批 4①，terminal-rendering.md §8）：最小 AppKit app 真窗口，
    // 起 80×24 TerminalSurfaceView + 真 PTY /bin/cat，程序化注键测「注键→像素」全链路。
    // 走产品渲染路径（会话 queue→快照→encode→present），故链 vt 静态库（比照 MuxvoApp）。
    .executableTarget(
        name: "muxvo-term-bench",
        dependencies: ["MuxvoTerm", "MuxvoTermRender", "MuxvoKit", "CGhosttyVT"],
        swiftSettings: [.unsafeFlags(["-Xcc", "-I\(vendorInclude)"])],
        linkerSettings: [
            .linkedFramework("AppKit"),
            .linkedFramework("Metal"),
            .linkedFramework("MetalKit"),
            .unsafeFlags(["-Xlinker", "\(vendorLib)/libghostty-vt.a", "-lc++"]),
        ]
    ),
    // 终端 golden 生成器（批 4①，terminal-rendering.md §6）：@testable 摸 TerminalRenderer.renderOffscreen
    // 同 encode 路径渲固定 fixture → PNG+sha 落 tools/term-golden/。MUXVO_TERM_GOLDEN=1 门控——
    // 未置位/无 GPU 时用例早退（trivial pass），不污染常规 app.sh test，不进 CI。
    .testTarget(
        name: "MuxvoTermGoldenTests",
        dependencies: ["MuxvoTermRender", "MuxvoTerm", "MuxvoTestSupport", "CGhosttyVT"],
        swiftSettings: [.unsafeFlags(["-Xcc", "-I\(vendorInclude)"])],
        linkerSettings: [
            .unsafeFlags(["-Xlinker", "\(vendorLib)/libghostty-vt.a", "-lc++"]),
            .linkedFramework("Metal"),
            .linkedFramework("MetalKit"),
            .linkedFramework("CoreText"),
        ]
    ),
    // 复合 UI 库（M3 dogfood②-C 抽出）：CompositeRoot/Panel/HoleStore/Host/TerminalService/
    // AppDelegate 等原从 MuxvoApp 可执行迁入，令 e2e harness 可执行也能装配同一套真产品类。
    // 依赖 MuxvoTermRender（渲染栈），故属 vendorTargets。
    .target(
        name: "MuxvoAppCore",
        dependencies: [
            "MuxvoKit", "MuxvoBridge", "MuxvoStorage", "MuxvoDatabase",
            "MuxvoTerm", "MuxvoTermRender",
            "MuxvoConfigCenter", // M6 批1：config.request 资源/MCP/plugins 处理器数据面
            "MuxvoAuth", // B5：AuthRequestRouter → AuthManager（app.request auth 变体）
            "MuxvoChatHistory", // M5 批3：chat.request ChatAssembly（ChatStore 查询面 + Codex memo + 镜像）
            "MuxvoTranscript", // 共享 JSONL 库（chat 数据面用，非编排专属）
            .product(name: "GRDB", package: "GRDB.swift"), // 恢复横幅 needsConfirm 直读（interruptions≥3）
            "MuxvoUpdater", // 自动更新装配（SparkleEngine/NSAlert prompter/dock 进度，auto-update.md）
            .product(name: "Sparkle", package: "Sparkle"),
            "MuxvoAnalytics", // 埋点批2：AnalyticsAssembly（tracker 装配 + 桥 telemetry 落点，analytics.md）
            "MuxvoPerf", // M7 批4：内存监控装配（MemoryAssembly，真采样/时钟 + memoryWarning 广播）
        ]
    ),
    // 复合 UI 库测试（DOGFOOD_M3_05 起）：AppMenuCommands（字号缩放菜单）+ TerminalService（zoom 两路
    // 归一 + 持久化）等原产品类的单测。测试 bundle 是最终链接产物，须挂 vt 静态库 + 渲染/Web 框架
    // （比照 MuxvoTermRenderTests）。
    .testTarget(
        name: "MuxvoAppCoreTests",
        dependencies: [
            "MuxvoAppCore", "MuxvoTerm", "MuxvoTermRender", "MuxvoBridge",
            "MuxvoStorage", "MuxvoKit", "MuxvoTestSupport",
            "MuxvoConfigCenter", // M6 批1：config.request 处理器测（ConfigCenter 构造）
            "MuxvoChatHistory", "MuxvoTranscript", // M5 批3：ChatAssembly/ChatWire 直测（fixture + JSONValue）
            "MuxvoDatabase",
            .product(name: "GRDB", package: "GRDB.swift"),
            "MuxvoPerf", // M7 批4：MemoryAssembly.dataEvent(for:) 译码断言（APP_L1_05）
        ],
        swiftSettings: [.unsafeFlags(["-Xcc", "-I\(vendorInclude)"])],
        linkerSettings: [
            .unsafeFlags(["-Xlinker", "\(vendorLib)/libghostty-vt.a", "-lc++"]),
            .linkedFramework("Metal"),
            .linkedFramework("MetalKit"),
            .linkedFramework("CoreText"),
            .linkedFramework("AppKit"),
            .linkedFramework("WebKit"),
        ]
    ),
    // 正式 app 可执行：只余 main.swift + Resources/Info.plist，装配全在 MuxvoAppCore。
    .executableTarget(
        name: "MuxvoApp",
        dependencies: appDeps,
        exclude: ["Resources"],
        linkerSettings: appLinkerSettings
    ),
]

let package = Package(
    name: "muxvo-app",
    platforms: [.macOS(.v14)],
    dependencies: [
        // .exact 锁死消除漂移；升级 = 改这一行 + Package.resolved，git 可审。
        // 7.8.0 = 兼容 Swift 6.0.3 工具链的最新版（7.9.0 起要求 swift-tools 6.1 / Xcode 16.3+）
        .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.8.0"),
        // 自动更新引擎（J1 裁决 2026-07-13：MIT 全树零 copyleft）。
        // 形态=自定义 SPUUserDriver 全接管、标准 UI 零出场（SparkleEngine.swift）；binaryTarget XCFramework。
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.6.4"),
    ],
    targets: [
        // 跨模块接缝（极小）：ShutdownCoordinating / TerminalSurfaceProviding / SessionID
        .target(name: "MuxvoKit"),
        // 桥总线（BridgeBus + Gen/Protocol.swift），M1 任务 6 落地
        .target(name: "MuxvoBridge", dependencies: ["MuxvoKit"]),
        // 数据目录/原子写/锁/生命周期，M1 任务 3-4 落地
        .target(name: "MuxvoStorage", dependencies: ["MuxvoKit"]),
        // GRDB 引导（连接配置/migrator/checkpoint step），M1 任务 8 落地
        .target(
            name: "MuxvoDatabase",
            dependencies: [
                "MuxvoKit", "MuxvoStorage",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        // M5 批2 A2-3：双跑对照 dump 编码内核（chat-data.md §8.1/§8.2）——四类型 → legacy 字段名 JSON
        // + §5.4 聚合。纯逻辑无 I/O，抽库以供 MuxvoChatDumpKitTests 钉字段映射（legacy 字段名 / nil 省略 /
        // mtime floor）。依赖 MuxvoChatHistory 四类型 + MuxvoTranscript（JSONValue.toAny）。
        .target(
            name: "MuxvoChatDumpKit",
            dependencies: ["MuxvoChatHistory", "MuxvoTranscript"]
        ),
        // M5 批2 A2-3：双跑对照 dump 可执行——CC/Codex reader 输出四类型 legacy 字段名 JSON。
        // 消费 MuxvoChatHistory 四类型 + 纯函数（Extractor/Projector/Search/Merger）+ Codex 源 +
        // MuxvoChatDumpKit 编码；MuxvoTranscript 供信封解码（SessionJSONLDecoder/SessionRecord）；
        // MuxvoStorage 数据根；GRDB 为 A2-1 ChatStore/chat.db 落地后接通预留。零 vendor / 零 UI。
        // CC fs 薄壳（CCFileSource）批2 内为临时实现（驱动同一批纯函数），批末换正式 ChatStore。
        .executableTarget(
            name: "muxvo-chat-dump",
            dependencies: [
                "MuxvoChatDumpKit", "MuxvoChatHistory", "MuxvoTranscript", "MuxvoStorage",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        // 终端 vendor-free 地基（逃生舱也保留）：
        // CMuxvoPTY = PTY C 垫片（forkpty/TIOCSWINSZ，批 1 实装）；
        // MuxvoTermCore = 纯 Swift 状态机/Registry 策略/env 合同/默认配置（批 1 实装）。
        .target(name: "CMuxvoPTY"),
        .target(name: "MuxvoTermCore"),
        // M4a 批0：CC/Codex stream-json 行解析纯函数库（M5 聊天数据面共用）。
        // 零 vendor / 零 GRDB / 零 UI，仅 Foundation——独立 target，逃生舱下也编译。
        .target(name: "MuxvoTranscript"),
        // M5 聊天数据面：发现/投影/搜索纯函数层 + chat.db（chat-data.md v1-frozen）。
        // 依赖 MuxvoTranscript（SessionRecord/SessionJSONLDecoder 信封解码）+ GRDB（chat.db）
        // + MuxvoStorage（数据根/原子写/镜像）。零 vendor / 零 UI，逃生舱下也编译。
        .target(
            name: "MuxvoChatHistory",
            dependencies: [
                "MuxvoTranscript", "MuxvoStorage",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        // M6 批1：配置面数据中枢（skills 扫描 / 资源读写白名单 / settings.json / MCP 4 源解析含 codex
        // 手写 TOML 子集 / plugins 装配 / ~/.claude watcher）。零 vendor / 零 UI；依赖 MuxvoBridge（产出
        // Gen 视图类型 ResourceItem/McpServerView/PluginView/ConfigDirEntry——数据契约即桥类型，仿
        // UIStateProjection 由装配层映射的模式此处直用）+ MuxvoStorage（AtomicFile 原子写）。
        .target(name: "MuxvoConfigCenter", dependencies: ["MuxvoBridge", "MuxvoStorage"]),
        // 右上角批 B5：muxvo 账号登录（login-modal.md / bridge-v1.md §8 AUTH）——AuthManager 状态机 +
        // 后端 client（api.muxvo.com，MUXVO_API_URL 可覆盖）+ token 明文 0600 原子存储（legacy 语义）。
        // 零 vendor / 零 UI；transport 协议注入（测试假体永不打真网）。仅依赖 MuxvoKit（token 路径外部注入）。
        .target(name: "MuxvoAuth", dependencies: ["MuxvoKit"]),
        // 埋点批1（analytics.md）：tracker（批量/心跳/启用门）+ client（api.muxvo.com，仿 MuxvoAuth）
        // + device-id（AtomicFile 持久）。零 vendor / 零 UI；transport/clock 协议注入（测试永不打真网）。
        .target(name: "MuxvoAnalytics", dependencies: ["MuxvoKit", "MuxvoStorage"]),
        // 埋点批1：Tracker/Client/DeviceID/Gate 直测（假 transport + 手动时钟，只碰 $TMPDIR）。
        .testTarget(
            name: "MuxvoAnalyticsTests",
            dependencies: ["MuxvoAnalytics", "MuxvoTestSupport"]
        ),
        // B5：AuthManager/BackendClient/TokenStore 直测（假 transport 全流，只碰 $TMPDIR）。
        .testTarget(
            name: "MuxvoAuthTests",
            dependencies: ["MuxvoAuth", "MuxvoTestSupport"]
        ),
        // 注：MuxvoApp 可执行 + MuxvoAppCore 库均依赖 vendor 渲染栈，
        // 定义在 vendorTargets（逃生舱 MUXVO_NO_VENDOR=1 时整体剔除）。
        // 测试共用支撑（withTempRoot 等）：所有测试只碰 $TMPDIR 下的独立临时目录。
        // SwiftPM 不允许普通 target 路径在 Tests/ 下，故放 Sources/（仅测试 target 依赖它）
        .target(name: "MuxvoTestSupport"),
        // 软件自动更新纯逻辑核（auto-update.md）：状态机/去打扰/changelog 解析/update.log，
        // 纯 Foundation 零 AppKit 零 vendor（单测免链 libghostty，秒级）；引擎(Sparkle)/弹窗(NSAlert)/
        // dock 进度等生产实现经接缝注入，落 MuxvoAppCore 装配。
        .target(name: "MuxvoUpdater"),
        // UPD_* 案例池主载体（auto-update.md §12；INSTALL_L2_01/15 spec-runner 归属）。
        .testTarget(
            name: "MuxvoUpdaterTests",
            dependencies: ["MuxvoUpdater", "MuxvoTestSupport"]
        ),
        // M7 批4 内存监控与错误口径纯核（内存监控/错误码/三级分类/数据保留）：纯 Foundation 零
        // AppKit 零 vendor（单测秒级免链 libghostty）；采样/推送/时钟生产实现经接缝注入落 MuxvoAppCore。
        .target(name: "MuxvoPerf"),
        // 批4 spec-runner 归属主载体：PERF_L1_01/L1_02/L2_01/L2_02 + ERROR_L1_02/03 + APP_L2_01。
        .testTarget(
            name: "MuxvoPerfTests",
            dependencies: ["MuxvoPerf"]
        ),
        .testTarget(name: "MuxvoBridgeTests", dependencies: ["MuxvoBridge"]),
        // M6 批1：ConfigCenter 直测（CONFIG_L1_01/02/03/04/08 + MCP/plugins/codex-TOML 非 spec 锁行为，
        // 只碰 $TMPDIR fixture 根，绝不触真实 ~/.claude）。
        .testTarget(
            name: "MuxvoConfigCenterTests",
            dependencies: ["MuxvoConfigCenter", "MuxvoBridge", "MuxvoStorage", "MuxvoTestSupport"]
        ),
        // 终端 vendor-free 地基测试（状态机/Registry 策略/默认值，逃生舱下也可跑）
        .testTarget(
            name: "MuxvoTermCoreTests",
            dependencies: ["MuxvoTermCore", "MuxvoTestSupport"]
        ),
        // M4a 批0：JT_* 案例表（stream-json 解析纪律 + Codex mapper + 文件 tail 轮转）
        // + 批1 M5：SR_/SC_ 案例（SessionRecord 解码 / scanCold 实装 / 脱敏样本回放）。
        .testTarget(
            name: "MuxvoTranscriptTests",
            dependencies: ["MuxvoTranscript", "MuxvoTestSupport"]
        ),
        // M5 批1：MuxvoChatHistory 投影/搜索纯函数层的 CD_* 案例池（chat-data.md §7）。
        // A1-1 只留骨架冒烟可编译；A1-2/A1-3 填投影/搜索/双跑 case。
        .testTarget(
            name: "MuxvoChatHistoryTests",
            dependencies: [
                "MuxvoChatHistory", "MuxvoTranscript", "MuxvoStorage", "MuxvoTestSupport",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
        // M5 批2 A2-3：dump 字段映射单测（legacy 字段名逐字 / nil 键省略 / mtime floor / content 形态）。
        .testTarget(
            name: "MuxvoChatDumpKitTests",
            dependencies: ["MuxvoChatDumpKit", "MuxvoChatHistory", "MuxvoTranscript"]
        ),
        // M7 批6：可执行 muxvo-chat-dump 参数解析（DumpArgs.parse 源推断/命令/严格拒未知 flag）
        // + 流式逐行读（FileLineReader CRLF/尾行/早停）。
        .testTarget(
            name: "MuxvoChatDumpTests",
            dependencies: ["muxvo-chat-dump"]
        ),
        .testTarget(
            name: "MuxvoStorageTests",
            dependencies: ["MuxvoStorage", "MuxvoTestSupport"]
        ),
        .testTarget(
            name: "MuxvoDatabaseTests",
            dependencies: [
                "MuxvoDatabase", "MuxvoStorage", "MuxvoTestSupport",
                .product(name: "GRDB", package: "GRDB.swift"),
            ]
        ),
    ] + vendorTargets
)
