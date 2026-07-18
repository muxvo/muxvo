// TerminalSession：「会话」= PTYHost + GhosttyTerminal。
// - PTY 输出在内部串行队列上 feed 进 ghostty_terminal_vt_write
// - resize 同步 vt（ghostty_terminal_resize）与内核（TIOCSWINSZ）
// - dumpPlainText 经 formatter 出整屏 plain text
// C handle 非线程安全：所有触 C 的调用都收敛到内部串行队列（探针从简，
// 用 @unchecked Sendable + queue.sync 而非 actor，避免 strict-concurrency 纠缠）。
import CGhosttyVT
import Dispatch
import Foundation

public final class TerminalSession: @unchecked Sendable {
    private let queue: DispatchQueue
    private var term: OpaquePointer?
    private var pty: PTYHost?
    private var feedCount: UInt64 = 0 // 仅在 queue 上访问
    private let sizeLock = NSLock()
    private var _cols: UInt16
    private var _rows: UInt16

    public var cols: UInt16 { sizeLock.withLock { _cols } }
    public var rows: UInt16 { sizeLock.withLock { _rows } }

    /// spawnShell=false 即「隔离模式」：无 PTY，仅 vt 状态机，用 feed() 直接灌字节。
    public init(
        cols: UInt16 = 80,
        rows: UInt16 = 24,
        maxScrollbackLines: Int = 10_000,
        spawnShell: Bool,
        shell: String = "/bin/zsh",
        command: String? = nil,
        label: String = "session"
    ) throws {
        self._cols = cols
        self._rows = rows
        let q = DispatchQueue(label: "muxvo.probe.\(label)")
        self.queue = q

        var t: OpaquePointer?
        let opts = GhosttyTerminalOptions(cols: cols, rows: rows, max_scrollback: maxScrollbackLines)
        let rc = ghostty_terminal_new(nil, &t, opts)
        guard rc == GHOSTTY_SUCCESS, let t else {
            throw ProbeError.ghosttyFailed("terminal_new rc=\(rc.rawValue)")
        }
        self.term = t

        if spawnShell {
            // onData 已在 q 上回调，与 dump/resize/close 串行
            self.pty = try PTYHost(shell: shell, command: command, cols: cols, rows: rows, queue: q) { [weak self] bytes in
                self?.feedOnQueue(bytes)
            }
        }
    }

    /// 仅允许在 queue 上调用
    private func feedOnQueue(_ bytes: [UInt8]) {
        guard let term else { return }
        bytes.withUnsafeBufferPointer { p in
            ghostty_terminal_vt_write(term, p.baseAddress, p.count)
        }
        feedCount += UInt64(bytes.count)
    }

    /// 隔离模式：绕过 PTY 直接灌 vt 字节（queue.sync 自带背压）
    public func feed(_ bytes: [UInt8]) {
        queue.sync { feedOnQueue(bytes) }
    }

    public func feed(_ text: String) {
        feed(Array(text.utf8))
    }

    public var bytesFed: UInt64 {
        queue.sync { feedCount }
    }

    /// 往 PTY 写（等价键盘输入/发命令），隔离模式下为 no-op
    public func send(_ text: String) {
        pty?.write(text)
    }

    /// 同步 resize：vt 侧 + 内核 TIOCSWINSZ
    @discardableResult
    public func resize(cols: UInt16, rows: UInt16, cellWidthPx: UInt32 = 8, cellHeightPx: UInt32 = 16) -> Bool {
        let vtOK = queue.sync { () -> Bool in
            guard let term = self.term else { return false }
            return ghostty_terminal_resize(term, cols, rows, cellWidthPx, cellHeightPx) == GHOSTTY_SUCCESS
        }
        let ptyOK = pty?.resize(cols: cols, rows: rows) ?? true
        if vtOK {
            sizeLock.withLock {
                _cols = cols
                _rows = rows
            }
        }
        return vtOK && ptyOK
    }

    /// 渲染状态同步：在会话队列上执行 ghostty_render_state_update（该调用期间
    /// 需要独占 terminal——render.h 的设计就是 update 时短暂上锁、读取时无锁）。
    /// state 由视图持有（GhosttyRenderState），会话只负责喂。
    @discardableResult
    public func updateRenderState(_ state: OpaquePointer) -> Bool {
        queue.sync {
            guard let term = self.term else { return false }
            return ghostty_render_state_update(state, term) == GHOSTTY_SUCCESS
        }
    }

    /// 整屏（含 scrollback）plain text dump，经 ghostty formatter
    public func dumpPlainText(trim: Bool = true, unwrap: Bool = false) -> String {
        queue.sync {
            guard let term = self.term else { return "" }
            var fmt: OpaquePointer?
            var fopts = GhosttyFormatterTerminalOptions()
            fopts.size = MemoryLayout<GhosttyFormatterTerminalOptions>.size
            fopts.emit = GHOSTTY_FORMATTER_FORMAT_PLAIN
            fopts.trim = trim
            fopts.unwrap = unwrap
            guard ghostty_formatter_terminal_new(nil, &fmt, term, fopts) == GHOSTTY_SUCCESS, let fmt else {
                return ""
            }
            defer { ghostty_formatter_free(fmt) }

            // 先查所需大小（NULL buf -> OUT_OF_SPACE + needed），再精确分配
            var needed = 0
            let probeRC = ghostty_formatter_format_buf(fmt, nil, 0, &needed)
            if probeRC == GHOSTTY_SUCCESS { return "" } // 空内容
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

    public func close() {
        pty?.terminate()
        pty = nil
        queue.sync {
            if let term = self.term {
                ghostty_terminal_free(term)
            }
            self.term = nil
        }
    }

    deinit {
        close()
    }
}
