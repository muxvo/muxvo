// ConfigCenter：配置面数据中枢（M6 批1）。skills 扫描 / 资源读写（路径白名单 + AtomicFile）/
// settings.json 读写。MCP 与 plugins 在扩展文件（ConfigCenter+Mcp / ConfigCenter+Plugins）。
//
// 分层：产出 MuxvoBridge Gen 视图类型（ResourceItem/McpServerView/PluginView/ConfigDirEntry）——即
// config.request 的数据契约，装配层（AppCore ConfigRequestHandler）只做 Result→ConfigResponse 包裹。
// 同步方法（小配置文件读写在调用侧 @MainActor 上下文可接受，仿 BundleWebSchemeHandler 同步小文件读）。
//
// 容错（继承 legacy useMcpConfig/usePluginConfig catch→[] 口径）：读缺失/解析失败一律优雅降级
// （空列表 / 缺省），绝不崩。写走 AtomicFile（tmp→fsync→rename），失败回 .ioError。
import Foundation
import MuxvoBridge
import MuxvoStorage

/// ConfigCenter 拒绝原因（AppCore 映射到 ConfigResponse.rejected(code,message)）。
public enum ConfigCenterError: Error, Equatable, Sendable {
    /// 路径落在资源白名单根外（防目录穿越）。
    case pathRejected(String)
    /// 目标不存在或不可读。
    case notFound(String)
    /// 写失败 / 序列化失败 / 非法 JSON。
    case ioError(String)
    /// 只读源不可写（mcpSave/mcpDelete 非 global；一般不该发生，AppCore 侧已限）。
    case readOnlySource(String)

    /// 机器可读码（ConfigResponse.rejected.code）。
    public var code: String {
        switch self {
        case .pathRejected: return "PATH_REJECTED"
        case .notFound: return "NOT_FOUND"
        case .ioError: return "IO_ERROR"
        case .readOnlySource: return "READ_ONLY_SOURCE"
        }
    }

    public var message: String {
        switch self {
        case let .pathRejected(p): return "路径超出资源根：\(p)"
        case let .notFound(p): return "资源不存在或不可读：\(p)"
        case let .ioError(m): return "写入失败：\(m)"
        case let .readOnlySource(m): return "只读源不可写：\(m)"
        }
    }
}

public final class ConfigCenter {
    public let roots: ConfigRoots

    public init(roots: ConfigRoots) {
        self.roots = roots
    }

    // MARK: - 资源列表（skills）

    /// 按类型扫描资源（CONFIG_L1_01）。当前 ResourceType 仅 skills：~/.claude/skills 下含 SKILL.md 的
    /// 子目录即一资源（name=目录名 / path=目录绝对路径 / type="skills"），目录名升序稳定。
    public func listResources(types: [ResourceType]) -> [ResourceItem] {
        var out: [ResourceItem] = []
        for type in types {
            switch type {
            case .skills:
                out += Self.scanSkills(root: roots.skillsRoot)
            }
        }
        return out
    }

