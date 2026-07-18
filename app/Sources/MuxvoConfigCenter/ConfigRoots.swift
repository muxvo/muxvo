// 配置资源根注入（M6 批1）。生产从 home 派生，测试指 $TMPDIR fixture 根——ConfigCenter 只认这里
// 给的 URL，绝不硬编码真实 ~/.claude（测试永不触碰用户真配置，数据目录隔离纪律）。
import Foundation

/// 配置面数据源根集合。四 MCP 源 + claudeRoot（skills/settings/plugins 派生）。
public struct ConfigRoots: Sendable {
    /// ~/.claude —— skills / settings.json / plugins 的父根，亦是资源读写白名单根。
    public let claudeRoot: URL
    /// ~/.claude.json —— global MCP（唯一可写源）。
    public let globalMcpFile: URL
    /// ~/Library/Application Support/Claude/claude_desktop_config.json —— desktop MCP（只读）。
    public let desktopMcpFile: URL
    /// ~/.codex/config.toml —— codex MCP（只读，手写 TOML 子集解析）。
    public let codexConfigFile: URL
    /// ~/.gemini/settings.json —— gemini MCP（只读）。
    public let geminiSettingsFile: URL

    public init(
        claudeRoot: URL, globalMcpFile: URL, desktopMcpFile: URL,
        codexConfigFile: URL, geminiSettingsFile: URL
    ) {
        self.claudeRoot = claudeRoot
        self.globalMcpFile = globalMcpFile
        self.desktopMcpFile = desktopMcpFile
        self.codexConfigFile = codexConfigFile
        self.geminiSettingsFile = geminiSettingsFile
    }

    /// 生产：从 home 目录派生全部根（legacy useMcpConfig/usePluginConfig 亲验路径）。
    public static func production(
        home: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> ConfigRoots {
        ConfigRoots(
            claudeRoot: home.appendingPathComponent(".claude"),
            globalMcpFile: home.appendingPathComponent(".claude.json"),
            desktopMcpFile: home.appendingPathComponent(
                "Library/Application Support/Claude/claude_desktop_config.json"),
            codexConfigFile: home.appendingPathComponent(".codex/config.toml"),
            geminiSettingsFile: home.appendingPathComponent(".gemini/settings.json"))
    }

    // MARK: 派生路径

    /// skills 扫描根：~/.claude/skills（含 SKILL.md 的子目录即一个 skill 资源）。
    public var skillsRoot: URL { claudeRoot.appendingPathComponent("skills") }
    /// ~/.claude/settings.json（getSettings/saveSettings + hooks + enabledPlugins 单一文件）。
    public var settingsFile: URL { claudeRoot.appendingPathComponent("settings.json") }
    /// ~/.claude/plugins（installed_plugins.json + marketplaces）。
    public var pluginsRoot: URL { claudeRoot.appendingPathComponent("plugins") }
    /// ~/.claude/plugins/installed_plugins.json（{plugins:{key:[record]}}）。
    public var installedPluginsFile: URL {
        pluginsRoot.appendingPathComponent("installed_plugins.json")
    }
    /// marketplace 回退 manifest 根：~/.claude/plugins/marketplaces。
    public var marketplacesRoot: URL { pluginsRoot.appendingPathComponent("marketplaces") }

    /// 资源读写白名单根：readResource/listResourceDir/writeResource 的解析路径须落在此子树内。
    public var resourceWhitelistRoot: URL { claudeRoot }
}
