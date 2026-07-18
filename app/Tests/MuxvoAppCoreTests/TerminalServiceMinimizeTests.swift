// 终端收起 TerminalService 半（批A A3，term-grid.md §11）：mapSnapshot 字段省略规则（字节冻结）、
// openTerminals.minimized 持久化往返（同 temp config 两次装配 = 模拟重启）、后台尺寸门（§11.4
// TG_MIN_restore_size_gate 机制半——恢复为收起态的会话在注入前获得真实尺寸）、末行采样管线。
// reducer 半归 UIStateProjectionMinimizeTests；e2e 半（surface detach/洞矩形）归 item44。
//
// 惯例沿 PanelZoomTests：便利构造 init(configStore:) + onState 捕获 + 字节冻结 JSON 断言。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoStorage
@testable import MuxvoAppCore
@testable import MuxvoTerm

@Suite("终端收起 service 半（批A A3，term-grid.md §11）", .serialized)
@MainActor
struct TerminalServiceMinimizeTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-minimize-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// /bin/cat 真 PTY 模板：pid>0、SIGHUP 即退；写入可产出帧（末行采样用）。
    private func catTemplate() -> TerminalSession.Config {
        var c = TerminalSession.Config()
        c.executablePath = "/bin/cat"
        c.argv = ["cat"]
        return c
    }

    private func makeService(root: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root, configTemplate: catTemplate)
    }

    @Test("TG_MIN_lastline_only_minimized（service 半）+ 字节冻结守卫：未收起 → JSON 无 minimized/lastLine 键；收起 → minimized:true")
    func uiStateOmitsMinimizedFieldsByDefault() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }
        var captured: UIState?
        service.onState = { captured = $0 }

        guard case .created(let tid, _) = service.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        service.republishState()
        let plain = try #require(captured)
        let plainJson = String(decoding: try JSONEncoder().encode(plain), as: UTF8.self)
        #expect(!plainJson.contains("minimized"), "未收起不得出现 minimized 键（fixture/golden 字节冻结）")
        #expect(!plainJson.contains("lastLine"), "未收起不得出现 lastLine 键")

        service.handleAction(.minimizeTile(terminalId: tid))
        let minimized = try #require(captured)
        #expect(minimized.terminals.first { $0.id == tid }?.minimized == true)

        service.handleAction(.restoreTile(terminalId: tid))
        let restored = try #require(captured)
        let restoredJson = String(decoding: try JSONEncoder().encode(restored), as: UTF8.self)
        #expect(!restoredJson.contains("minimized"), "恢复后回缺席（字节冻结）")
        #expect(restored.selectedId == tid, "恢复即选中")
    }

    @Test("TG_MIN_persist_roundtrip（service 半）：收起写盘 minimized:true、未收起省略；新装配还原收起态（模拟重启）")
    func minimizedPersistsAcrossAssembly() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let configURL = root.appendingPathComponent(ConfigStore.configFileName)

        // 第一次装配：2 终端，收起第 1 个。
        let first = makeService(root: root)
        guard case .created(let t1, _) = first.handleTermCommand(.create(cwd: nil)),
              case .created(let t2, _) = first.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        first.handleAction(.minimizeTile(terminalId: t1))

        // 写盘断言：t1 带 minimized:true，t2 省略该键（字节不膨胀）。
        let config = ConfigStore(configFileURL: configURL).load()
        #expect(config.openTerminals.count == 2)
        #expect(config.openTerminals.first { $0.id == t1 }?.minimized == true)
        #expect(config.openTerminals.first { $0.id == t2 }?.minimized == nil)
        let raw = try String(contentsOf: configURL, encoding: .utf8)
        #expect(raw.components(separatedBy: "minimized").count == 2, "config JSON 恰一处 minimized（未收起省略）")
        first.registry.shutdownForTeardown()

        // 第二次装配（模拟重启）：restore 还原收起态。
        let second = makeService(root: root)
        defer { second.registry.shutdownForTeardown() }
        var captured: UIState?
        second.onState = { captured = $0 }
        let ids = second.createStartupTerminals(count: 1)
        #expect(ids.count == 2)
        second.republishState()
        let snap = try #require(captured)
        #expect(snap.terminals.filter { $0.minimized == true }.count == 1)
        #expect(snap.terminals.first?.minimized == true, "维序首位（原 t1）恢复为收起态")
    }

    @Test("TG_MIN_restore_size_gate: 收起会话未定尺寸 → ensureBackgroundSized 拷贝可见会话尺寸 → hasReceivedResize 就位（注入前过门）")
    func backgroundSizeGateCopiesVisibleSize() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }

        guard case .created(let visible, _) = service.handleTermCommand(.create(cwd: nil)),
              case .created(let hidden, _) = service.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        service.handleAction(.minimizeTile(terminalId: hidden))
        let visibleSession = service.registry.session(for: SessionID(raw: visible))!
        let hiddenSession = service.registry.session(for: SessionID(raw: hidden))!

        // 前置：两会话都停在 spawn 默认（未收真实 resize）→ 门无源可拷，不动（极端兜底走注入器 5s 超时）。
        #expect(!hiddenSession.hasReceivedResize)
        service.ensureBackgroundSized()
        #expect(!hiddenSession.hasReceivedResize, "无 sized 可见源时不拷（不造假尺寸）")

        // 可见会话收到真实 resize（模拟洞 layoutReport 落地）→ 门把尺寸拷给收起会话。
        #expect(visibleSession.resize(cols: 187, rows: 42))
        service.ensureBackgroundSized()
        #expect(hiddenSession.hasReceivedResize, "红绿锚：未实装 ensureBackgroundSized 时此断言必红（80×24 超时注入）")
        #expect(hiddenSession.cols == 187)
        #expect(hiddenSession.rows == 42)

        // 幂等：已 sized 的收起会话不再被覆盖（真 resize 到达后门永不再触）。
        #expect(hiddenSession.resize(cols: 100, rows: 30))
        service.ensureBackgroundSized()
        #expect(hiddenSession.cols == 100, "已 sized 会话门不覆盖")
    }

    @Test("TG_MIN_restore_size_gate（第 1 层，对抗回修 MINOR-1）：全收起重启（持久无源）——持久化尺寸恢复即过门，不等心跳拷贝")
    func persistedSizeRestoresGateWithoutVisibleSource() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let configURL = root.appendingPathComponent(ConfigStore.configFileName)

        // 第一次装配：单终端、收到真实 resize（177×39）、收起（= 全部终端收起）。
        let first = makeService(root: root)
        guard case .created(let t1, _) = first.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        #expect(first.registry.session(for: SessionID(raw: t1))!.resize(cols: 177, rows: 39))
        first.handleAction(.minimizeTile(terminalId: t1))
        let stored = ConfigStore(configFileURL: configURL).load().openTerminals
        #expect(stored.first?.cols == 177)
        #expect(stored.first?.rows == 39)
        first.registry.shutdownForTeardown()

        // 第二次装配（模拟重启，全收起 = 无任何可见会话 = 心跳拷贝永无源）。
        let second = makeService(root: root)
        defer { second.registry.shutdownForTeardown() }
        let ids = second.createStartupTerminals(count: 1)
        let firstId = try #require(ids.first)
        let restored = try #require(second.registry.session(for: SessionID(raw: firstId)))
        // 红绿锚：未实装持久化尺寸恢复时，此会话停 spawn 默认 80×24 且 hasReceivedResize=false（必红）。
        #expect(restored.hasReceivedResize, "持久无源场景须由持久化尺寸过门（对抗 MINOR-1）")
        #expect(restored.cols == 177)
        #expect(restored.rows == 39)
    }

    @Test("末行采样管线：cat 回显落帧 → sampleMinimizedLastLines → 快照 lastLine 就位（仅收起项）")
    func lastLineSamplingPipeline() async throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }

        guard case .created(let tid, _) = service.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        let session = service.registry.session(for: SessionID(raw: tid))!
        service.handleAction(.minimizeTile(terminalId: tid))
        var captured: UIState?
        service.onState = { captured = $0 }

        // cat 回显 marker → 渲染帧物化（RenderCoordinator dirty 驱动，与视图 attach 无关）。
        // republishState 直读投影态（绕过 noteLastLine 的 50ms 去抖，lastLines 字典即时可见）。
        session.write(Array("muxvo-lastline-marker\r".utf8))
        let deadline = Date().addingTimeInterval(6 * muxvoCITimeoutScale())
        var sampled: String?
        while Date() < deadline, sampled == nil {
            try await Task.sleep(nanoseconds: 100_000_000)
            service.sampleMinimizedLastLines()
            service.republishState()
            sampled = captured?.terminals.first { $0.id == tid }?.lastLine
        }
        #expect(sampled?.contains("muxvo-lastline-marker") == true, "收起终端末行摘要应采到 cat 回显")
    }
}
