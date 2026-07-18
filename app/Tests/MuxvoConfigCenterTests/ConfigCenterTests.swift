// ConfigCenter 直测（M6 批1）。CONFIG_L1_01/02/03/04/08 spec 翻牌 + MCP/plugins/codex-TOML 非 spec
// 锁行为。只碰 $TMPDIR fixture 根（ConfigRoots 显式指 temp），绝不触真实 ~/.claude。
import Foundation
import MuxvoBridge
import MuxvoStorage
import MuxvoTestSupport
import Testing

@testable import MuxvoConfigCenter

@Suite("ConfigCenter（配置面数据中枢：资源/settings/MCP/plugins/watcher，只碰 $TMPDIR）")
struct ConfigCenterTests {
    // MARK: fixture / helpers

    private func makeRoots(_ root: URL) -> ConfigRoots {
        ConfigRoots(
            claudeRoot: root.appendingPathComponent(".claude"),
            globalMcpFile: root.appendingPathComponent(".claude.json"),
            desktopMcpFile: root.appendingPathComponent("desktop.json"),
            codexConfigFile: root.appendingPathComponent(".codex/config.toml"),
            geminiSettingsFile: root.appendingPathComponent(".gemini/settings.json"))
    }

    private func mkdir(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    private func write(_ text: String, to url: URL) throws {
        try mkdir(url.deletingLastPathComponent())
        try Data(text.utf8).write(to: url)
    }

    /// Result<Void|Tuple, ConfigCenterError> 非 Equatable（Void/元组不 Equatable）→ 用谓词断言。
    private func succeeded<T>(_ r: Result<T, ConfigCenterError>) -> Bool {
        if case .success = r { return true }
        return false
    }

    private func failure<T>(_ r: Result<T, ConfigCenterError>) -> ConfigCenterError? {
        if case let .failure(e) = r { return e }
        return nil
    }

    // MARK: - CONFIG_L1_01 listResources

    @Test("CONFIG_L1_01: config:get-resources —— skills 扫描（含 SKILL.md 子目录即资源，name/path/type）")
    func config_l1_01_listResources() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            try write("---\n", to: roots.skillsRoot.appendingPathComponent("bravo/SKILL.md"))
            try write("---\n", to: roots.skillsRoot.appendingPathComponent("alpha/SKILL.md"))
            try mkdir(roots.skillsRoot.appendingPathComponent("no-skill-md")) // 无 SKILL.md → 非资源

            let center = ConfigCenter(roots: roots)
            let items = center.listResources(types: [.skills])
            #expect(items.map(\.name) == ["alpha", "bravo"]) // 升序稳定，过滤无 SKILL.md
            #expect(items.allSatisfy { $0.type == "skills" })
            #expect(items[0].path.hasSuffix("/.claude/skills/alpha"))
            // listResources 产出路径能过 readResource 白名单往返（符号链接归一后接受）
            let skillMd = items[0].path + "/SKILL.md"
            if case let .success(v) = center.readResource(path: skillMd) {
                #expect(v.format == .md)
            } else { Issue.record("listResources 路径应被 readResource 白名单接受") }
            // skills 根缺失 → 优雅降级空
            #expect(ConfigCenter(roots: makeRoots(root.appendingPathComponent("nope")))
                .listResources(types: [.skills]).isEmpty)
        }
    }

    // MARK: - CONFIG_L1_02 readResource

    @Test("CONFIG_L1_02: config:get-resource-content —— format 按扩展名推断 md|json|sh|other + 内容保真")
    func config_l1_02_readResourceFormat() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            let skillDir = roots.skillsRoot.appendingPathComponent("s")
            try write("# hi", to: skillDir.appendingPathComponent("SKILL.md"))
            try write("{\"a\":1}", to: skillDir.appendingPathComponent("data.json"))
            try write("echo hi", to: skillDir.appendingPathComponent("run.sh"))
            try write("plain", to: skillDir.appendingPathComponent("notes.txt"))
            let center = ConfigCenter(roots: roots)

            func fmt(_ name: String) -> ResourceFormat? {
                if case let .success(v) = center.readResource(
                    path: skillDir.appendingPathComponent(name).path) { return v.format }
                return nil
            }
            #expect(fmt("SKILL.md") == .md)
            #expect(fmt("data.json") == .json)
            #expect(fmt("run.sh") == .sh)
            #expect(fmt("notes.txt") == .other)
            // 内容保真
            if case let .success(v) = center.readResource(
                path: skillDir.appendingPathComponent("SKILL.md").path) {
                #expect(v.content == "# hi")
            } else { Issue.record("readResource 应成功") }
            // 白名单外 → pathRejected
            #expect(failure(center.readResource(path: "/etc/hosts")) == .pathRejected("/etc/hosts"))
        }
    }

    // MARK: - CONFIG_L1_03 getSettings

    @Test("CONFIG_L1_03: config:get-settings —— 全文 round-trip（缺失 → \"{}\" 降级）")
    func config_l1_03_getSettings() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            let center = ConfigCenter(roots: roots)
            #expect(center.getSettings() == "{}") // 缺失降级
            let json = "{\n  \"hooks\": {},\n  \"foo\": 1\n}"
            try write(json, to: roots.settingsFile)
            #expect(center.getSettings() == json) // 全文原样
        }
    }

    // MARK: - CONFIG_L1_04 saveSettings

    @Test("CONFIG_L1_04: config:save-settings —— 原子写 + 重读等值（无 tmp 残留；非法 JSON 拒绝）")
    func config_l1_04_saveSettings() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            try mkdir(roots.claudeRoot)
            let center = ConfigCenter(roots: roots)
            let json = "{\"enabledPlugins\":{\"a@m\":true},\"n\":2}"
            #expect(succeeded(center.saveSettings(json: json)))
            // 重读等值（原始字节保真）
            #expect(center.getSettings() == json)
            // 无 tmp 残留
            let siblings = try FileManager.default.contentsOfDirectory(atPath: roots.claudeRoot.path)
            #expect(siblings.allSatisfy { !$0.contains(".tmp.") }, "残留 tmp：\(siblings)")
            // 非法 JSON 拒绝（防写坏 settings）
            #expect(!succeeded(center.saveSettings(json: "{ not json")))
        }
    }

    // MARK: - CONFIG_L1_08 watcher

    @Test("CONFIG_L1_08: config:resource-change —— watcher 分类去抖 → configResourcesChanged 编码")
    func config_l1_08_watcher() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            // @Sendable onChange 不能捕获可变局部 var → 用引用型盒（测试单线程直驱，@unchecked 安全）。
            final class Box: @unchecked Sendable { var items: [String] = [] }
            let box = Box()
            // 大去抖窗：真 asyncAfter 不在测试内触发，flushPending 手动确定性驱动。
            let watcher = ResourceWatcher(
                claudeRoot: roots.claudeRoot, debounceMs: 100_000, onChange: { box.items.append($0) })
            // 分类纯函数：skills/settings/白名单外
            #expect(ResourceWatcher.classify(
                path: roots.skillsRoot.appendingPathComponent("s/SKILL.md").path,
                claudeRoot: roots.claudeRoot) == "skills")
            #expect(ResourceWatcher.classify(
                path: roots.settingsFile.path, claudeRoot: roots.claudeRoot) == "settings")
            #expect(ResourceWatcher.classify(
                path: "/etc/hosts", claudeRoot: roots.claudeRoot) == nil)
            // 去抖合并：一窗内两次 skills 变化 → 单次 "skills" 回调
            watcher.ingest(paths: [
                roots.skillsRoot.appendingPathComponent("s/SKILL.md").path,
                roots.skillsRoot.appendingPathComponent("s/other.md").path,
            ])
            watcher.flushPending()
            #expect(box.items == ["skills"])
            // 装配层转 DataEvent.configResourcesChanged{resourceType} 的编码断言
            let event = DataEvent.configResourcesChanged(resourceType: box.items[0])
            let obj = try JSONSerialization.jsonObject(
                with: JSONEncoder().encode(event)) as? [String: Any]
            #expect(obj?["kind"] as? String == "configResourcesChanged")
            #expect(obj?["resourceType"] as? String == "skills")
        }
    }

    // MARK: - MCP 非 spec 锁行为

    @Test("MCP JSON 源解析：type 推断（stdio/http/sse）+ env KeyValue 升序 + scope")
    func mcpJsonParse() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            let json = """
            {"mcpServers":{
              "cmd":{"command":"node","args":["x.js"],"env":{"B":"2","A":"1"}},
              "web":{"url":"https://h/mcp"},
              "streamy":{"url":"https://h/sse"}
            }}
            """
            try write(json, to: roots.globalMcpFile)
            let servers = ConfigCenter(roots: roots).mcpServers()
            #expect(servers.map(\.name) == ["cmd", "streamy", "web"]) // 升序
            let cmd = servers.first { $0.name == "cmd" }!
            #expect(cmd.type == .stdio)
            #expect(cmd.scope == .global)
            #expect(cmd.command == "node")
            #expect(cmd.args == ["x.js"])
            #expect(cmd.env == [KeyValue(key: "A", value: "1"), KeyValue(key: "B", value: "2")])
            #expect(servers.first { $0.name == "web" }!.type == .http)
            #expect(servers.first { $0.name == "streamy" }!.type == .sse)
        }
    }

    @Test("MCP codex 手写 TOML 子集：[mcp_servers.NAME] + .env 子表 → stdio McpServerView（解析失败降级）")
    func mcpCodexTomlSubset() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            let toml = """
            # codex config
            model = "gpt"

            [mcp_servers.node_repl]
            command = "node"
            args = ["--eval", "repl.js"]
            startup_timeout_sec = 20

            [mcp_servers.node_repl.env]
            NODE_ENV = "production"
            """
            try write(toml, to: roots.codexConfigFile)
            let servers = ConfigCenter(roots: roots).mcpServers()
            let codex = servers.filter { $0.scope == .codex }
            #expect(codex.count == 1)
            let s = codex[0]
            #expect(s.name == "node_repl")
            #expect(s.type == .stdio)
            #expect(s.command == "node")
            #expect(s.args == ["--eval", "repl.js"])
            #expect(s.env == [KeyValue(key: "NODE_ENV", value: "production")])
            // 坏 TOML → 该源降级空（绝不崩）
            try write("[[[garbage", to: roots.codexConfigFile)
            #expect(ConfigCenter(roots: roots).mcpServers().filter { $0.scope == .codex }.isEmpty)
        }
    }

    @Test("MCP save/delete 仅 global：写 ~/.claude.json mcpServers 后重读命中，删后消失")
    func mcpSaveDeleteGlobal() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            try mkdir(root)
            let center = ConfigCenter(roots: roots)
            #expect(succeeded(center.mcpSave(server: McpServerEdit(
                name: "srv", type: .stdio, command: "node", args: ["a"], url: nil,
                headers: nil, env: [KeyValue(key: "K", value: "V")]))))
            var servers = center.mcpServers()
            #expect(servers.contains { $0.name == "srv" && $0.command == "node" })
            #expect(succeeded(center.mcpDelete(name: "srv")))
            servers = center.mcpServers()
            #expect(!servers.contains { $0.name == "srv" })
        }
    }

    // MARK: - resources 写白名单

    @Test("writeResource：白名单内原子写 + 重读等值；白名单外 pathRejected")
    func writeResourceWhitelist() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            let center = ConfigCenter(roots: roots)
            let target = roots.skillsRoot.appendingPathComponent("s/SKILL.md")
            try mkdir(target.deletingLastPathComponent())
            #expect(succeeded(center.writeResource(path: target.path, content: "new body")))
            if case let .success(v) = center.readResource(path: target.path) {
                #expect(v.content == "new body")
            } else { Issue.record("重读应成功") }
            // 白名单外拒绝
            let escape = root.appendingPathComponent("escape.txt").path
            #expect(failure(center.writeResource(path: escape, content: "x")) == .pathRejected(escape))
        }
    }

    // MARK: - plugins 非 spec 锁行为

    @Test("plugins 装配：installed_plugins.json + enabledPlugins + manifest + contents 扫描 → PluginView")
    func pluginsAssembly() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            let installPath = roots.pluginsRoot.appendingPathComponent("store/acme")
            try write("""
            {"plugins":{"acme@market":[{"version":"1.2.0","scope":"user",
              "installPath":"\(installPath.path)","installedAt":"2026-01-01T00:00:00Z",
              "lastUpdated":"2026-02-01T00:00:00Z"}]}}
            """, to: roots.installedPluginsFile)
            try write("{\"enabledPlugins\":{\"acme@market\":true}}", to: roots.settingsFile)
            try write("{\"description\":\"D\",\"author\":{\"name\":\"Ann\"}}",
                      to: installPath.appendingPathComponent(".claude-plugin/plugin.json"))
            try write("do x", to: installPath.appendingPathComponent("commands/build.md"))
            try mkdir(installPath.appendingPathComponent("skills/foo"))
            try write("h", to: installPath.appendingPathComponent("hooks/pre.sh"))

            let items = ConfigCenter(roots: roots).plugins()
            #expect(items.count == 1)
            let p = items[0]
            #expect(p.id == "acme@market")
            #expect(p.name == "acme")
            #expect(p.marketplace == "market")
            #expect(p.version == "1.2.0")
            #expect(p.enabled == true)
            #expect(p.description == "D")
            #expect(p.authorName == "Ann")
            #expect(p.commands == ["build"])
            #expect(p.skills == ["foo"])
            #expect(p.hooks == ["pre.sh"])
            #expect(p.agents.isEmpty)
        }
    }

    @Test("setPluginEnabled：改 settings.enabledPlugins[id] 原子回写 + 保留其余键")
    func setPluginEnabledRoundTrip() throws {
        try withTempRoot { root in
            let roots = makeRoots(root)
            try write("{\"enabledPlugins\":{\"a@m\":true},\"other\":9}", to: roots.settingsFile)
            let center = ConfigCenter(roots: roots)
            #expect(succeeded(center.setPluginEnabled(pluginId: "a@m", enabled: false)))
            #expect(center.enabledPluginsMap()["a@m"] == false)
            // 保留其余键
            let obj = try JSONSerialization.jsonObject(
                with: Data(center.getSettings().utf8)) as? [String: Any]
            #expect(obj?["other"] as? Int == 9)
        }
    }
}
