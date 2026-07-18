// ConfigCenter MCP 面（M6 批1，mcp-panel.md §1 + m6-batch0-adjudication.md codex 裁决）。
// 4 源解析（global/desktop/codex/gemini）→ [McpServerView]；codex 手写只读 TOML 子集解析器
// （裁决=解析而非跳过；范围限 [mcp_servers.*] 表 + .env 子表；解析失败该源 []，优雅降级绝不崩）。
// mcpSave/mcpDelete 仅 global 源（~/.claude.json）可写。
import Foundation
import MuxvoBridge
import MuxvoStorage

extension ConfigCenter {
    // MARK: - 4 源读

    /// 读全部全局 MCP 源（App 挂载不传 projectCwd，仅全局四源）。各源解析失败独立降级为空。
    /// 顺序：global → desktop → codex → gemini（web 侧按 scope 分组，此顺序稳定即可）。
    public func mcpServers() -> [McpServerView] {
        var out: [McpServerView] = []
        out += Self.parseJsonMcp(file: roots.globalMcpFile, scope: .global)
        out += Self.parseJsonMcp(file: roots.desktopMcpFile, scope: .desktop)
        out += Self.parseCodexMcp(file: roots.codexConfigFile)
        out += Self.parseJsonMcp(file: roots.geminiSettingsFile, scope: .gemini)
        return out
    }

