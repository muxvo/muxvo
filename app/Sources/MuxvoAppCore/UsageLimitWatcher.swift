// UsageLimitWatcher：CC 用量预警监测器（usage-limit-alert.md §4）。
//
// 15s 定时轮询 `<dataRoot>/run/usage-status.json`（传感器脚本产出，§2）→ 阈值边沿检测 → notify。
// **定时轮询而非 DispatchSource**：~20 会话 × 300ms 防抖高频重写 + rename 换 inode 需反复重挂，
// 15s 延迟对 90% 边沿足够；timer 工厂注入（镜像 DockBadgeController 体例，测试手动 checkNow()，
// 绝不起真 timer）。watcher **常开**：文件缺失/未安装 = no-op（§6，中途菜单启用无需重启）。
//
// 边沿语义（§4）：每窗口独立，key=(window, resetsAt, level)，level∈{90,99}，跨阈值首次 fire 一次；
// 再武装 = resetsAt 变化（老 key 按当前 resetsAt 清理）或 pct 回落 < level−5（滞回）。误报双守卫：
// writtenAtMs 陈旧（>10min，会话全停）整轮跳过；resetsAt 已过期（≤now）单窗口跳过。
// 只提示、绝不迁移任何状态（§5 only-notify 纪律）。
import Foundation

/// 限额窗口种类（§1：CC unified rate limit 的两个窗口）。
public enum UsageWindowKind: String, CaseIterable, Sendable {
    case fiveHour
    case sevenDay

    public var displayName: String {
        switch self {
        case .fiveHour: return "5 小时窗口"
        case .sevenDay: return "每周限额"
        }
    }
}

/// 单窗口读数（传感器文件里的一个窗口键，§2 形状）。
public struct UsageWindowReading: Equatable, Sendable {
    public let usedPct: Double
    public let resetsAt: Int64 // epoch 秒（CC 线格式，同 rate_limit_event 口径）

    public init(usedPct: Double, resetsAt: Int64) {
        self.usedPct = usedPct
        self.resetsAt = resetsAt
    }
}

/// 传感器产出全量（usage-status.json，§2）。窗口键可缺（API-key 账号无 rate_limits）。
public struct UsageStatus: Equatable, Sendable {
    public let writtenAtMs: Int64
    public let fiveHour: UsageWindowReading?
    public let sevenDay: UsageWindowReading?

    public init(writtenAtMs: Int64, fiveHour: UsageWindowReading?, sevenDay: UsageWindowReading?) {
        self.writtenAtMs = writtenAtMs
        self.fiveHour = fiveHour
        self.sevenDay = sevenDay
    }
}

/// 一次预警（notify 载荷）。level = 触发的阈值档（90 或 99；2026-07-12 用户拍板 95→90）。
public struct UsageAlert: Equatable, Sendable {
    public let window: UsageWindowKind
    public let usedPct: Double
    public let resetsAt: Int64
    public let level: Int

    public init(window: UsageWindowKind, usedPct: Double, resetsAt: Int64, level: Int) {
        self.window = window
        self.usedPct = usedPct
        self.resetsAt = resetsAt
        self.level = level
    }
}

/// 预警文案（§5）：横幅与 app 内弹窗共用同一生成器（措辞 1:1，两出口不漂移）。
public enum UsageAlertText {
    public static func title(_ alert: UsageAlert) -> String {
        alert.level >= 99 ? "额度马上用尽" : "额度即将用尽"
    }

    /// 正文：「5 小时窗口已用 96%（账号 x@y），约 14:30 重置。建议现在在任一终端 /login 换号（一次全局生效）。」
    public static func body(_ alert: UsageAlert, accountEmail: String?) -> String {
        let pct = Int(alert.usedPct.rounded())
        let acct = accountEmail.map { "（账号 \($0)）" } ?? ""
        let reset = resetTimeText(resetsAtSec: alert.resetsAt)
        return "\(alert.window.displayName)已用 \(pct)%\(acct)，约 \(reset) 重置。" +
            "建议现在在任一终端 /login 换号（一次全局生效）。"
    }

    /// 重置时刻本地化短文案：当天 → "HH:mm"；跨天 → "M月d日 HH:mm"。
    static func resetTimeText(resetsAtSec: Int64, now: Date = Date()) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(resetsAtSec))
        let fmt = DateFormatter()
        fmt.dateFormat = Calendar.current.isDate(date, inSameDayAs: now) ? "HH:mm" : "M月d日 HH:mm"
        return fmt.string(from: date)
    }
}

@MainActor
public final class UsageLimitWatcher {
    /// 阈值/滞回/陈旧上限/轮询周期（§4，集中一处）。
    public enum Constants {
        public static let thresholds: [Int] = [90, 99] // 2026-07-12 用户拍板 95→90（99 加急不动）
        public static let hysteresis: Double = 5
        public static let staleMs: Int64 = 10 * 60 * 1000
        public static let pollSeconds: TimeInterval = 15
    }

