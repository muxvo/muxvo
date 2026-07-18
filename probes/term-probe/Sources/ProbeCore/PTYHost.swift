// PTYHost：forkpty 包装。spawn /bin/zsh（或任意 shell/命令），
// master fd 用 DispatchSourceRead 在指定队列上读取，write/resize/kill 齐备。
import CGhosttyVT
import Darwin
import Dispatch
import Foundation

public enum ProbeError: Error, CustomStringConvertible {
    case spawnFailed(String)
    case ghosttyFailed(String)

    public var description: String {
        switch self {
        case .spawnFailed(let m): return "spawn failed: \(m)"
        case .ghosttyFailed(let m): return "ghostty failed: \(m)"
        }
    }
}

public final class PTYHost: @unchecked Sendable {
    public let pid: pid_t
    public let masterFD: Int32

    private let readSource: DispatchSourceRead
    private let stateLock = NSLock()
    private var closed = false

    /// onData 在传入的 queue 上回调（与 TerminalSession 的串行队列共用，天然串行化）。
    public init(
        shell: String = "/bin/zsh",
        command: String? = nil,
        cols: UInt16,
        rows: UInt16,
        queue: DispatchQueue,
        onData: @escaping @Sendable ([UInt8]) -> Void
    ) throws {
        var master: Int32 = -1
        let pid = probe_spawn_pty(shell, command, cols, rows, &master)
        guard pid > 0, master >= 0 else {
            throw ProbeError.spawnFailed("forkpty/exec \(shell) errno=\(errno)")
        }
        self.pid = pid
        self.masterFD = master

        // 非阻塞读，配合 DispatchSourceRead
        let flags = fcntl(master, F_GETFL, 0)
        _ = fcntl(master, F_SETFL, flags | O_NONBLOCK)

        let src = DispatchSource.makeReadSource(fileDescriptor: master, queue: queue)
        src.setEventHandler {
            var buf = [UInt8](repeating: 0, count: 65536)
            while true {
                let n = buf.withUnsafeMutableBytes { p in
                    read(master, p.baseAddress, p.count)
                }
                guard n > 0 else { break } // EAGAIN/EOF；EOF 由 terminate() 收尾
                onData(Array(buf[0..<n]))
                if n < buf.count { break }
            }
        }
        // fd 的关闭放在 cancel handler，避免 source 活跃期间 close 导致 fd 复用竞态
        src.setCancelHandler {
            close(master)
        }
        src.resume()
        self.readSource = src
    }

    public func write(_ bytes: [UInt8]) {
        var off = 0
        while off < bytes.count {
            let n = bytes[off...].withUnsafeBytes { p in
                Darwin.write(masterFD, p.baseAddress, p.count)
            }
            if n > 0 {
                off += n
            } else if errno == EAGAIN {
                usleep(1000)
            } else {
                break
            }
        }
    }

    public func write(_ text: String) {
        write(Array(text.utf8))
    }

    /// TIOCSWINSZ（内核侧 pty 尺寸，子进程收 SIGWINCH）
    @discardableResult
    public func resize(cols: UInt16, rows: UInt16) -> Bool {
        probe_set_winsize(masterFD, cols, rows) == 0
    }

    /// SIGKILL + waitpid + 取消读 source（cancel handler 里关 fd）
    public func terminate() {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !closed else { return }
        closed = true
        _ = kill(pid, SIGKILL)
        var status: Int32 = 0
        _ = waitpid(pid, &status, 0)
        readSource.cancel()
    }

    deinit {
        terminate()
    }
}
