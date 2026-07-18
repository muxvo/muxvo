import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

@MainActor
@Suite("ConfigModel（config.json 单写者中枢：共享实例 + update/updatePrefs 语义，只碰 $TMPDIR）")
struct ConfigModelTests {
    @Test("init 从 store 载入当前 config；update 就地改并原子落盘、重读等值")
    func updatePersists() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            let store = ConfigStore(configFileURL: fileURL)
            let model = ConfigModel(store: store)
            #expect(model.config == MuxvoConfig())

            model.update { $0.fontSize = 19 }
            #expect(model.config.fontSize == 19)
            // 落盘（新实例重读为新值）+ 无 tmp 残留
            #expect(ConfigStore(configFileURL: fileURL).load().fontSize == 19)
            let siblings = try FileManager.default.contentsOfDirectory(atPath: root.path)
            #expect(siblings.allSatisfy { !$0.contains(".tmp.") }, "残留 tmp：\(siblings)")
        }
    }

    @Test("update 不触发 onPrefsChanged；updatePrefs 触发并带新 config")
    func prefsNotificationOnlyOnUpdatePrefs() throws {
        try withTempRoot { root in
            let model = ConfigModel(store: ConfigStore(configFileURL: root.appendingPathComponent("config.json")))
            var fired: [Int] = []
            model.onPrefsChanged = { fired.append($0.fontSize) }

            model.update { $0.gridLayout = .init(columnRatios: [0.3, 0.7], rowRatios: [1]) }
            #expect(fired.isEmpty) // 结构性写回不通知

            model.updatePrefs { $0.fontSize = 22 }
            #expect(fired == [22]) // 偏好写回通知一次，带新值
        }
    }

    @Test("共享单实例：两持有者经同一 ConfigModel 交替写不互相覆盖字段（单写者不变量）")
    func sharedInstanceNoClobber() throws {
        try withTempRoot { root in
            let fileURL = root.appendingPathComponent("config.json")
            let model = ConfigModel(store: ConfigStore(configFileURL: fileURL))
            // 持有者 A 写 openTerminals（结构性）
            model.update { $0.openTerminals = [.init(cwd: "/tmp/a")] }
            // 持有者 B 写 theme（偏好）——不覆盖 A 的 openTerminals
            model.updatePrefs { $0.theme = "light" }
            let reloaded = ConfigStore(configFileURL: fileURL).load()
            #expect(reloaded.openTerminals == [.init(cwd: "/tmp/a")])
            #expect(reloaded.theme == "light")
        }
    }
}
