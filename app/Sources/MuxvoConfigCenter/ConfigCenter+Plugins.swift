// ConfigCenter plugins 面（M6 批1，plugins-panel.md §1 + legacy usePluginConfig 亲验）。
// installed_plugins.json + settings.enabledPlugins + manifest + 4 子目录扫描 → [PluginView]。
// setPluginEnabled 改 settings.enabledPlugins（~/.claude/settings.json）。顶层读失败 → []（优雅降级）。
import Foundation
import MuxvoBridge
import MuxvoStorage

extension ConfigCenter {
    /// 装配已安装插件列表（plugins-panel.md §1）。installed_plugins.json {plugins:{key:[record]}}：
    /// key 按最后 '@' 拆 name/marketplace；record[0] 取 version/scope/installPath/installedAt/lastUpdated；
    /// enabled = settings.enabledPlugins[key]===true；manifest（installPath/.claude-plugin/plugin.json，
    /// 回退 marketplace 目录）→ description/author.name；contents 扫 4 子目录。key 升序稳定。
    public func plugins() -> [PluginView] {
        guard let data = try? Data(contentsOf: roots.installedPluginsFile),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let plugins = root["plugins"] as? [String: Any]
        else { return [] }
        let enabled = enabledPluginsMap()
        var out: [PluginView] = []
        for key in plugins.keys.sorted() {
            guard let records = plugins[key] as? [[String: Any]], let record = records.first
            else { continue }
            out.append(buildPluginView(key: key, record: record, enabled: enabled[key] == true))
        }
        return out
    }

    private func buildPluginView(
        key: String, record: [String: Any], enabled: Bool
    ) -> PluginView {
        let atIndex = key.range(of: "@", options: .backwards)
        let name: String
        let marketplace: String
        if let atIndex, atIndex.lowerBound != key.startIndex {
            name = String(key[key.startIndex..<atIndex.lowerBound])
            marketplace = String(key[atIndex.upperBound...])
        } else {
            name = key
            marketplace = ""
        }
        let installPath = record["installPath"] as? String ?? ""
        let manifest = readManifest(installPath: installPath, marketplace: marketplace, name: name)
        let contents = Self.scanContents(installPath: installPath)
        return PluginView(
            id: key,
            name: name,
            marketplace: marketplace,
            version: record["version"] as? String ?? "",
            scope: record["scope"] as? String ?? "",
            installPath: installPath,
            enabled: enabled,
            installedAt: record["installedAt"] as? String ?? "",
            lastUpdated: record["lastUpdated"] as? String ?? "",
            description: manifest?.description,
            authorName: manifest?.authorName,
            commands: contents.commands,
            skills: contents.skills,
            hooks: contents.hooks,
            agents: contents.agents)
    }

    // MARK: - manifest

    private struct ManifestInfo {
        var description: String?
        var authorName: String?
    }

    /// manifest：installPath/.claude-plugin/plugin.json，回退 marketplaces/<mkt>/plugins/<name>/...
    private func readManifest(installPath: String, marketplace: String, name: String) -> ManifestInfo? {
        let primary = URL(fileURLWithPath: installPath)
            .appendingPathComponent(".claude-plugin/plugin.json")
        if let info = Self.parseManifest(primary) { return info }
        let fallback = roots.marketplacesRoot
            .appendingPathComponent(marketplace)
            .appendingPathComponent("plugins").appendingPathComponent(name)
            .appendingPathComponent(".claude-plugin/plugin.json")
        return Self.parseManifest(fallback)
    }

    private static func parseManifest(_ url: URL) -> ManifestInfo? {
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let author = (obj["author"] as? [String: Any])?["name"] as? String
        return ManifestInfo(description: obj["description"] as? String, authorName: author)
    }

    // MARK: - contents 扫描（4 子目录）

    private struct Contents {
        var commands: [String] = []
        var skills: [String] = []
        var hooks: [String] = []
        var agents: [String] = []
    }

    /// contents 扫 4 子目录（legacy scanPluginContents）：commands/agents 取 .md 去后缀、skills 取子目录名、
    /// hooks 取全部文件名。各子目录读失败独立降级为空。名升序稳定。
    private static func scanContents(installPath: String) -> Contents {
        let base = URL(fileURLWithPath: installPath)
        var c = Contents()
        c.commands = mdNames(base.appendingPathComponent("commands"))
        c.skills = subdirNames(base.appendingPathComponent("skills"))
        c.hooks = fileNames(base.appendingPathComponent("hooks"))
        c.agents = mdNames(base.appendingPathComponent("agents"))
        return c
    }

    private static func entries(_ dir: URL) -> [(name: String, isDir: Bool)] {
        let fm = FileManager.default
        guard let urls = try? fm.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: []) else { return [] }
        return urls.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }).map {
            var d: ObjCBool = false
            _ = fm.fileExists(atPath: $0.path, isDirectory: &d)
            return ($0.lastPathComponent, d.boolValue)
        }
    }

    private static func mdNames(_ dir: URL) -> [String] {
        entries(dir).filter { !$0.isDir && $0.name.hasSuffix(".md") }
            .map { String($0.name.dropLast(3)) }
    }

    private static func subdirNames(_ dir: URL) -> [String] {
        entries(dir).filter(\.isDir).map(\.name)
    }

    private static func fileNames(_ dir: URL) -> [String] {
        entries(dir).filter { !$0.isDir }.map(\.name)
    }

    // MARK: - enabledPlugins 读写（settings.json）

    /// settings.json → enabledPlugins 映射（缺失/非对象 → 空）。
    func enabledPluginsMap() -> [String: Bool] {
        guard let data = try? Data(contentsOf: roots.settingsFile),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let enabled = obj["enabledPlugins"] as? [String: Any]
        else { return [:] }
        var out: [String: Bool] = [:]
        for (k, v) in enabled { out[k] = (v as? Bool) == true }
        return out
    }

    /// 切换插件启用态（legacy toggleEnabled）：读 settings.json → 改 enabledPlugins[pluginId] → 原子回写。
    public func setPluginEnabled(pluginId: String, enabled: Bool) -> Result<Void, ConfigCenterError> {
        var settings: [String: Any] = [:]
        if let data = try? Data(contentsOf: roots.settingsFile),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            settings = obj
        }
        var enabledPlugins = (settings["enabledPlugins"] as? [String: Any]) ?? [:]
        enabledPlugins[pluginId] = enabled
        settings["enabledPlugins"] = enabledPlugins
        guard let out = try? JSONSerialization.data(
            withJSONObject: settings, options: [.prettyPrinted, .sortedKeys])
        else { return .failure(.ioError("settings 序列化失败")) }
        do {
            try AtomicFile.write(out, to: roots.settingsFile, durability: .standard)
            return .success(())
        } catch {
            return .failure(.ioError("\(error)"))
        }
    }
}