    static func scanSkills(root: URL) -> [ResourceItem] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
        else { return [] }
        var out: [ResourceItem] = []
        for dir in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else { continue }
            let skillMd = dir.appendingPathComponent("SKILL.md")
            guard fm.fileExists(atPath: skillMd.path) else { continue }
            out.append(ResourceItem(
                name: dir.lastPathComponent, path: dir.path, type: ResourceType.skills.rawValue))
        }
        return out
    }

    // MARK: - 资源读（CONFIG_L1_02）/ 目录列 / 写（白名单）

    /// 读单个资源（CONFIG_L1_02）。路径白名单守卫（资源根外 rejected）；format 按扩展名推断。
    public func readResource(path: String)
        -> Result<(content: String, format: ResourceFormat), ConfigCenterError>
    {
        guard let url = whitelistedURL(path) else { return .failure(.pathRejected(path)) }
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8)
        else { return .failure(.notFound(path)) }
        return .success((text, Self.format(forExtension: url.pathExtension)))
    }

    /// 列资源子目录（skill 文件树用）。白名单守卫；文件夹优先无关（web 侧排序），此处按名升序稳定。
    public func listResourceDir(path: String) -> Result<[ConfigDirEntry], ConfigCenterError> {
        guard let url = whitelistedURL(path) else { return .failure(.pathRejected(path)) }
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else {
            return .failure(.notFound(path))
        }
        guard let entries = try? fm.contentsOfDirectory(
            at: url, includingPropertiesForKeys: [.isDirectoryKey], options: [])
        else { return .success([]) }
        let out = entries
            .sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
            .map { entry -> ConfigDirEntry in
                var d: ObjCBool = false
                _ = fm.fileExists(atPath: entry.path, isDirectory: &d)
                return ConfigDirEntry(name: entry.lastPathComponent, isDirectory: d.boolValue)
            }
        return .success(out)
    }

    /// 写资源（skill 编辑保存）。白名单守卫；AtomicFile 原子写（tmp→fsync→rename）。
    public func writeResource(path: String, content: String) -> Result<Void, ConfigCenterError> {
        guard let url = whitelistedURL(path) else { return .failure(.pathRejected(path)) }
        do {
            try AtomicFile.write(Data(content.utf8), to: url, durability: .standard)
            return .success(())
        } catch {
            return .failure(.ioError("\(error)"))
        }
    }

    // MARK: - settings.json（CONFIG_L1_03/04）

    /// 读 settings.json 全文（CONFIG_L1_03）。缺失/不可读 → "{}"（优雅降级，web 侧按空对象处理）。
    public func getSettings() -> String {
        guard let data = try? Data(contentsOf: roots.settingsFile),
              let s = String(data: data, encoding: .utf8)
        else { return "{}" }
        return s
    }

    /// 写 settings.json（CONFIG_L1_04）。校验为合法 JSON 对象（防写坏 settings），写原始字节（round-trip
    /// 保真，不重序列化）。AtomicFile 原子写。
    public func saveSettings(json: String) -> Result<Void, ConfigCenterError> {
        let data = Data(json.utf8)
        guard let obj = try? JSONSerialization.jsonObject(with: data), obj is [String: Any] else {
            return .failure(.ioError("settings JSON 非法（须为对象）"))
        }
        do {
            try AtomicFile.write(data, to: roots.settingsFile, durability: .standard)
            return .success(())
        } catch {
            return .failure(.ioError("\(error)"))
        }
    }

    // MARK: - 内部辅助

    /// 路径白名单：展开 ~、解析符号链接后须落在资源根（claudeRoot）子树内，否则 nil（→ pathRejected）。
    /// 防 `..` 穿越 + 绝对路径逃逸。解析符号链接（非仅 standardize）令 listResources 产出的路径（经
    /// FileManager 已解析祖先符号链接，如 /var→/private/var）能被 readResource 白名单接受——两侧同款
    /// resolvingSymlinksInPath 归一后前缀比对（生产 claudeRoot 无符号链接祖先，等价 standardize）。
    func whitelistedURL(_ path: String) -> URL? {
        let expanded = (path as NSString).expandingTildeInPath
        // 先 standardize（词法去 `..`/`.`）再解析符号链接：防 `<root>/../etc` 类穿越 + 归一 /var→/private/var。
        let url = URL(fileURLWithPath: expanded).standardizedFileURL.resolvingSymlinksInPath()
        let root = roots.resourceWhitelistRoot.standardizedFileURL.resolvingSymlinksInPath()
        guard url.path == root.path || url.path.hasPrefix(root.path + "/") else { return nil }
        return url
    }

    /// 扩展名 → ResourceFormat（md|json|sh|other）。
    static func format(forExtension ext: String) -> ResourceFormat {
        switch ext.lowercased() {
        case "md", "markdown": return .md
        case "json": return .json
        case "sh", "bash", "zsh": return .sh
        default: return .other
        }
    }
}
