// TerminalSession：会话核心 = PTYHost + libghostty-vt terminal。
//
// 并发（设计附件 A §2.1）：每会话独立串行 DispatchQueue（非 actor）。所有触 C 的
// 调用收敛到该 queue，触 C 的私有方法用 dispatchPrecondition 断言在 queue 上。
// PTY 读回调在同 queue 上 feed vt，天然与 feed()/resize/dump 串行。C effects 回调
// （write_pty/bell/title/pwd）在 vt_write 内同步触发即已在 queue 上：write_pty 直接
// 回写 PTY fd；bell/title/pwd 拷贝后异步 hop 到 main。
//
// 隔离模式（spawnShell=false）：无 PTY，仅 vt 状态机，用 feed() 直接灌字节，供
// 测试/回放（OSC 序列直灌、乱码/scrollback 数据面校验）。
import CGhosttyVT
import CMuxvoPTY
import Darwin
import Dispatch
import Foundation
import MuxvoKit
import MuxvoTermCore
import os

public final class TerminalSession: @unchecked Sendable {
    /// libghostty `max_scrollback` 是**字节预算**，不是行数——ghostty 源码三处实证
    /// （Screen.zig「amount of scrollback to keep in bytes」/ PageList.zig「maximum number of bytes」/
    /// Config.zig `scrollback-limit` 默认 10_000_000 注释「in bytes」）；C 头注释 "number of lines" 不准。
    /// 用户裁决「全程 10000 行」(§6.2)：80 列下 ghostty 默认 10MB≈9131 行不足，取 12 MiB≈12041 行以
    /// 保证 ≥10000 行。scrollback 惰性分配（空闲≈0、峰值≤预算），故大预算不抬 bench 的边际内存。
    public static let maxScrollbackBytes = 12 * 1024 * 1024
    /// 用户裁决的历史行目标（§6.2 意图）；字节预算按此换算得来，非 libghostty 直接单位。
    public static let scrollbackTargetRows = 10_000
    /// 优雅关闭 grace 默认 5000ms（规格 §3.2；可经 config 注入缩短供测试）。
    public static let defaultCloseGraceMs = 5000
    /// 注入 cd pin 窗口默认 5000ms（F-B，terminal-session-restore.md 登记⑨）：覆盖注入时在飞字节
    /// （<100ms）+ 异步 prompt 插件（p10k gitstatus 类）门后 1-2s 重绘再发漂移 OSC7 的典型场景，留余量。
    public static let defaultCwdPinWindowMs: UInt64 = 5_000

    // MARK: 配置

    public struct Config {
        public var cols: UInt16 = 80
        public var rows: UInt16 = 24
        public var cwd: String?
        /// libghostty max_scrollback（**字节预算**，见 maxScrollbackBytes 注释）。
        public var maxScrollback: Int = TerminalSession.maxScrollbackBytes
        public var closeGraceMs: Int = TerminalSession.defaultCloseGraceMs
        /// 注入 cd pin 窗口 ms（登记⑨；测试可置 0=立即过期 / 大值=永不过期，免真 sleep）。
        public var cwdPinWindowMs: UInt64 = TerminalSession.defaultCwdPinWindowMs

        /// 终端配色主题（terminal-theme.md §5；缺省 dark）。init 注入 fg/bg/cursor/palette + colorScheme
        /// 应答值；运行时经 applyTheme 重注立即生效。TerminalService 建会话时按 config.terminal.themeName 置。
        public var theme: TermTheme = .dark

        /// true = 起真 PTY 子进程；false = 隔离模式（仅 vt，feed 直灌）。
        public var spawnShell: Bool = true
        /// 覆盖 exec 路径；nil → 解析 SHELL 兜底 /bin/zsh（login 路径）。
        public var executablePath: String?
        /// 覆盖 argv；nil → login shell argv（argv[0] `-` 前缀）。
        public var argv: [String]?
        /// env 合同装配的源环境；nil → 当前进程环境（测试可注入以断言删/增）。
        public var envSource: [String: String]?
        /// 叠加到 env 合同之上（测试用最终覆盖）。
        public var extraEnv: [String: String] = [:]

        // C effects → main 回调（预留接口；bell/title 目前仅转发）。
        public var onCwdChanged: (@Sendable (String) -> Void)?
        public var onBell: (@Sendable () -> Void)?
        public var onTitleChanged: (@Sendable (String) -> Void)?
        public var onExit: (@Sendable (PTYExit, Bool) -> Void)?

        public init() {}
    }

    // MARK: 状态

    public let id: SessionID
    public var pid: pid_t? { pty?.pid }

    private let queue: DispatchQueue
    private var term: OpaquePointer?
    private var pty: PTYHost?
    private let closeGraceMs: Int
    /// 渲染数据面唯一 updater（合同①②）。init 内在 queue 上建成后不再重赋 → 任意线程
    /// 读安全（currentFrame 从 draw 线程读）。alloc 失败则为 nil（渲染 API 退化为 no-op）。
    private var renderCoordinator: RenderCoordinator?
    /// 选区手势状态机（§4）+ 鼠标上报编码器（§5）——均 queue-confined，仅经会话 queue 访问。
    /// alloc 失败则为 nil（对应 API 退化为 no-op）。close 在 terminal_free 前统一 shutdown。
    private var selectionController: SelectionController?
    private var mouseReporter: MouseReporter?
    /// 终端内搜索引擎（§ terminal-search-bar M3）——queue-confined，与 feed 互斥。alloc 无失败点（纯 Swift）。
    private var searchEngine: TerminalSearchEngine?

    /// 注入 cd pin（登记⑨）：noteInjectedCwd 置；窗口内不匹配 OSC7 忽略、匹配即解、过期自动解除。
    /// internal 供决策纯函数单测构造。
    struct InjectedCwdPin: Equatable {
        let path: String
        let expiresAtMs: UInt64
    }

    /// handlePwdChanged 对入站 OSC7 的裁决（纯函数 cwdPinDecision 的返回域）。
    enum CwdPinDecision: Equatable {
        case accept              // 无 pin：正常接受
        case acceptAndClearPin   // 窗口已过期 / 与 pin 匹配：接受并解除 pin
        case ignore              // 窗口内且与 pin 不匹配：忽略（晚到漂移）
    }

    private let stateLock = NSLock()
    private var _cols: UInt16
    private var _rows: UInt16
    private var _cwd: String = ""
    /// 当前注入 cd pin（与 _cwd 同 stateLock；nil = 无 pin）。
    private var _injectedCwdPin: InjectedCwdPin?
    private let cwdPinWindowMs: UInt64
    /// WaitDetector 静默计时接缝（wait-detector.md §6）：最近一次 PTY 输出的 epoch ms（WaitClock 单一时钟）。
    /// feedOnQueue 每次输出刷新；poll 读作静默基准（自 lastActivity ≥30s + 前台非 shell + 无 hook 流 → 弱等待）。
    private var _lastOutputMs: UInt64 = WaitClock.nowMs()
    /// 是否发生过任何真实输出（F7 静默门的 nil 判据；初值时刻不算输出）。
    private var _hasOutput = false

