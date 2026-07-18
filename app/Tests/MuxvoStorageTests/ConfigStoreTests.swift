import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

@Suite("ConfigStore（config.json 完整形状 + 原子读写；APP_L1_01/02，只碰 $TMPDIR）")
struct ConfigStoreTests {
    @Test("APP_L1_01: get-config 返回完整 config 结构 —— round-trip JSON 含全部键")
    func app_l1_01_fullShape() throws {
        let config = MuxvoConfig() // 默认配置
        let data = try JSONEncoder().encode(config)
        let json = try #require(
            try JSONSerialization.jsonObject(with: data) as? [String: Any])

        // APP_L1_01 expectedResponse 的 7 个顶层键
        for key in ["window", "openTerminals", "gridLayout", "ftvLeftWidth", "ftvRightWidth", "theme", "fontSize"] {
            #expect(json[key] != nil, "缺顶层键 \(key)")
        }
        // window 子形状 {width,height,x,y}
        let window = try #require(json["window"] as? [String: Any])
        for k in ["width", "height", "x", "y"] { #expect(window[k] != nil, "window 缺 \(k)") }
        // gridLayout {columnRatios, rowRatios}
        let grid = try #require(json["gridLayout"] as? [String: Any])
        #expect(grid["columnRatios"] != nil)
        #expect(grid["rowRatios"] != nil)
        // openTerminals 是数组
        #expect(json["openTerminals"] as? [Any] != nil)
        // terminal 子 4 键 + startupTerminalCount（TERM_L1_16-19 / SETTINGS_L1_01 形状）
        let terminal = try #require(json["terminal"] as? [String: Any])
        for k in ["themeName", "fontSize", "cursorStyle", "cursorBlink"] {
            #expect(terminal[k] != nil, "terminal 缺 \(k)")
        }
        #expect(json["startupTerminalCount"] != nil)
        #expect(json["showHiddenFiles"] != nil) // M6 批A：文件面板隐藏文件开关顶层持久

        // 无损再解码回同一值
        let decoded = try JSONDecoder().decode(MuxvoConfig.self, from: data)
        #expect(decoded == config)
    }

    @Test("APP_L1_02: save-config 原子落盘 config.json + 无损重读（无 tmp 残留）")
    func app_l1_02_atomicSaveReload() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            let store = ConfigStore(configFileURL: fileURL)

            var config = MuxvoConfig()
            config.window = .init(width: 1600, height: 1000, x: 42, y: 7)
            config.openTerminals = [
                .init(cwd: "/tmp/a"),
                .init(cwd: "/tmp/b", customName: "build"),
            ]
            config.fontSize = 16
            config.startupTerminalCount = 3

            try store.save(config)

            // 落盘 + AtomicFile rename 后无 .tmp.* 残留
            #expect(FileManager.default.fileExists(atPath: fileURL.path))
            let siblings = try FileManager.default.contentsOfDirectory(atPath: root.path)
            #expect(siblings.contains("config.json"))
            #expect(siblings.allSatisfy { !$0.contains(".tmp.") }, "残留 tmp：\(siblings)")