    /// 边沿登记状态（已 fire 的 key 集合；key = "<window>.<resetsAt>.<level>"）。
    public struct State: Equatable, Sendable {
        public var fired: Set<String>
        public init(fired: Set<String> = []) { self.fired = fired }
    }

    private let usageStatusURL: URL
    private let now: () -> Int64
    private let makeTimer: (TimeInterval, @escaping @MainActor () -> Void) -> DockBadgeTimer
    private let notify: (UsageAlert) -> Void
    private var timer: DockBadgeTimer?
    private(set) var state = State()

    /// - Parameters:
    ///   - usageStatusURL: 传感器产出文件（StatusLineScript.usageStatusURL 唯一派生）。
    ///   - now: epoch ms 时钟（测试注入假时钟）。
    ///   - makeTimer: 定时器工厂（生产 RealDockBadge.makeTimer；测试注入替身、手动 checkNow）。
    ///   - notify: 预警出口（生产 = 横幅 + app 内弹窗，§5）。
    public init(
        usageStatusURL: URL,
        now: @escaping () -> Int64,
        makeTimer: @escaping (TimeInterval, @escaping @MainActor () -> Void) -> DockBadgeTimer,
        notify: @escaping (UsageAlert) -> Void
    ) {
        self.usageStatusURL = usageStatusURL
        self.now = now
        self.makeTimer = makeTimer
        self.notify = notify
    }

    /// 起 15s 轮询（幂等；立即先查一次——启动时文件里可能已是 ≥90 态）。
    public func start() {
        guard timer == nil else { return }
        timer = makeTimer(Constants.pollSeconds) { [weak self] in self?.checkNow() }
        checkNow()
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// 读文件 → parse → decide → notify（文件缺失/解析失败 = no-op，§4）。
    public func checkNow() {
        guard let data = try? Data(contentsOf: usageStatusURL),
              let status = Self.parse(data) else { return }
        let (alerts, newState) = Self.decide(state: state, status: status, nowMs: now())
        state = newState
        for alert in alerts { notify(alert) }
    }

    // MARK: 纯函数（§4，直测面）

    /// usage-status.json → UsageStatus（形状不符 → nil，容忍窗口键缺失）。
    public static func parse(_ data: Data) -> UsageStatus? {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let writtenAt = (obj["writtenAtMs"] as? NSNumber)?.int64Value else { return nil }
        return UsageStatus(
            writtenAtMs: writtenAt,
            fiveHour: parseWindow(obj["fiveHour"]),
            sevenDay: parseWindow(obj["sevenDay"]))
    }

    private static func parseWindow(_ raw: Any?) -> UsageWindowReading? {
        guard let dict = raw as? [String: Any],
              let pct = (dict["usedPct"] as? NSNumber)?.doubleValue,
              let resets = (dict["resetsAt"] as? NSNumber)?.int64Value else { return nil }
        return UsageWindowReading(usedPct: pct, resetsAt: resets)
    }

    /// 边沿判定（§4）：陈旧整轮跳过（不动登记）；每窗口过期跳过；跨阈值首次 fire + 滞回再武装 +
    /// resetsAt 变化清老 key。返回本轮应发预警（fiveHour 先、level 升序，确定性）与新状态。
    public static func decide(
        state: State, status: UsageStatus, nowMs: Int64
    ) -> (alerts: [UsageAlert], state: State) {
        guard nowMs - status.writtenAtMs <= Constants.staleMs else { return ([], state) }
        var newState = state
        var alerts: [UsageAlert] = []
        let readings: [(UsageWindowKind, UsageWindowReading?)] = [
            (.fiveHour, status.fiveHour), (.sevenDay, status.sevenDay),
        ]
        for (kind, maybeReading) in readings {
            guard let reading = maybeReading else { continue }
            // resetsAt 变化 → 该窗口老 key 全部清理（窗口重置/换号即自然再武装）。
            let currentPrefix = "\(kind.rawValue).\(reading.resetsAt)."
            newState.fired = Set(newState.fired.filter {
                !$0.hasPrefix("\(kind.rawValue).") || $0.hasPrefix(currentPrefix)
            })
            // 已过期窗口（文件未刷新）不告警（§4 误报守卫②）。
            guard reading.resetsAt * 1000 > nowMs else { continue }
            for level in Constants.thresholds {
                let key = "\(currentPrefix)\(level)"
                if reading.usedPct >= Double(level) {
                    guard !newState.fired.contains(key) else { continue }
                    newState.fired.insert(key)
                    alerts.append(UsageAlert(
                        window: kind, usedPct: reading.usedPct,
                        resetsAt: reading.resetsAt, level: level))
                } else if reading.usedPct < Double(level) - Constants.hysteresis {
                    newState.fired.remove(key) // 滞回再武装
                }
            }
        }
        return (alerts, newState)
    }
}