    /// WaitDetector reset 接缝（wait-detector.md §3）：用户经公开 write() 写入 PTY 时回调（自应答走
    /// handleWritePty 另路、不经此）。TerminalService 装配时设，路由 hub.noteUserInput 清红（排除自应答）。
    /// 生产在输入线程（主线程）设与读；默认 nil = 无接线（既有行为不变）。
    public var onUserWrite: (@Sendable ([UInt8]) -> Void)?

    /// alt-screen 边沿信号（message-editor.md §1/§8）：feed 后 vt ACTIVE_SCREEN 由 primary↔alternate
    /// 翻转时回调（true=alternate）。在会话 queue（feedOnQueue 内）同步触发；TerminalService 装配时接、
    /// hop main 落 projection → ui.state.altScreen → web 切 RichEditor/RawTerminal 形态。默认 nil = 无接线。
    /// 与 onUserWrite 同：生产在装配时（feed 前）设，输入线程读——无并发改写窗口。
    public var onAltScreenChanged: (@Sendable (Bool) -> Void)?

    // effects 回调（config 注入，immutable → 任意线程可读）。
    private let cbCwd: (@Sendable (String) -> Void)?
    private let cbBell: (@Sendable () -> Void)?
    private let cbTitle: (@Sendable (String) -> Void)?
    private let cbExit: (@Sendable (PTYExit, Bool) -> Void)?

    // 退出同步（测试用）。
    private let exitSem = DispatchSemaphore(value: 0)
    private let exitLock = NSLock()
    private var _exitResult: (PTYExit, Bool)?

    // 隔离模式下 write_pty 回写内容（无 PTY 时供测试断言查询响应）。
    private var _writePtyCapture: [UInt8] = [] // 仅 queue 上访问

    /// resize 取证计数（m3-layout-r5 红锚观测席位，零行为影响）：
    /// request = resize() 每次进入（含 <10×2 被拒与同尺寸短路）；applied = vt 网格实际改变。
    /// 「每手势 ≤1 次已应用 resize」预算不变式的单测/e2e 断言读面。
    private var _resizeRequestCount: Int = 0
    private var _resizeAppliedCount: Int = 0
    public var resizeRequestCountForTest: Int { stateLock.withLock { _resizeRequestCount } }
    public var resizeAppliedCountForTest: Int { stateLock.withLock { _resizeAppliedCount } }
    /// 是否收到过 ≥10×2 的外部 resize（生产唯一驱动者 = 驱动态 TerminalSurfaceView.commitGrid，
    /// 故语义 =「首个 bounds 驱动的尺寸已达会话」；含同尺寸短路的幂等命中——tile 恰为 spawn 默认
    /// 80×24 时首次 sync 仍进本函数即算就绪；spawn 默认值本身不算；<10×2 被拒的退化 rect 不算）。
    /// 恢复/续聊注入的尺寸就绪门读此（terminal-session-restore.md 登记⑩）：PTY 仍是 spawn 默认
    /// 80×24 时注入 resume，回放整段按 80 列硬换行烧进 scrollback，变宽 reflow 救不回硬换行。
    private var _hasReceivedResize = false
    public var hasReceivedResize: Bool { stateLock.withLock { _hasReceivedResize } }
    /// 风暴哨兵滚动窗（m3-layout-r5 F5）：最近 1s 内已应用 resize 的时间戳。>2 → .error 持久告警
    /// ——手势预算不变式（每静止期每会话 ≤1 次已应用）的生产观测面，零行为影响。字号连击（zoom
    /// ramp）亦会触发：它同样逐步 reflow 活动 Ink 帧，是真实烧录信号而非误报（2026-07-07 现场
    /// 11:26 字号往返 20 连发实录）。
    private var _appliedStampsMs: [UInt64] = []

    /// 上次观测的 alt-screen 态（message-editor.md §1 边沿检测；仅 queue 上访问）。primary=false 初值。
    private var _altScreen = false

    /// 当前 colorScheme 存量（terminal-theme.md §7 CSI ?996n 应答）：init 从 config.theme.colorScheme
    /// 置、applyTheme 更新。queue-confined——仅 feedOnQueue 内的 vt colorScheme 回调（handleColorSchemeQuery）
    /// 与 applyColorOptionsOnQueue 读写，与 feed 串行，无并发窗口（bell/title trampoline 同款先例）。
    private var _colorScheme: TermColorScheme = .dark

    public var cols: UInt16 { stateLock.withLock { _cols } }
    public var rows: UInt16 { stateLock.withLock { _rows } }
    /// 会话 cwd（**双源**）：① OSC 7/9/1337 回调（handlePwdChanged，原始 `file://host/path` 字节）；
    /// ② 注入 cd 权威源（noteInjectedCwd，恢复/继续聊天注入 `cd -- '<path>'` 的落点，普通绝对路径）。空串 = 未设。
    public var cwd: String { stateLock.withLock { _cwd } }
    /// 最近一次 PTY 输出 epoch ms（WaitDetector 静默基准，§6）。会话建成前 = init 时刻。
    public var lastOutputMs: UInt64 { stateLock.withLock { _lastOutputMs } }
    /// 距最近一次真实输出的毫秒数；**从未输出过 → nil**（_lastOutputMs 初值=init 时刻，不算输出——
    /// F7 静默门以 nil 放行，隔离/空闲会话零影响）。
    public func msSinceLastOutput(now: UInt64 = WaitClock.nowMs()) -> UInt64? {
        stateLock.withLock { _hasOutput ? now &- _lastOutputMs : nil }
    }