            // 无损重读（含 openTerminals 元素 customName 可选项）
            let reloaded = ConfigStore(configFileURL: fileURL).load()
            #expect(reloaded == config)
        }
    }

    @Test("默认配置值对齐 spec §4.4（守 MuxvoConfig 默认与 TermDefaults 同源，防分叉假绿）")
    func defaultsMatchSpec() {
        let c = MuxvoConfig()
        #expect(c.theme == "dark") // TERM_L1_10（legacy config.ts 曾 'light'，spec oracle 取 'dark'）
        #expect(c.fontSize == 14) // TERM_L1_09
        #expect(c.terminal.themeName == "dark") // TERM_L1_16
        #expect(c.terminal.fontSize == 14) // TERM_L1_17
        #expect(c.terminal.cursorStyle == "block") // TERM_L1_18
        #expect(c.terminal.cursorBlink == true) // TERM_L1_19
        #expect(c.startupTerminalCount == 1) // SETTINGS_L1_01
        #expect(c.ftvLeftWidth == 250) // legacy config.ts DEFAULT_CONFIG
        #expect(c.ftvRightWidth == 300)
        #expect(c.gridLayout == MuxvoConfig.GridLayout(columnRatios: [1, 1], rowRatios: [1, 1]))
        #expect(c.openTerminals.isEmpty)
    }

    @Test("SETTINGS_L1_02: preferences 持久化格式 —— language 字段读写 round-trip + 缺省合并（默认 'zh'）")
    func settings_l1_02_languagePersistence() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            // 缺省合并：老 config.json 无 language 键 → 回默认 'zh'（裁决 as-built，非"跟随系统"）。
            let d = MuxvoConfig()
            #expect(d.language == "zh")
            #expect(d.dockBadgeMode == "realtime") // 裁决：'realtime'
            #expect(d.dockBadgeIntervalMin == 1)    // 裁决：1（非 5）
            #expect(d.defaultTerminalCwd == "")
            #expect(d.doubleClickToFocus == false)
            #expect(d.showHiddenFiles == false)
            let partial = #"{ "theme": "light" }"# // 无 language 键
            try Data(partial.utf8).write(to: fileURL)
            #expect(ConfigStore(configFileURL: fileURL).load().language == "zh")

            // 读写 round-trip：显式设 language 落盘 + 重读等值（含缺省合并保留其余偏好默认）。
            let store = ConfigStore(configFileURL: fileURL)
            var config = MuxvoConfig()
            config.language = "en"
            try store.save(config)
            let reloaded = ConfigStore(configFileURL: fileURL).load()
            #expect(reloaded.language == "en")
            #expect(reloaded == config)
        }
    }

    @Test("load 文件缺失 → 全默认")
    func loadMissingReturnsDefaults() throws {
        try withTempRoot { root in
            let store = ConfigStore(configFileURL: root.appendingPathComponent("nope.json"))
            #expect(store.load() == MuxvoConfig())
        }
    }

    @Test("load 损坏 JSON → 全默认（不抛，legacy config.ts catch→DEFAULT）")
    func loadCorruptReturnsDefaults() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            try Data("{ not valid json ".utf8).write(to: fileURL)
            #expect(ConfigStore(configFileURL: fileURL).load() == MuxvoConfig())
        }
    }

    @Test("load 部分字段 JSON → 缺失键回默认（顶层浅合并 + terminal 深合并，legacy 行为）")
    func loadPartialMergesDefaults() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            let partial = #"{ "theme": "light", "terminal": { "fontSize": 18 } }"#
            try Data(partial.utf8).write(to: fileURL)
            let loaded = ConfigStore(configFileURL: fileURL).load()

            #expect(loaded.theme == "light") // 给定值保留
            #expect(loaded.fontSize == 14) // 顶层缺失 → 默认
            #expect(loaded.terminal.fontSize == 18) // 给定子字段保留
            #expect(loaded.terminal.themeName == "dark") // 子字段缺失 → 默认（深合并）
            #expect(loaded.terminal.cursorStyle == "block")
            #expect(loaded.terminal.cursorBlink == true)
            #expect(loaded.startupTerminalCount == 1) // 缺失 → 默认
            #expect(loaded.window == MuxvoConfig.Window()) // 缺失 → 默认
        }
    }

    @Test("tourCompleted round-trip：缺席回默认 false + save/load 无损（右上角批 B2，welcome-overlay 门控）")
    func tourCompletedRoundTrip() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            // 旧 config（无 tourCompleted 键）→ 默认 false（首启弹欢迎卡）。
            try Data(#"{ "theme": "dark" }"#.utf8).write(to: fileURL)
            #expect(ConfigStore(configFileURL: fileURL).load().tourCompleted == false)
            // save true → 重读 true（原子落盘 round-trip）。
            var cfg = MuxvoConfig()
            cfg.tourCompleted = true
            try ConfigStore(configFileURL: fileURL).save(cfg)
            #expect(ConfigStore(configFileURL: fileURL).load().tourCompleted == true)
        }
    }

    @Test("legacyChatMigrationNoticeShown round-trip：缺席回默认 false + save/load 无损（M7 批3 §7.2 一次性闩）")
    func legacyChatMigrationNoticeShownRoundTrip() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            // 旧 config（无该键）→ 默认 false（迁移提示尚可展示一次）。
            try Data(#"{ "theme": "dark" }"#.utf8).write(to: fileURL)
            #expect(ConfigStore(configFileURL: fileURL).load().legacyChatMigrationNoticeShown == false)
            // 置 true（已展示闩）→ 重读 true（此后 native 侧永不再回 show=true）。
            var cfg = MuxvoConfig()
            cfg.legacyChatMigrationNoticeShown = true
            try ConfigStore(configFileURL: fileURL).save(cfg)
            #expect(ConfigStore(configFileURL: fileURL).load().legacyChatMigrationNoticeShown == true)
        }
    }

    @Test("save 覆盖既有 config.json（原子替换，重读为新值）")
    func saveOverwrites() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            let store = ConfigStore(configFileURL: fileURL)
            try store.save(MuxvoConfig())
            var updated = MuxvoConfig()
            updated.fontSize = 20
            try store.save(updated)
            #expect(store.load().fontSize == 20)
        }
    }
}