    /// JSON 源解析（legacy readConfigFile + parseMcpServers 亲验）：顶层 `mcpServers` 对象；缺该键则整个
    /// 根对象当 servers map（legacy `raw.mcpServers ?? raw`）；非对象值项过滤。name 升序稳定。
    static func parseJsonMcp(file: URL, scope: McpScope) -> [McpServerView] {
        guard let data = try? Data(contentsOf: file),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [] }
        let servers = (root["mcpServers"] as? [String: Any]) ?? root
        var out: [McpServerView] = []
        for name in servers.keys.sorted() {
            guard let entry = servers[name] as? [String: Any] else { continue }
            out.append(buildServerView(name: name, entry: entry, scope: scope, configPath: file.path))
        }
        return out
    }

    /// 单条 JSON entry → McpServerView。type 推断（legacy inferType）：有 url → 含 '/sse' 则 sse 否则
    /// http；无 url → stdio。env/headers 字典 → [KeyValue]（key 升序稳定）。
    static func buildServerView(
        name: String, entry: [String: Any], scope: McpScope, configPath: String
    ) -> McpServerView {
        let command = entry["command"] as? String
        let args = entry["args"] as? [String]
        let url = entry["url"] as? String
        let type: McpType = inferType(url: url)
        return McpServerView(
            name: name, type: type, scope: scope,
            command: command, args: args, url: url,
            headers: keyValues(entry["headers"]), env: keyValues(entry["env"]),
            configPath: configPath)
    }

    static func inferType(url: String?) -> McpType {
        guard let url, !url.isEmpty else { return .stdio }
        return url.contains("/sse") ? .sse : .http
    }

    /// 字典 → [KeyValue]（key 升序）。空/非字典 → nil（bridge optional 语义）。值非字符串取其字面。
    static func keyValues(_ any: Any?) -> [KeyValue]? {
        guard let dict = any as? [String: Any], !dict.isEmpty else { return nil }
        return dict.keys.sorted().map { key in
            let raw = dict[key]
            let value = (raw as? String) ?? (raw.map { String(describing: $0) } ?? "")
            return KeyValue(key: key, value: value)
        }
    }

    // MARK: - codex TOML 只读子集解析（裁决：手写子集 + 优雅降级）

    /// 内部累积器。
    private struct CodexServer {
        var command: String?
        var args: [String]?
        var url: String?
        var env: [String: String] = [:]
    }

    /// 手写 TOML 子集解析器（裁决：codex 活源，read-only 子集，绝不引全量 TOML 依赖）。范围：
    ///   [mcp_servers.NAME] 表：command(str) / args(str[]) / url(str) / type(str，仅占位，type 由 url 推断)
    ///   [mcp_servers.NAME.env] 子表：KEY = "value"
    /// 其余表/键忽略。多行数组/inline table/dotted key 等子集外结构 → 该行降级（不崩）。读失败 → []。
    static func parseCodexMcp(file: URL) -> [McpServerView] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        var servers: [String: CodexServer] = [:]
        var order: [String] = []

        enum Section { case none, server(String), env(String) }
        var section: Section = .none

        func ensure(_ name: String) {
            if servers[name] == nil { servers[name] = CodexServer(); order.append(name) }
        }

        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }

            if line.hasPrefix("["), line.hasSuffix("]") {
                let inner = String(line.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
                if let name = codexTableName(inner, subtable: "env") {
                    ensure(name); section = .env(name)
                } else if let name = codexTableName(inner, subtable: nil) {
                    ensure(name); section = .server(name)
                } else {
                    section = .none
                }
                continue
            }

            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = line[..<eq].trimmingCharacters(in: .whitespaces)
            let valueStr = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            switch section {
            case let .server(name):
                switch key {
                case "command": servers[name]?.command = tomlString(valueStr)
                case "url": servers[name]?.url = tomlString(valueStr)
                case "args": servers[name]?.args = tomlStringArray(valueStr)
                default: break // type 等忽略（type 由 url 推断）
                }
            case let .env(name):
                if let v = tomlString(valueStr) { servers[name]?.env[stripQuotes(key)] = v }
            case .none:
                break
            }
        }

        return order.compactMap { name -> McpServerView? in
            guard let s = servers[name] else { return nil }
            let env: [KeyValue]? = s.env.isEmpty
                ? nil : s.env.keys.sorted().map { KeyValue(key: $0, value: s.env[$0]!) }
            return McpServerView(
                name: name, type: inferType(url: s.url), scope: .codex,
                command: s.command, args: s.args, url: s.url,
                headers: nil, env: env, configPath: file.path)
        }
    }

    /// `mcp_servers.NAME`（subtable=nil）或 `mcp_servers.NAME.env`（subtable="env"）→ NAME。
    /// NAME 不含 '.'（子集不支持点分/引号点名）。不匹配 → nil。
    static func codexTableName(_ inner: String, subtable: String?) -> String? {
        let prefix = "mcp_servers."
        guard inner.hasPrefix(prefix) else { return nil }
        var rest = String(inner.dropFirst(prefix.count))
        if let subtable {
            let dotSub = "." + subtable
            guard rest.hasSuffix(dotSub) else { return nil }
            rest = String(rest.dropLast(dotSub.count))
        }
        let name = stripQuotes(rest)
        // 无 subtable 时 rest 仍含 '.' = 是子表（如 .env）→ 交由 subtable 分支处理，此处不认。
        guard !name.isEmpty, !name.contains(".") else { return nil }
        return name
    }

    /// TOML 字符串标量 `"..."` / `'...'` → 内容（自动截断闭引号后的行内注释/空白）。非引号 → nil。
    static func tomlString(_ s: String) -> String? {
        guard let quote = s.first, quote == "\"" || quote == "'" else { return nil }
        let body = s.dropFirst()
        guard let end = body.firstIndex(of: quote) else { return nil }
        return String(body[..<end])
    }

    /// TOML 单行字符串数组 `["a", "b"]` → [a, b]（子集：单行；多行数组降级 nil）。
    static func tomlStringArray(_ s: String) -> [String]? {
        guard s.hasPrefix("["), let close = s.lastIndex(of: "]") else { return nil }
        let inner = s[s.index(after: s.startIndex)..<close]
        var out: [String] = []
        for part in inner.split(separator: ",") {
            let t = part.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { continue }
            if let str = tomlString(t) { out.append(str) } else { out.append(stripQuotes(t)) }
        }
        return out
    }

    /// 去首尾成对引号（bare key / 简单引号名）。
    static func stripQuotes(_ s: String) -> String {
        guard s.count >= 2, let f = s.first, let l = s.last, f == l, f == "\"" || f == "'" else {
            return s
        }
        return String(s.dropFirst().dropLast())
    }

    // MARK: - 写（仅 global）

    /// 新增/更新 global MCP 服务器（~/.claude.json mcpServers[name]）。
    public func mcpSave(server: McpServerEdit) -> Result<Void, ConfigCenterError> {
        updateGlobalMcp { $0[server.name] = Self.encodeServerEdit(server) }
    }

    /// 删除 global MCP 服务器。
    public func mcpDelete(name: String) -> Result<Void, ConfigCenterError> {
        updateGlobalMcp { $0.removeValue(forKey: name) }
    }

    private func updateGlobalMcp(
        _ mutate: (inout [String: Any]) -> Void
    ) -> Result<Void, ConfigCenterError> {
        var root: [String: Any] = [:]
        if let data = try? Data(contentsOf: roots.globalMcpFile),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            root = obj
        }
        var servers = (root["mcpServers"] as? [String: Any]) ?? [:]
        mutate(&servers)
        root["mcpServers"] = servers
        guard let out = try? JSONSerialization.data(
            withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        else { return .failure(.ioError("mcp 序列化失败")) }
        do {
            try AtomicFile.write(out, to: roots.globalMcpFile, durability: .standard)
            return .success(())
        } catch {
            return .failure(.ioError("\(error)"))
        }
    }

    static func encodeServerEdit(_ s: McpServerEdit) -> [String: Any] {
        var obj: [String: Any] = [:]
        if let c = s.command { obj["command"] = c }
        if let a = s.args { obj["args"] = a }
        if let u = s.url { obj["url"] = u }
        if let h = s.headers, !h.isEmpty {
            obj["headers"] = Dictionary(h.map { ($0.key, $0.value) }, uniquingKeysWith: { a, _ in a })
        }
        if let e = s.env, !e.isEmpty {
            obj["env"] = Dictionary(e.map { ($0.key, $0.value) }, uniquingKeysWith: { a, _ in a })
        }
        return obj
    }
}