    /// 注入 cd 写权威 cwd（F-B，terminal-session-restore.md 冻结面登记⑨）：恢复/继续聊天注入
    /// `cd -- '<path>' && <harness> resume <id>` 时，该 `cd` 与命令同行内执行**不产生新 OSC7**，其后
    /// harness TUI 接管亦无 OSC7——故注入 `cd` 的落点才是权威 cwd。协调层注入成功即调此把 `_cwd` 覆写为该
    /// 落点，令 §5 的 ~1s cwd 轮询（`UIStateProjection.refreshCwds` 读 `session.cwd`）收敛。
    ///
    /// **pin 窗口**（登记⑨修订，dogfood-r3 问题2）：仅覆写不足以对抗**晚到**的漂移 OSC7——注入 write()
    /// 只是排队字节即返回，`.zshrc` 漂移 cd / 异步 prompt 插件（p10k gitstatus 类）的 OSC7 可在本调用**之后**
    /// 到达，旧「最后写者胜」语义下会把 header 覆写回漂移目录且无人纠正（harness TUI 期间无后续 OSC7）。
    /// 故本调用同时置 pin：窗口（默认 5s）内 handlePwdChanged 忽略与落点不匹配的 OSC7；匹配（shell 真正
    /// 执行到注入 cd 后 precmd 吐出的落点 OSC7）即接受并解 pin；超时自动解除恢复正常。
    /// path 期望为普通绝对路径（调用方已归一，对齐 createTerminal 存投影 cwds 口径）。
    public func noteInjectedCwd(_ path: String, now: UInt64 = WaitClock.nowMs()) {
        stateLock.withLock {
            _cwd = path
            _injectedCwdPin = InjectedCwdPin(path: path, expiresAtMs: now &+ cwdPinWindowMs)
        }
    }

    /// pin 裁决纯函数（登记⑨；显式 nowMs 供零时钟单测）：无 pin → accept；窗口过期（nowMs ≥ expiresAtMs）
    /// → acceptAndClearPin；与 pin 落点匹配 → acceptAndClearPin；否则（窗内漂移）→ ignore。
    static func cwdPinDecision(pin: InjectedCwdPin?, incomingRaw: String, nowMs: UInt64) -> CwdPinDecision {
        guard let pin else { return .accept }
        if nowMs >= pin.expiresAtMs { return .acceptAndClearPin }
        if pinPathMatches(pinPath: pin.path, rawOsc7: incomingRaw) { return .acceptAndClearPin }
        return .ignore
    }

    /// pin 落点 vs 入站 OSC7 匹配（纯字符串归一，**不做 symlink 解析**——失配最坏是 pin 撑满窗口自动解除，
    /// header 仍正确，不值得在锁内做磁盘 I/O）：入站过 UIStateProjection.normalizeCwd（file:// 解码），
    /// 双侧去尾斜杠，另认 `/private` 前缀等价（macOS /tmp ↔ /private/tmp 别名）。
    static func pinPathMatches(pinPath: String, rawOsc7: String) -> Bool {
        guard let incoming = UIStateProjection.normalizeCwd(rawOsc7) else { return false }
        let a = Self.stripTrailingSlash(pinPath)
        let b = Self.stripTrailingSlash(incoming)
        return a == b || "/private" + a == b || a == "/private" + b
    }

    /// 去尾斜杠归一（根 "/" 保留；对齐 TerminalService.normalizeCwd 口径）。
    private static func stripTrailingSlash(_ path: String) -> String {
        var s = path
        while s.count > 1, s.hasSuffix("/") { s.removeLast() }
        return s
    }

    // MARK: 生命周期

