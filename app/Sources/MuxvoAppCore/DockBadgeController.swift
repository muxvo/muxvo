// Dock 徽标控制器（M6 批1 步骤5）。从 TerminalService.updateDockBadge（原恒实时）抽出，支持三模式
// off|realtime|timed。行为亲验 legacy src/main/services/dock-badge.ts：
//   - onStateChange（= update(waitingCount:)）：off 不动徽标；realtime/timed 即时刷。
//   - reconfigure：停 timer；off 清徽标；timed 起 interval 分钟 timer；均即时刷一次。
//   - updateBadge（= applyBadge）：off 清；否则强信号等待数 >0 显数字，=0 清。
//   - timed 额外起 interval 分钟 timer 周期采样最新计数落徽标（onStateChange 亦即时刷，同 legacy）。
// timer 工厂注入 init（测试手动 tick，绝不起真 RunLoop timer）。OrchNotifier 不动（两写者边界）。
import AppKit
import Foundation
import MuxvoBridge

/// Dock 徽标定时器接缝（生产 RunLoop Timer；测试注入替身手动 tick）。
@MainActor
public protocol DockBadgeTimer: AnyObject {
    func invalidate()
}

@MainActor
public final class DockBadgeController {
    /// 徽标落点：nil = 清除，非 nil = 显示该文案（生产经 DockTileRenderer 自绘 Dock tile）。
    public typealias BadgeSetter = (String?) -> Void
    /// timer 工厂：(周期秒, 到点回调) → 计时器句柄。
    public typealias TimerFactory = (TimeInterval, @escaping @MainActor () -> Void) -> DockBadgeTimer

    private var mode: DockBadgeMode
    private var intervalMin: Int
    private var latestCount = 0
    private let setBadge: BadgeSetter
    private let makeTimer: TimerFactory
    private var timer: DockBadgeTimer?

    public init(
        mode: DockBadgeMode, intervalMin: Int,
        setBadge: @escaping BadgeSetter, makeTimer: @escaping TimerFactory
    ) {
        self.mode = mode
        self.intervalMin = intervalMin
        self.setBadge = setBadge
        self.makeTimer = makeTimer
        // 初始态一致（off 清 / timed 起 timer / realtime 按当前 count 刷）。
        reconfigure(mode: mode, intervalMin: intervalMin)
    }

    /// 强信号等待终端数变化（TerminalService.deliver 喂）。legacy onStateChange：off 不动徽标，其余即时刷。
    public func update(waitingCount: Int) {
        latestCount = waitingCount
        guard mode != .off else { return }
        applyBadge()
    }

    /// 模式/间隔切换（ConfigModel.onPrefsChanged）。legacy reconfigure：停 timer；off 清；timed 起 timer；均即时刷。
    public func reconfigure(mode: DockBadgeMode, intervalMin: Int) {
        self.mode = mode
        self.intervalMin = intervalMin
        stopTimer()
        switch mode {
        case .off:
            setBadge(nil)
        case .realtime:
            applyBadge()
        case .timed:
            startTimer()
            applyBadge()
        }
    }

    /// legacy updateBadge：off 清；否则最新强信号等待数 >0 显数字，=0 清。
    private func applyBadge() {
        guard mode != .off else { setBadge(nil); return }
        setBadge(latestCount > 0 ? String(latestCount) : nil)
    }

    private func startTimer() {
        stopTimer()
        guard mode == .timed else { return }
        // legacy：Math.max(1, intervalMin) * 60 * 1000 ms → 本实现秒（timer 工厂取秒）。
        let seconds = TimeInterval(max(1, intervalMin) * 60)
        timer = makeTimer(seconds) { [weak self] in self?.applyBadge() }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}

// MARK: - 生产 timer（RunLoop）

public enum RealDockBadge {
    /// 生产 Dock 徽标落点：经 DockTileRenderer 自绘 contentView（macOS 26 bundle-id 级 badgeLabel
    /// 抑制规避，wait-detector.md §8；不写 badgeLabel——健康机器上系统叠画会与自绘成双角标）。
    @MainActor
    public static func setBadge(_ label: String?) {
        DockTileRenderer.shared.setBadgeText(label)
    }

    /// 生产 timer 工厂：RunLoop.main .common 模式周期 timer。
    @MainActor
    public static func makeTimer(
        _ interval: TimeInterval, _ fire: @escaping @MainActor () -> Void
    ) -> DockBadgeTimer {
        RealDockBadgeTimer(interval: interval, fire: fire)
    }
}

@MainActor
private final class RealDockBadgeTimer: DockBadgeTimer {
    private var timer: Timer?

    init(interval: TimeInterval, fire: @escaping @MainActor () -> Void) {
        let t = Timer(timeInterval: interval, repeats: true) { _ in
            MainActor.assumeIsolated { fire() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func invalidate() {
        timer?.invalidate()
        timer = nil
    }
}
