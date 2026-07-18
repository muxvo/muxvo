// ~/.claude 资源变化监视器（M6 批1，CONFIG_L1_08）。FSEventStream 监 claudeRoot 递归变化，按路径分类
// 资源类型（skills/settings/plugins/mcp）去抖合并后回调 → 装配层转 data.event configResourcesChanged。
//
// 可测性：分类（classify）为纯静态函数；去抖合并核心（ingest/flushPending）与真 FSEvent 解耦——生产由
// FSEvent 回调喂 ingest + asyncAfter 调 flushPending，测试直驱 ingest + flushPending 确定性验（不起真 FS）。
import Foundation

/// @unchecked Sendable：去抖态（pending/flushScheduled）收敛到单串行 queue 访问，仿 WaitDetectorHub 模式。
public final class ResourceWatcher: @unchecked Sendable {
    /// 变化回调：单资源类型（去抖合并后每类至多一次）。装配层转 DataEvent.configResourcesChanged。
    /// @Sendable：从后台 queue 触发（生产）；装配层闭包 hop main 施加副作用。
    public typealias OnChange = @Sendable (String) -> Void

    private let claudeRoot: URL
    private let debounce: DispatchTimeInterval
    private let onChange: OnChange
    private let queue = DispatchQueue(label: "com.muxvo.config.watcher")

    // 去抖合并态（queue 串行访问）。
    private var pending: Set<String> = []
    private var flushScheduled = false

    private var stream: FSEventStreamRef?

    public init(
        claudeRoot: URL,
        debounceMs: Int = 250,
        onChange: @escaping OnChange
    ) {
        self.claudeRoot = claudeRoot
        self.debounce = .milliseconds(debounceMs)
        self.onChange = onChange
    }

    // MARK: - 生产：FSEventStream 生命周期

    /// 起 FSEventStream 监 claudeRoot（递归）。目录不存在也不报错——变化会在目录出现后由父层监到（生产
    /// claudeRoot 恒存在）；起流失败静默降级（watcher 退化为不推送，面板仍可手动 reload）。
    public func start() {
        guard stream == nil else { return }
        let info = Unmanaged.passRetained(self).toOpaque()
        var context = FSEventStreamContext(
            version: 0, info: info, retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, clientInfo, count, eventPaths, _, _ in
            guard let clientInfo else { return }
            let watcher = Unmanaged<ResourceWatcher>.fromOpaque(clientInfo).takeUnretainedValue()
            // eventPaths 只有带 UseCFTypes flag 才是 CFArray<CFString>（toll-free 桥 NSArray）；
            // 不带时是裸 char**，此 cast 首个真实事件即野指针 SIGSEGV（2026-07-07-083011.ips）。
            guard let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] else { return }
            _ = count
            watcher.queue.async { watcher.ingest(paths: paths) }
        }
        guard let stream = FSEventStreamCreate(
            kCFAllocatorDefault, callback, &context,
            [claudeRoot.path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.2,
            FSEventStreamCreateFlags(
                kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer
                    | kFSEventStreamCreateFlagUseCFTypes))
        else {
            Unmanaged<ResourceWatcher>.fromOpaque(info).release()
            return
        }
        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
    }

    public func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    deinit { stop() }

    // MARK: - 去抖合并核心（测试直驱）

    /// 喂入一批变化路径：分类 + 累积到 pending，调度一次去抖 flush。
    func ingest(paths: [String]) {
        let types = paths.compactMap { Self.classify(path: $0, claudeRoot: claudeRoot) }
        guard !types.isEmpty else { return }
        pending.formUnion(types)
        guard !flushScheduled else { return }
        flushScheduled = true
        queue.asyncAfter(deadline: .now() + debounce) { [weak self] in self?.flushPending() }
    }

    /// 冲刷 pending：每资源类型回调一次后清空（去抖合并语义——一窗内多次同类变化只推一次）。
    /// internal 供测试确定性直调（绕真 timer）。
    func flushPending() {
        let types = pending
        pending.removeAll()
        flushScheduled = false
        for type in types.sorted() { onChange(type) }
    }

    // MARK: - 分类（纯静态，测试直验）

    /// 变化路径 → 资源类型字符串（skills/settings/plugins/mcp）。落在 claudeRoot 外或不识别 → nil。
    /// 规则：<root>/skills/** → skills；<root>/plugins/** → plugins；<root>/settings.json → settings；
    /// <root>/settings.local.json → settings；其余 <root>/** → nil（不推未识别类型）。
    static func classify(path: String, claudeRoot: URL) -> String? {
        let root = claudeRoot.standardizedFileURL.path
        let full = URL(fileURLWithPath: path).standardizedFileURL.path
        guard full == root || full.hasPrefix(root + "/") else { return nil }
        let rel = full == root ? "" : String(full.dropFirst(root.count + 1))
        if rel.hasPrefix("skills/") || rel == "skills" { return "skills" }
        if rel.hasPrefix("plugins/") || rel == "plugins" { return "plugins" }
        if rel == "settings.json" || rel == "settings.local.json" { return "settings" }
        return nil
    }
}