    public init(id: SessionID = SessionID(raw: UUID().uuidString), config: Config = Config()) throws {
        self.id = id
        self._cols = config.cols
        self._rows = config.rows
        self.closeGraceMs = config.closeGraceMs
        self.cwdPinWindowMs = config.cwdPinWindowMs
        self.cbCwd = config.onCwdChanged
        self.cbBell = config.onBell
        self.cbTitle = config.onTitleChanged
        self.cbExit = config.onExit
        self.queue = DispatchQueue(label: "muxvo.term.\(id.raw)")

        // 主题装配 payload（fg/bg/cursor/palette + colorScheme 应答值，terminal-theme.md §3/§7）。
        let colorOptions = config.theme.makeColorOptions()

        // terminal_new + effects 注册全在会话 queue 上（C handle 单线程不变量）。
        try queue.sync {
            var t: OpaquePointer?
            let opts = GhosttyTerminalOptions(cols: config.cols, rows: config.rows, max_scrollback: config.maxScrollback)
            let rc = ghostty_terminal_new(nil, &t, opts)
            guard rc == GHOSTTY_SUCCESS, let t else {
                throw TerminalSessionError.ghosttyFailed("terminal_new rc=\(rc.rawValue)")
            }
            self.term = t
            let ud = Unmanaged.passUnretained(self).toOpaque()
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_USERDATA, ud)
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_WRITE_PTY, unsafeBitCast(writePtyTrampoline, to: UnsafeRawPointer.self))
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_BELL, unsafeBitCast(bellTrampoline, to: UnsafeRawPointer.self))
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_TITLE_CHANGED, unsafeBitCast(titleTrampoline, to: UnsafeRawPointer.self))
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_PWD_CHANGED, unsafeBitCast(pwdTrampoline, to: UnsafeRawPointer.self))
            // colorScheme 应答（§7 CSI ?996n）：回调读 _colorScheme 存量填 out_scheme（在 vt_write 内、queue 上触发）。
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_COLOR_SCHEME, unsafeBitCast(colorSchemeTrampoline, to: UnsafeRawPointer.self))

            // 默认主题色注入（terminal-theme.md §3）：fg/bg/cursor/palette 四 option + 置 _colorScheme
            // 存量。渲染端读有效色（含 OSC 覆盖），不自合成——本处只注默认层。
            self.applyColorOptionsOnQueue(t, colorOptions)
            var defaultCursorStyle = GHOSTTY_TERMINAL_CURSOR_STYLE_BLOCK   // TERM_L1_18
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_STYLE, &defaultCursorStyle)
            var defaultCursorBlink = true                                  // TERM_L1_19
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_BLINK, &defaultCursorBlink)

            // 渲染数据面 updater：render state 归会话所有、多视图共读（合同①）。
            self.renderCoordinator = RenderCoordinator(queue: self.queue, term: t)
            // 选区/鼠标：手势与编码触 vt，必须在会话 queue 串行（与 feed 互斥）。
            self.selectionController = SelectionController(queue: self.queue, term: t)
            self.mouseReporter = MouseReporter(term: t)
            self.searchEngine = TerminalSearchEngine(queue: self.queue, term: t)
        }

        if config.spawnShell {
            let source = config.envSource ?? ProcessInfo.processInfo.environment
            let shell = config.executablePath ?? TerminalLoginShell.resolve(source: source)
            let argv = config.argv ?? TerminalLoginShell.argv(forShell: shell)
            // env 合同收敛到 MuxvoTermCore.EnvContract（§1.2 权威，vendor-free）。
            var env = EnvContract.build(base: source, terminalID: id.raw, isDarwin: true)
            for (k, v) in config.extraEnv { env[k] = v }

            let spawn = PTYSpawnConfig(
                executablePath: shell, argv: argv, environment: env,
                cwd: config.cwd, cols: config.cols, rows: config.rows
            )
            do {
                self.pty = try PTYHost(
                    config: spawn,
                    readQueue: queue,
                    onData: { [weak self] bytes in self?.feedOnQueue(bytes) },
                    onExit: { [weak self] exit, forced in self?.recordExit(exit, forced) }
                )
            } catch {
                // spawn 失败：回收已建 terminal，抛出。
                queue.sync { if let t = self.term { ghostty_terminal_free(t); self.term = nil } }
                throw error
            }
        }
    }

    /// 优雅关闭（规格 §3.2）：SIGHUP → grace → SIGKILL；grace nil 用 config 默认。
    public func requestClose(graceMs: Int? = nil) {
        pty?.gracefulClose(graceMs: graceMs ?? closeGraceMs)
    }

    /// 子进程是否已退出（非阻塞只读，不消费 exitSem 信号——waitForExit 的兄弟只读口）。
    /// cwd 钉住注入等「死会话即弃」判据用：会话 SIGHUP 后注入无意义（这是**语义**闸——死会话不该再注入）。
    /// 「close 竞态窗内写已回收复用的 PTY fd」的**安全**闸已由 PTYHost 写路径守卫全封（M7）：write 每次
    /// syscall 前在 fdGuard 锁内查 fd 是否已关，与 cancel handler「close fd + 置位」互斥——即便 hasExited
    /// 因 reap 先关 fd 后置 _exitResult 而短暂读到 stale false，write 仍被 fd 级守卫拒于已关 fd 之外，μs
    /// TOCTOU 残窗消除（dogfood-r2#4 全量并行取证：终端关闭后的迟到注入曾串进邻套件 PTY，此路已封）。
    public var hasExited: Bool {
        exitLock.lock(); defer { exitLock.unlock() }
        return _exitResult != nil
    }

    /// 阻塞等子进程退出（测试同步用）。超时返回 nil。
    public func waitForExit(timeout: TimeInterval) -> (PTYExit, Bool)? {
        if exitSem.wait(timeout: .now() + timeout) == .timedOut { return nil }
        exitLock.lock(); defer { exitLock.unlock() }
        return _exitResult
    }

    /// 拆除：强杀+收尸 PTY（幂等），再释放 terminal。deinit 复用。
    public func close() {
        pty?.terminate()
        pty = nil
        queue.sync {
            // 先停用 coordinator/选区/鼠标（gesture_free 需活 terminal 回收 tracked 引用），再释放 terminal。
            self.renderCoordinator?.shutdownOnQueue()
            self.selectionController?.shutdownOnQueue()
            self.mouseReporter?.shutdownOnQueue()
            self.searchEngine?.shutdownOnQueue()
            if let t = self.term { ghostty_terminal_free(t); self.term = nil }
        }
    }

    deinit { close() }

    // MARK: 输入 / 输出

    /// 往 PTY 写（等价键盘输入/发命令）。隔离模式 no-op。onUserWrite 置于 pty.write 后触发，
    /// 不占 input-to-pixel 关键路径（WaitDetector reset 接缝，§3）。
    public func write(_ text: String) { let b = Array(text.utf8); pty?.write(b); onUserWrite?(b) }
    public func write(_ bytes: [UInt8]) { pty?.write(bytes); onUserWrite?(bytes) }

    /// 输入链接缝（terminal-input.md §1/§3/§7）：在会话 queue 上、持活终端句柄同步跑 body
    /// （与 vt feed 互斥）。key encoder 的 setopt_from_terminal 与 mode_get（2004/1004 门控）
    /// 必须读活终端状态，收敛到此。终端已释放返回 nil。
    public func withTerminal<R>(_ body: (OpaquePointer) -> R) -> R? {
        queue.sync { term.map(body) }
    }

    /// 隔离模式：绕过 PTY 直接灌 vt 字节（queue.sync 自带背压）。
    public func feed(_ bytes: [UInt8]) { queue.sync { feedOnQueue(bytes) } }
    public func feed(_ text: String) { feed(Array(text.utf8)) }

    private func feedOnQueue(_ bytes: [UInt8]) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let term, !bytes.isEmpty else { return }
        // PTY 输出活动戳（WaitDetector 静默基准，§6）：任意输出刷新，poll 据此清静默弱信号。
        stateLock.withLock { _lastOutputMs = WaitClock.nowMs(); _hasOutput = true }
        bytes.withUnsafeBufferPointer { p in
            ghostty_terminal_vt_write(term, p.baseAddress, p.count)
        }
        // alt-screen 边沿检测（message-editor.md §1/§8）：feed 后廉价读 ACTIVE_SCREEN，翻转即回调。
        detectAltScreenEdgeOnQueue()
        // 只置脏 + 节流调度（合同②）：draw 路径永不与 feed 同 queue sync 竞争。
        renderCoordinator?.feedDidWriteOnQueue()
    }

    /// alt-screen 边沿检测（message-editor.md §1/§8/§11③）：读 vt ACTIVE_SCREEN（GhosttyTerminalScreen*
    /// int get，terminal.h:751），primary↔alternate 翻转才回调（true=alternate）。legacy 硬编码扫
    /// `\x1b[?1049h/l` 字节；新架构改由 vt 权威态边沿驱动（不 web 侧扫字节）。仅在 feedOnQueue 内调（queue 上）。
    private func detectAltScreenEdgeOnQueue() {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let term else { return }
        var screen = GHOSTTY_TERMINAL_SCREEN_PRIMARY
        guard ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN, &screen) == GHOSTTY_SUCCESS
        else { return }
        let isAlt = screen == GHOSTTY_TERMINAL_SCREEN_ALTERNATE
        guard isAlt != _altScreen else { return }
        _altScreen = isAlt
        onAltScreenChanged?(isAlt)
    }

    // MARK: 主题（terminal-theme.md §5 立即生效 / §7 colorScheme 应答）

    /// 运行时换主题（§5）：queue.async 内重注 fg/bg/cursor/palette 四 option + 更新 _colorScheme 存量
    /// （996 应答随之改）+ 立即全量重绘（forceFull，旁路 dirty/行缓存立即通道）。切换即刻可见、无需新开
    /// 终端。glyph atlas 只换色不重建（颜色是 per-cell 实例属性，§5）。已释放终端 no-op。
    public func applyTheme(_ theme: TermTheme) {
        let options = theme.makeColorOptions()
        queue.async { [weak self] in
            guard let self, let term = self.term else { return }
            self.applyColorOptionsOnQueue(term, options)
            self.renderCoordinator?.performUpdateOnQueue(forceFull: true)
        }
    }

    /// 注入 fg/bg/cursor/palette 四 option + 置 _colorScheme 存量（init 与 applyTheme 共用）。
    /// palette 传 256 项 GhosttyColorRgb 指针（§3；16..255 不随主题，随 palette 整体注）。会话 queue 上调。
    private func applyColorOptionsOnQueue(_ term: OpaquePointer, _ options: TerminalColorOptions) {
        dispatchPrecondition(condition: .onQueue(queue))
        var bg = GhosttyColorRgb(r: options.background.r, g: options.background.g, b: options.background.b)
        ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND, &bg)
        var fg = GhosttyColorRgb(r: options.foreground.r, g: options.foreground.g, b: options.foreground.b)
        ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND, &fg)
        var cursor = GhosttyColorRgb(r: options.cursor.r, g: options.cursor.g, b: options.cursor.b)
        ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_COLOR_CURSOR, &cursor)
        var palette = options.palette.map { GhosttyColorRgb(r: $0.r, g: $0.g, b: $0.b) }
        palette.withUnsafeMutableBufferPointer { buf in
            ghostty_terminal_set(term, GHOSTTY_TERMINAL_OPT_COLOR_PALETTE, buf.baseAddress)
        }
        _colorScheme = options.colorScheme
    }

    // MARK: resize（防御 §4）

    /// resize 决策取证（DOGFOOD_M3_07 可诊断性：守卫拒绝此前不可观测；F5 先例 subsystem com.muxvo）。
    private static let resizeLog = Logger(subsystem: "com.muxvo", category: "session")

    /// 可疑窄化判定（DOGFOOD_M3_13 F1 取证）：已成形网格（old≥20）被缩掉 >30% 视为可疑。
    /// 纯函数供单测锚；仅驱动日志级别，不改变 resize 行为。级别 .error→.notice（m3-layout-r5
    /// F5 降噪）：五轮实证合法布局操作（平铺⇄聚焦/四宫格/多 tile 压缩）大量命中本判定——
    /// 2026-07-07 现场 26 条 .error 全为合法布局，真信号被淹；风暴哨兵（1s>2 次已应用）接任
    /// .error 级主告警。
    static func isSuspiciousNarrowing(oldCols: UInt16, newCols: UInt16) -> Bool {
        oldCols >= 20 && Int(newCols) * 10 < Int(oldCols) * 7
    }

    /// vt resize（带 cell px，供 XTWINOPS/图片协议）+ 内核 TIOCSWINSZ 一函数收口。
    /// cols<10 || rows<2 拒绝：不下发任何 winsize，返回 false。
    @discardableResult
    public func resize(cols: UInt16, rows: UInt16, cellWidthPx: UInt32 = 8, cellHeightPx: UInt32 = 16) -> Bool {
        stateLock.withLock { _resizeRequestCount += 1 }
        let sid = String(id.raw.prefix(8))
        guard cols >= 10, rows >= 2 else {
            Self.resizeLog.notice("resize rejected [\(sid, privacy: .public)] \(cols)x\(rows)（<10×2 防御）")
            return false
        }
        let (oldCols, oldRows) = stateLock.withLock { () -> (UInt16, UInt16) in
            _hasReceivedResize = true // 过 <10×2 防御即算「首个外部尺寸已达」（登记⑩；含同尺寸短路）
            return (_cols, _rows)
        }
        // 同尺寸硬短路（DOGFOOD_M3_16 修复①）：cols/rows 均未变 → 不调 ghostty resize、不下发
        // TIOCSWINSZ（TIOCSWINSZ 无论尺寸是否变都发 SIGWINCH → 消灭 spurious SIGWINCH）、不 forceFull
        // （消灭 spurious 帧重建）。refreshGlyphCacheForScale 重置 lastGrid 后的同尺寸重提交、真值
        // 失配自愈里同尺寸的那些、以及任何调用方的幂等 resize，都在此归零。会话已在此尺寸 → 幂等
        // accepted 返回 true，令调用方 lastGrid 账保持一致。cellPx 若在同网格下变（极罕见的 scale
        // 变而 cols/rows 不变）不再下发 vt——只影响 XTWINOPS/图片协议的像素上报，CC/Ink 无此需求。
        if cols == oldCols, rows == oldRows {
            Self.resizeLog.debug("resize 同尺寸短路 \(cols)x\(rows)（无 ghostty/winsize/forceFull，DOGFOOD_M3_16①）")
            return true
        }
        let vtOK = queue.sync { () -> Bool in
            dispatchPrecondition(condition: .onQueue(queue))
            guard let term = self.term else { return false }
            return ghostty_terminal_resize(term, cols, rows, cellWidthPx, cellHeightPx) == GHOSTTY_SUCCESS
        }
        let ptyOK = pty?.setWinsize(cols: cols, rows: rows) ?? true
        if vtOK {
            let stampMs = WaitClock.nowMs()
            let burst = stateLock.withLock { () -> Int in
                _cols = cols; _rows = rows; _resizeAppliedCount += 1
                _appliedStampsMs.append(stampMs)
                _appliedStampsMs.removeAll { stampMs &- $0 > 1_000 }
                return _appliedStampsMs.count
            }
            // 立即通道（§1.2）：网格变了，跳过节流立刻重建快照。
            renderCoordinator?.requestImmediateUpdate(forceFull: true)
            // 风暴哨兵（m3-layout-r5 F5）：预算不变式「每手势每会话 ≤1 次已应用」的 .error 主告警
            //（生产回溯 + e2e 断言双用）。
            if burst > 2 {
                Self.resizeLog.error("resize 风暴 [\(sid, privacy: .public)] 1s内已应用第\(burst)次（预算不变式：每手势应≤1；连续命中=节流失效或字号连击）")
            }
        }
        // 取证日志（DOGFOOD_M3_13 F1，.notice 持久化——info 级事后 log show 不可见曾丢失整段时间线）：
        // ①可疑窄化 .notice（m3-layout-r5 F5 降噪：合法布局窄化居多，.error 让位风暴哨兵）
        // ②vt/pty 部分失败 .error（Q2/Q3 象限三账分裂可见性）③常规 accepted .notice。
        if vtOK, Self.isSuspiciousNarrowing(oldCols: oldCols, newCols: cols) {
            Self.resizeLog.notice("resize 可疑窄化 [\(sid, privacy: .public)] \(oldCols)→\(cols) cols rows=\(rows) cell=\(cellWidthPx)x\(cellHeightPx)px vt=\(vtOK) pty=\(ptyOK)")
        } else if vtOK != ptyOK {
            Self.resizeLog.error("resize 部分失败 [\(sid, privacy: .public)] \(cols)x\(rows) vt=\(vtOK) pty=\(ptyOK)（三账分裂风险）")
        } else {
            Self.resizeLog.notice("resize [\(sid, privacy: .public)] \(cols)x\(rows) cell=\(cellWidthPx)x\(cellHeightPx)px vt=\(vtOK) pty=\(ptyOK)")
        }
        return vtOK && ptyOK
    }

    // MARK: 查询（数据面）

    /// scrollback 行数（total − viewport）。灌超封顶应稳定在 max_scrollback。
    public func scrollbackRowCount() -> Int {
        queue.sync {
            guard let term = self.term else { return 0 }
            var n: Int = 0
            _ = ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS, &n)
            return n
        }
    }

    /// 隔离模式下 vt 经 write_pty 回写的字节（查询响应校验）。
    public func writePtyCapture() -> [UInt8] { queue.sync { _writePtyCapture } }

    /// 整屏（含 scrollback）plain text dump，经 ghostty formatter（乱码/回显校验用）。
    public func dumpPlainText(trim: Bool = true, unwrap: Bool = false) -> String {
        queue.sync {
            guard let term = self.term else { return "" }
            var fopts = GhosttyFormatterTerminalOptions()
            fopts.size = MemoryLayout<GhosttyFormatterTerminalOptions>.size
            fopts.emit = GHOSTTY_FORMATTER_FORMAT_PLAIN
            fopts.trim = trim
            fopts.unwrap = unwrap
            var fmt: OpaquePointer?
            guard ghostty_formatter_terminal_new(nil, &fmt, term, fopts) == GHOSTTY_SUCCESS, let fmt else { return "" }
            defer { ghostty_formatter_free(fmt) }

            var needed = 0
            let probeRC = ghostty_formatter_format_buf(fmt, nil, 0, &needed)
            if probeRC == GHOSTTY_SUCCESS { return "" }
            guard probeRC == GHOSTTY_OUT_OF_SPACE, needed > 0 else { return "" }

            var buf = [UInt8](repeating: 0, count: needed)
            var written = 0
            let rc = buf.withUnsafeMutableBufferPointer { p in
                ghostty_formatter_format_buf(fmt, p.baseAddress, p.count, &written)
            }
            guard rc == GHOSTTY_SUCCESS else { return "" }
            return String(decoding: buf[0..<written], as: UTF8.self)
        }
    }

    // MARK: 渲染数据面（合同①②；视图批 3 消费）

    /// 视口滚动行为（§5）。delta 上负下正。
    public enum ScrollBehavior: Sendable {
        case delta(Int)
        case top
        case bottom
        /// 绝对定位到目标 offset（DOGFOOD_M3_11 拇指拖拽）：queue 内读 vt 真值 scrollbar → clamp →
        /// ≥maxOffset 贴 BOTTOM / ==0 贴 TOP / 否则 DELTA(clamped−真值)。消除视图侧算 delta 的一帧竞态。
        case toOffset(Int)
    }

    /// 最新一帧快照（视图 draw 只读此、零锁竞争、永不 sync 进会话 queue）。未 update 前为 nil。
    public func currentFrame() -> TerminalFrameSnapshot? { renderCoordinator?.currentSnapshot() }

    /// 注册帧观察者：每次发布后在 `deliverOn`（默认 main→needsDisplay）投递最新快照。返回移除用 token。
    @discardableResult
    public func addFrameObserver(
        deliverOn: DispatchQueue = .main,
        _ callback: @escaping @Sendable (TerminalFrameSnapshot) -> Void
    ) -> Int? {
        queue.sync { renderCoordinator?.addObserverOnQueue(deliverOn: deliverOn, callback) }
    }

    public func removeFrameObserver(_ token: Int) {
        queue.sync { renderCoordinator?.removeObserverOnQueue(token) }
    }

    /// 视图 attach 时触发一次立即 update，让 currentFrame() 立刻有内容（批 3 attach 路径消费）。
    public func requestImmediateFrame() { renderCoordinator?.requestImmediateUpdate(forceFull: true) }

    /// 滚动视口（§5）：会话 queue 上滚动 + 立即 update（跳过节流），同步落一帧新快照。
    public func scrollViewport(_ behavior: ScrollBehavior) {
        queue.sync {
            guard let term = self.term else { return }
            var value = GhosttyTerminalScrollViewportValue()
            let tag: GhosttyTerminalScrollViewportTag
            switch behavior {
            case .delta(let d): tag = GHOSTTY_SCROLL_VIEWPORT_DELTA; value.delta = Int(d)
            case .top: tag = GHOSTTY_SCROLL_VIEWPORT_TOP
            case .bottom: tag = GHOSTTY_SCROLL_VIEWPORT_BOTTOM
            case .toOffset(let target):
                // 绝对定位（DOGFOOD_M3_11）：queue 内读 vt 真值 scrollbar → clamp → 贴边/DELTA 原子事务。
                // 读真值+算 delta+滚动同一 queue.sync，消除「视图侧快照 offset 算 delta」的一帧竞态。
                var sb = GhosttyTerminalScrollbar()
                guard ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SCROLLBAR, &sb) == GHOSTTY_SUCCESS else { return }
                let total = Int(sb.total), len = Int(sb.len), cur = Int(sb.offset)
                let maxOffset = max(0, total - len)
                let clamped = min(maxOffset, max(0, target))
                if clamped >= maxOffset {
                    tag = GHOSTTY_SCROLL_VIEWPORT_BOTTOM   // 贴底：viewportActive 恢复、跳底浮标自动收
                } else if clamped == 0 {
                    tag = GHOSTTY_SCROLL_VIEWPORT_TOP      // 贴顶
                } else {
                    tag = GHOSTTY_SCROLL_VIEWPORT_DELTA; value.delta = clamped - cur
                }
            }
            ghostty_terminal_scroll_viewport(term, GhosttyTerminalScrollViewport(tag: tag, value: value))
            self.renderCoordinator?.noteScrollOnQueue()
            self.renderCoordinator?.performUpdateOnQueue(forceFull: true)
        }
    }

    /// viewport 是否钉在活动区（§5）。false = 用户滚进了历史（键入自动回底的数据面判据）。
    public var viewportActive: Bool {
        queue.sync {
            guard let term = self.term else { return true }
            var active = false
            _ = ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE, &active)
            return active
        }
    }

    /// 键入自动回底（§5）：写 PTY 前若已离底则先滚到底。视图批 3 在输入路径消费。
    public func ensureViewportAtBottom() {
        queue.sync {
            guard let term = self.term else { return }
            var active = false
            _ = ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE, &active)
            guard !active else { return }
            ghostty_terminal_scroll_viewport(
                term, GhosttyTerminalScrollViewport(tag: GHOSTTY_SCROLL_VIEWPORT_BOTTOM,
                                                    value: GhosttyTerminalScrollViewportValue()))
            self.renderCoordinator?.noteScrollOnQueue()
            self.renderCoordinator?.performUpdateOnQueue(forceFull: true)
        }
    }

    // MARK: 选区手势（§4；视图批4② 消费）

    /// 选区 press（会话 queue）。col/row = viewport 格（越界 clamp 到边）；surfaceX/Y = backing px
    /// （多击距离判定）；timeNs = 单调纳秒（多击间隔判定，视图传 `event.timestamp*1e9`）。
    /// 单击清旧选区、双击词选、三击行选由 gesture 内建（见 SelectionController）。
    /// shiftExtend（DOGFOOD_M3_17，§4 ☆，默认 false 保源兼容）：Shift+左键按下走扩展路径——不清旧选区、
    /// 扩展为「固定端→点击格」（取值链见 SelectionController.extendPressOnQueue）；其后 drag 以固定端持续更新 end。
    public func selectionPress(col: Int, row: Int, surfaceX: Double, surfaceY: Double, timeNs: UInt64,
                               shiftExtend: Bool = false) {
        queue.sync {
            guard let sc = selectionController else { return }
            if shiftExtend {
                sc.extendPressOnQueue(col: clampCol(col), row: clampRow(row), surfaceX: surfaceX, surfaceY: surfaceY, timeNs: timeNs)
            } else {
                sc.pressOnQueue(col: clampCol(col), row: clampRow(row), surfaceX: surfaceX, surfaceY: surfaceY, timeNs: timeNs)
            }
            renderCoordinator?.performUpdateOnQueue(forceFull: true)   // 立即通道：选区变即重建快照
        }
    }

    /// 选区 drag（会话 queue）。geometry（columns/cellWidthPx/screenHeightPx）供 autoscroll 边缘判定。
    public func selectionDrag(col: Int, row: Int, surfaceX: Double, surfaceY: Double,
                              columns: Int, cellWidthPx: Int, screenHeightPx: Int) {
        queue.sync {
            guard let sc = selectionController else { return }
            sc.dragOnQueue(col: clampCol(col), row: clampRow(row), surfaceX: surfaceX, surfaceY: surfaceY,
                           columns: columns, cellWidthPx: cellWidthPx, screenHeightPx: screenHeightPx)
            renderCoordinator?.performUpdateOnQueue(forceFull: true)
        }
    }

    /// 选区 release（会话 queue）。仅收尾手势状态；不改选区（单击清除已在 press 完成）。
    public func selectionRelease(col: Int, row: Int) {
        queue.sync { selectionController?.releaseOnQueue(col: clampCol(col), row: clampRow(row)) }
    }

    /// 清除选区（会话 queue）+ 立即重建快照。
    public func clearSelection() {
        queue.sync {
            selectionController?.clearOnQueue()
            renderCoordinator?.performUpdateOnQueue(forceFull: true)
        }
    }

    /// 当前是否有活选区（Cmd+C 门控：有选区才截、无选区放行）。
    public func hasSelection() -> Bool {
        queue.sync { selectionController?.hasSelectionOnQueue() ?? false }
    }

    /// 导出选区纯文本（Cmd+C：formatter unwrap+trim；无选区 → nil）。
    public func copySelectionPlainText() -> String? {
        queue.sync { selectionController?.copyPlainTextOnQueue() }
    }

    /// 测试可见（DOGFOOD_M3_17 §4 ☆）：活选区端点是否 REVERSE（点选区前扩展的方向保持实证）。无选区 → nil。
    func selectionReversedForTest() -> Bool? {
        queue.sync { selectionController?.selectionReversedOnQueue() }
    }

    // MARK: 鼠标上报（§5；视图批4② 消费）

    /// 鼠标事件编码：tracking 活跃且非 Shift → 返回编码字节（可能空 []，表已消费但无产出）；
    /// 无追踪 / Shift 旁通 → nil（视图据此改走选区）。字节由视图经 `write` 送 PTY。
    public func encodeMouseReport(_ report: TerminalMouseReport,
                                  screenWidthPx: Int, screenHeightPx: Int,
                                  cellWidthPx: Int, cellHeightPx: Int) -> [UInt8]? {
        queue.sync {
            mouseReporter?.encodeOnQueue(report: report, screenW: screenWidthPx, screenH: screenHeightPx,
                                         cellW: cellWidthPx, cellH: cellHeightPx)
        }
    }

    // MARK: 终端内搜索（§ terminal-search-bar M3；视图 Cmd+F/搜索条驱动，批5②）

    /// 设查询串并重建命中：全 SCREEN 域大小写不敏感子串匹配 → 推命中给 coordinator（映射高亮）→
    /// 滚动使当前命中可见 → 立即重建快照。空串 = 清高亮（搜索条仍开）。会话 queue 上、与 feed 互斥。
    public func searchSetQuery(_ query: String) {
        queue.sync {
            guard let term, let engine = searchEngine else { return }
            let preferRow = viewportTopScreenRowOnQueue(term)
            engine.setQueryOnQueue(query, preferFromScreenRow: preferRow)
            pushSearchToCoordinatorOnQueue()
            scrollToCurrentMatchOnQueue(term)
            renderCoordinator?.performUpdateOnQueue(forceFull: true)
        }
    }

    /// 下一个命中（环绕）+ 滚动可见 + 重建快照。
    public func searchNext() { queue.sync { advanceSearchOnQueue(forward: true) } }
    /// 上一个命中（环绕）+ 滚动可见 + 重建快照。
    public func searchPrev() { queue.sync { advanceSearchOnQueue(forward: false) } }

    /// 关闭/清除搜索：清引擎命中 + 清 coordinator 高亮 + 重建快照。
    public func searchClear() {
        queue.sync {
            searchEngine?.clearOnQueue()
            renderCoordinator?.clearSearchOnQueue()
            renderCoordinator?.performUpdateOnQueue(forceFull: true)
        }
    }

    /// 命中总数（测试/诊断）。
    public func searchMatchCount() -> Int { queue.sync { searchEngine?.matchCount ?? 0 } }
    /// 当前命中的 SCREEN 绝对行号（测试/诊断；无命中 → nil）。
    public func searchCurrentScreenRow() -> Int? { queue.sync { searchEngine?.currentMatch?.screenRow } }

    private func advanceSearchOnQueue(forward: Bool) {
        guard let term, let engine = searchEngine else { return }
        _ = forward ? engine.nextOnQueue() : engine.prevOnQueue()
        pushSearchToCoordinatorOnQueue()
        scrollToCurrentMatchOnQueue(term)
        renderCoordinator?.performUpdateOnQueue(forceFull: true)
    }

    private func pushSearchToCoordinatorOnQueue() {
        renderCoordinator?.setSearchOnQueue(
            matches: searchEngine?.matches ?? [], currentIndex: searchEngine?.currentIndex)
    }

    /// viewport 顶端对应的 SCREEN 行号（= scrollbar.offset）。新查询选「该行及之后首个命中」的基准。
    private func viewportTopScreenRowOnQueue(_ term: OpaquePointer) -> Int {
        var sb = GhosttyTerminalScrollbar()
        guard ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SCROLLBAR, &sb) == GHOSTTY_SUCCESS else { return 0 }
        return Int(sb.offset)
    }

    /// 滚动使当前命中行进入 viewport（已可见则不动）：把命中行滚到 viewport 中部附近。noteScroll 供快照查 scrollbar。
    private func scrollToCurrentMatchOnQueue(_ term: OpaquePointer) {
        guard let match = searchEngine?.currentMatch else { return }
        var sb = GhosttyTerminalScrollbar()
        guard ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_SCROLLBAR, &sb) == GHOSTTY_SUCCESS else { return }
        let total = Int(sb.total), offset = Int(sb.offset), len = Int(sb.len)
        let target = match.screenRow
        if target >= offset, target < offset + len { return } // 已可见
        guard total > len else { return }                     // 无可滚动区
        let desired = max(0, min(target - len / 2, total - len))
        let delta = desired - offset
        guard delta != 0 else { return }
        var value = GhosttyTerminalScrollViewportValue()
        value.delta = delta
        ghostty_terminal_scroll_viewport(
            term, GhosttyTerminalScrollViewport(tag: GHOSTTY_SCROLL_VIEWPORT_DELTA, value: value))
        renderCoordinator?.noteScrollOnQueue()
    }

    /// viewport 尺寸 clamp（选区格坐标越界收敛到可见边）。
    private func clampCol(_ c: Int) -> Int { max(0, min(c, Int(cols) - 1)) }
    private func clampRow(_ r: Int) -> Int { max(0, min(r, Int(rows) - 1)) }

    // MARK: C effects 处理（在会话 queue 上，vt_write 内同步触发）

    fileprivate func handleWritePty(_ bytes: [UInt8]) {
        // 回写 PTY fd（查询响应）；隔离模式无 PTY → 记录供测试。
        if let pty { pty.write(bytes) } else { _writePtyCapture.append(contentsOf: bytes) }
    }

    fileprivate func handleBell() {
        guard let cb = cbBell else { return }
        DispatchQueue.main.async { cb() }
    }

    fileprivate func handleTitleChanged() {
        let title = readString(GHOSTTY_TERMINAL_DATA_TITLE)
        guard let cb = cbTitle else { return }
        DispatchQueue.main.async { cb(title) }
    }

    fileprivate func handlePwdChanged() {
        let pwd = readString(GHOSTTY_TERMINAL_DATA_PWD)
        let now = WaitClock.nowMs()
        // pin 裁决（登记⑨）：注入 cd 窗口内忽略晚到漂移 OSC7；匹配/过期恢复正常接受。决策纯 CPU，锁内完成。
        let accepted = stateLock.withLock { () -> Bool in
            switch Self.cwdPinDecision(pin: _injectedCwdPin, incomingRaw: pwd, nowMs: now) {
            case .accept:
                _cwd = pwd
                return true
            case .acceptAndClearPin:
                _cwd = pwd
                _injectedCwdPin = nil
                return true
            case .ignore:
                return false
            }
        }
        guard accepted, let cb = cbCwd else { return }
        DispatchQueue.main.async { cb(pwd) }
    }

    /// colorScheme 查询应答（§7 CSI ?996n）：读 _colorScheme 存量映 C 枚举。回调在 vt_write 内、queue 上
    /// 同步触发（bell/title 同款），与 applyColorOptionsOnQueue 串行，无需锁。
    fileprivate func handleColorSchemeQuery() -> GhosttyColorScheme {
        _colorScheme == .light ? GHOSTTY_COLOR_SCHEME_LIGHT : GHOSTTY_COLOR_SCHEME_DARK
    }

    /// 读取 vt borrowed 字符串（TITLE/PWD）——须在 queue 上、vt_write 之后立即拷出。
    private func readString(_ data: GhosttyTerminalData) -> String {
        guard let term = self.term else { return "" }
        var s = GhosttyString(ptr: nil, len: 0)
        let rc = ghostty_terminal_get(term, data, &s)
        guard rc == GHOSTTY_SUCCESS, let ptr = s.ptr, s.len > 0 else { return "" }
        return String(decoding: UnsafeBufferPointer(start: ptr, count: s.len), as: UTF8.self)
    }

    // MARK: 退出记录

    private func recordExit(_ exit: PTYExit, _ forced: Bool) {
        exitLock.lock(); _exitResult = (exit, forced); exitLock.unlock()
        exitSem.signal()
        guard let cb = cbExit else { return }
        DispatchQueue.main.async { cb(exit, forced) }
    }
}

