// 镜像池目录事实备忘（chat-data.md 登记⑩，聊天扫描风暴根治 2026-07-14）——共享归档池（§6.5）被 legacy
// 归档回收灌到 ~600 目录/12 万 .jsonl 后，ChatStore.facts() 每查询/每 refresh 的全量逐文件 stat 成为
// ~150% CPU 稳态风暴（live CC 持续写盘 → FSEvents → refresh 背靠背连轴扫）。本备忘按**目录 mtime**
// 命中即复用整目录 DirFact，跳过 contentsOfDirectory + 逐文件 stat + displayPath 链。
//
// 正确性前提（只对共享池成立，**CC 侧禁注入**）：池内唯一写原语 = atomicCopy temp+rename(2) / removeItem，
// 任何增删换**必更目录 mtime**；live CC 会话是原地 append（目录 mtime 不动），此缓存对其语义不兼容——
// ChatStore 只把本备忘传给 mirror scanner，cc scanner 恒 nil。
//
// 三件套语义：
//  · 热窗（racy-clean，仿 make/git）：目录 mtime 距 now < 2s 不落存（每次真算）——防「扫描与 rename 同 ms
//    竞态」致条目永久 stale；带符号比较，未来 mtime（钟回拨）恒落热窗，只降性能不错缓存。
//  · per-目录脏集合（替代单飞 generation——generation 有并发排序洞会致 DB 永久漏更新）：重算产出与缓存
//    不等 / 首见 / 消失（sweep）→ 该目录入 dirtyDirs。等值判定 = DirFact **全字段**（含 dirMtimeMs）——
//    纯 mtime bump（如孤儿 temp 清扫）会多一轮无谓 delta，保守可接受（登记⑩设计内）。
//  · reconcile 计划单点消费：consumePlan() 初始 .full（首轮必全量），此后返回 .delta(脏集)（空集 = 跳过）。
//    消费方（ChatStore refresh 道）**consume 先于扫描**——fs 持久，mark 早于 consume 的变更必被 consume
//    后的扫描看到；本轮扫描新产生的脏留待下轮（≤1 刷新周期延迟，仅 mirror 行，archiveOnly 面无感）。
//    失败 restore() 回灌、force 道完成后 requestFull()（与 refresh 并发的旧 facts 可复活已删行，下轮全量自愈）。
import Foundation

public final class DirFactMemo: @unchecked Sendable {
    /// fact == nil 哨兵 = 目录存在但无 .jsonl（§1.1 丢弃，不产 DirFact）——照样缓存，免每轮重枚举空目录。
    private struct Entry {
        let mtimeMs: Int64
        let fact: ChatDirectoryScanner.DirFact?
    }

    /// mirror reconcile 计划（消费自 consumePlan()）。.delta(空集) = 本轮跳过 reconcile。
    public enum Plan: Sendable, Equatable {
        case full
        case delta(Set<String>)
    }

    /// 热窗宽度：目录 mtime 距 now 小于此值不落存（racy-clean）。
    static let hotWindowMs: Int64 = 2000

    private let lock = NSLock()
    private var cache: [String: Entry] = [:]
    private var dirtyDirs: Set<String> = []
    private var fullRequested = true  // 初始 .full：进程首轮必全量 reconcile（缓存冷、DB 陈旧度未知）
    private let now: @Sendable () -> Int64

    /// `now` 毫秒时钟可注入（测试得确定性热窗断言；生产缺省真时钟）。
    public init(now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.now = now
    }

    /// 命中 (dirName, dirMtimeMs) → 复用缓存 DirFact（含 nil 哨兵）；miss → `compute()` 真扫。
    /// compute 锁外执行（不持锁做目录 IO）；并发 miss 各自算、末者胜（同 mtime 值一致，无害）。
    /// dirMtimeMs 取**扫描前快照**（compute 期间目录再变 → 下轮按新 mtime 必 miss，无 stale 窗）。
    public func fact(
        dirName: String, dirMtimeMs: Int64, compute: () -> ChatDirectoryScanner.DirFact?
    ) -> ChatDirectoryScanner.DirFact? {
        lock.lock()
        if let hit = cache[dirName], hit.mtimeMs == dirMtimeMs {
            lock.unlock()
            return hit.fact
        }
        lock.unlock()
        let value = compute()
        lock.lock()
        let previous = cache[dirName]
        if previous == nil || previous!.fact != value {
            dirtyDirs.insert(dirName)  // 首见（含热窗常驻目录）/ 变更 → 置脏
        }
        if now() - dirMtimeMs >= Self.hotWindowMs {
            cache[dirName] = Entry(mtimeMs: dirMtimeMs, fact: value)
        } else {
            cache.removeValue(forKey: dirName)  // 热目录不落存（下轮真算；首见规则令其每轮入脏集，delta 恒覆盖）
        }
        lock.unlock()
        return value
    }

    /// 扫描收尾：缓存键不在本次枚举集 → 整目录消失，逐出 + 置脏（消失不产生 miss，必须显式扫尾）。
    /// base 不可枚举时以 visited=[] 调用 → 全部逐出置脏（对齐原行为「mirror 空 → 清理陈旧行」，晚一轮生效）。
    public func sweepAbsent(visited: Set<String>) {
        lock.lock()
        for key in cache.keys where !visited.contains(key) {
            cache.removeValue(forKey: key)
            dirtyDirs.insert(key)
        }
        lock.unlock()
    }

    /// 消费本轮 mirror reconcile 计划（一次性：取走即清）。.full 同时吞掉脏集（全量重校超集）。
    public func consumePlan() -> Plan {
        lock.lock()
        defer { lock.unlock() }
        if fullRequested {
            fullRequested = false
            dirtyDirs.removeAll()
            return .full
        }
        let dirs = dirtyDirs
        dirtyDirs.removeAll()
        return .delta(dirs)
    }

    /// reconcile 失败回灌（consume 后任一步 throw）：脏不静默丢，下轮重试。
    public func restore(_ plan: Plan) {
        lock.lock()
        switch plan {
        case .full: fullRequested = true
        case .delta(let dirs): dirtyDirs.formUnion(dirs)
        }
        lock.unlock()
    }

    /// 请求下轮全量重校（force 道 warmup/archiveBackfill 完成后调——它们不进单飞槽，与 refresh 并发时
    /// 旧 facts 快照后到可复活已删行，而 memo 已缓存新态不再 miss，须显式全量自愈）。
    public func requestFull() {
        lock.lock()
        fullRequested = true
        lock.unlock()
    }
}