public enum TerminalSessionError: Error, CustomStringConvertible {
    case ghosttyFailed(String)
    public var description: String {
        switch self { case .ghosttyFailed(let m): return "ghostty: \(m)" }
    }
}

// MARK: - C effects trampolines（无捕获 @convention(c)，userdata 还原 self）

private let writePtyTrampoline: @convention(c) (OpaquePointer?, UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int) -> Void = { _, ud, data, len in
    guard let ud, let data, len > 0 else { return }
    let session = Unmanaged<TerminalSession>.fromOpaque(ud).takeUnretainedValue()
    session.handleWritePty(Array(UnsafeBufferPointer(start: data, count: len)))
}

private let bellTrampoline: @convention(c) (OpaquePointer?, UnsafeMutableRawPointer?) -> Void = { _, ud in
    guard let ud else { return }
    Unmanaged<TerminalSession>.fromOpaque(ud).takeUnretainedValue().handleBell()
}

private let titleTrampoline: @convention(c) (OpaquePointer?, UnsafeMutableRawPointer?) -> Void = { _, ud in
    guard let ud else { return }
    Unmanaged<TerminalSession>.fromOpaque(ud).takeUnretainedValue().handleTitleChanged()
}

private let pwdTrampoline: @convention(c) (OpaquePointer?, UnsafeMutableRawPointer?) -> Void = { _, ud in
    guard let ud else { return }
    Unmanaged<TerminalSession>.fromOpaque(ud).takeUnretainedValue().handlePwdChanged()
}

/// colorScheme 查询回调（§7）：填 out_scheme 返 true；ud/out 缺失则 false（vt 静默忽略查询）。
private let colorSchemeTrampoline: @convention(c) (OpaquePointer?, UnsafeMutableRawPointer?, UnsafeMutablePointer<GhosttyColorScheme>?) -> Bool = { _, ud, out in
    guard let ud, let out else { return false }
    out.pointee = Unmanaged<TerminalSession>.fromOpaque(ud).takeUnretainedValue().handleColorSchemeQuery()
    return true
}
