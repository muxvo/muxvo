// probe-cli：M0 探针 2「会话/视图分离」headless 验证入口。
// 子命令：sanity / stress / winsize / crc（详见 usage）。
import Foundation
import ProbeCore

// MARK: - 通用 helper

func probeRoot() -> String {
    // 约定从 probes/term-probe 运行；容错：向上找 loads/ 目录
    let fm = FileManager.default
    var dir = fm.currentDirectoryPath
    for _ in 0..<5 {
        if fm.fileExists(atPath: dir + "/loads/flood-cjk.sh") { return dir }
        dir = (dir as NSString).deletingLastPathComponent
    }
    return fm.currentDirectoryPath
}

/// 轮询等待条件成立（默认 0.25s 间隔）
func waitFor(timeout: TimeInterval, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return true }
        Thread.sleep(forTimeInterval: 0.25)
    }
    return cond()
}

func crc32(_ bytes: [UInt8]) -> UInt32 {
    // 标准 CRC-32 (IEEE 802.3)，多项式 0xEDB88320
    var crc: UInt32 = 0xFFFF_FFFF
    for b in bytes {
        crc ^= UInt32(b)
        for _ in 0..<8 {
            crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB8_8320 : crc >> 1
        }
    }
    return crc ^ 0xFFFF_FFFF
}

func crc32(_ s: String) -> UInt32 {
    crc32(Array(s.utf8))
}

/// dump 文本 -> 去掉尾部空行的行数组
func lines(ofDump dump: String) -> [String] {
    var ls = dump.components(separatedBy: "\n")
    while let last = ls.last, last.trimmingCharacters(in: .whitespaces).isEmpty {
        ls.removeLast()
    }
    return ls
}

func usage() {
    print("""
    probe-cli <subcommand>
      sanity                                     4 会话×5s 轻负载，dump 校验，退出码 0/1
      stress --sessions N --seconds S --load K   N 会话 0 视图压测（K: mix|ccmix|cast|color|cjk|alt|wrap|fill），输出 JSON
                                                 ccmix=标准混布（12×CC回放+4color+2cjk+2alt），cast 素材在 loads/cast/
      winsize                                    headless resize 验证（TIOCSWINSZ + vt 列宽）
      crc                                        确定性负载乱码校验（含 1 字节切分模式），PASS/FAIL
      record --out F.cast --command CMD --duration S [--cols N --rows N] [--send "t:text"...]
                                                 录制 CLI 输出为 asciinema v2 .cast（可定时注入输入）
      bench-vt-ingest [--cast F.cast|all] [--runs N]
                                                 bytes→vt→render state ingest 延迟基准（M1 任务 14），
                                                 默认 loads/cast/ 全部素材各跑 3 遍，JSON 落 reports/raw/
    """)
}

// MARK: - sanity

func runSanity() -> Int32 {
    let root = probeRoot()
    let count = 4
    var sessions: [TerminalSession] = []
    defer { sessions.forEach { $0.close() } }

    do {
        for i in 0..<count {
            sessions.append(try TerminalSession(
                cols: 100, rows: 30, maxScrollbackLines: 2_000,
                spawnShell: true, label: "sanity\(i)"))
        }
    } catch {
        print("sanity FAIL: \(error)")
        return 1
    }

    // 轻负载：每会话跑 3s flood-cjk，再 echo 计算式 marker（避免命令回显造成假阳性）
    for (i, s) in sessions.enumerated() {
        s.send("bash '\(root)/loads/flood-cjk.sh' 3; echo SANITY_\(i)_$((40+2))_OK\n")
    }
    Thread.sleep(forTimeInterval: 5.0)

    var ok = true
    for (i, s) in sessions.enumerated() {
        let marker = "SANITY_\(i)_42_OK"
        let pass = waitFor(timeout: 8) {
            let d = s.dumpPlainText()
            return !d.isEmpty && d.contains(marker)
        }
        let dump = s.dumpPlainText()
        print("session \(i): bytesFed=\(s.bytesFed) dumpBytes=\(dump.utf8.count) marker=\(pass ? "OK" : "MISSING")")
        if !pass { ok = false }
    }
    print(ok ? "SANITY PASS" : "SANITY FAIL")
    return ok ? 0 : 1
}

// MARK: - crc

func runCRC() -> Int32 {
    // 确定性 VT 序列：ASCII / SGR / CJK / emoji（ZWJ、肤色、旗帜）/ 混排
    // 注意：期望行是 formatter plain dump 的预期产物（SGR 被剥掉，文本保留）
    let expected = [
        "L1 plain ASCII 0123456789 abcdefghijklmnopqrstuvwxyz",
        "L2 styled RED GREEN BOLD under",
        "L3 中文宽字符渲染验证汉字宽度",
        "L4 emoji 👍🏽 family 👨‍👩‍👧‍👦 flag 🇨🇳 ok",
        "L5 mixed 混排 width 寬窄 chars ＡＢＣ fullwidth",
        "L6 end",
    ]
    let vtStream =
        "L1 plain ASCII 0123456789 abcdefghijklmnopqrstuvwxyz\r\n"
        + "L2 styled \u{1b}[31mRED\u{1b}[0m \u{1b}[1;32mGREEN\u{1b}[0m \u{1b}[1mBOLD\u{1b}[22m \u{1b}[4munder\u{1b}[24m\r\n"
        + "L3 \u{1b}[38;2;200;30;90m中文宽字符渲染验证汉字宽度\u{1b}[0m\r\n"
        + "L4 emoji 👍🏽 family 👨‍👩‍👧‍👦 flag 🇨🇳 ok\r\n"
        + "L5 mixed 混排 width 寬窄 chars ＡＢＣ fullwidth\r\n"
        + "L6 end"
    let payload = Array(vtStream.utf8)

    func check(mode: String, feed: (TerminalSession) -> Void) -> Bool {
        let session: TerminalSession
        do {
            session = try TerminalSession(
                cols: 80, rows: 24, maxScrollbackLines: 1_000,
                spawnShell: false, label: "crc-\(mode)")
        } catch {
            print("crc[\(mode)] FAIL: \(error)")
            return false
        }
        defer { session.close() }
        feed(session)
        let got = lines(ofDump: session.dumpPlainText())
        var ok = got.count == expected.count
        if !ok {
            print("crc[\(mode)] line count mismatch: got \(got.count), expected \(expected.count)")
        }
        for i in 0..<max(got.count, expected.count) {
            let g = i < got.count ? got[i] : "<missing>"
            let e = i < expected.count ? expected[i] : "<extra>"
            let gc = crc32(g)
            let ec = crc32(e)
            let match = gc == ec
            if !match {
                ok = false
                print("crc[\(mode)] line \(i + 1) MISMATCH crc=\(String(format: "%08X", gc)) expected=\(String(format: "%08X", ec))")
                print("  got:      \(g.debugDescription)")
                print("  expected: \(e.debugDescription)")
            } else {
                print("crc[\(mode)] line \(i + 1) OK \(String(format: "%08X", gc))")
            }
        }
        return ok
    }

    let wholeOK = check(mode: "whole") { $0.feed(payload) }
    let byteOK = check(mode: "1byte") { LoadDriver.feedByteByByte(payload, into: $0) }

    let ok = wholeOK && byteOK
    print(ok ? "CRC PASS" : "CRC FAIL")
    return ok ? 0 : 1
}

// MARK: - winsize

func runWinsize() -> Int32 {
    let session: TerminalSession
    do {
        session = try TerminalSession(
            cols: 80, rows: 24, maxScrollbackLines: 2_000,
            spawnShell: true, label: "winsize")
    } catch {
        print("winsize FAIL: \(error)")
        return 1
    }
    defer { session.close() }

    var ok = true

    // 1) 初始尺寸：stty size 应回 "24 80"
    session.send("stty size\n")
    let initialOK = waitFor(timeout: 8) { session.dumpPlainText().contains("24 80") }
    print("initial stty size 24 80: \(initialOK ? "OK" : "FAIL")")
    ok = ok && initialOK

    // 2) resize 100x30：TIOCSWINSZ + vt 同步
    let resizeOK = session.resize(cols: 100, rows: 30)
    print("resize(100x30) call: \(resizeOK ? "OK" : "FAIL")")
    ok = ok && resizeOK
    Thread.sleep(forTimeInterval: 0.5)

    // 3) 内核侧生效：stty size 应回 "30 100"
    session.send("stty size\n")
    let kernelOK = waitFor(timeout: 8) { session.dumpPlainText().contains("30 100") }
    print("post-resize stty size 30 100 (TIOCSWINSZ): \(kernelOK ? "OK" : "FAIL")")
    ok = ok && kernelOK

    // 4) vt 侧生效：输出 120 个 X，应在第 100 列断行 -> dump 中出现恰好 100 个 X 的一行
    session.send("printf 'X%.0s' {1..120}; echo\n")
    let ruler = String(repeating: "X", count: 100)
    let vtOK = waitFor(timeout: 8) {
        lines(ofDump: session.dumpPlainText()).contains { $0 == ruler }
    }
    print("vt wraps at column 100: \(vtOK ? "OK" : "FAIL")")
    ok = ok && vtOK

    print(ok ? "WINSIZE PASS" : "WINSIZE FAIL")
    return ok ? 0 : 1
}

// MARK: - stress

func runStress(args: [String]) -> Int32 {
    var sessionCount = 8
    var seconds = 30
    var load = LoadKind.mix
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--sessions":
            i += 1
            sessionCount = i < args.count ? Int(args[i]) ?? sessionCount : sessionCount
        case "--seconds":
            i += 1
            seconds = i < args.count ? Int(args[i]) ?? seconds : seconds
        case "--load":
            i += 1
            if i < args.count, let k = LoadKind(rawValue: args[i]) { load = k }
        default:
            FileHandle.standardError.write("unknown stress arg: \(args[i])\n".data(using: .utf8)!)
            return 2
        }
        i += 1
    }

    let root = probeRoot()
    let loadsDir = root + "/loads"

    // 基线：建会话前的 phys_footprint
    Thread.sleep(forTimeInterval: 0.5)
    let baselineMB = Metrics.physFootprintMB()

    // cast 回放素材（ccmix/cast 负载用），按序轮配
    let castDir = loadsDir + "/cast"
    let castFiles = ((try? FileManager.default.contentsOfDirectory(atPath: castDir)) ?? [])
        .filter { $0.hasSuffix(".cast") }.sorted().map { castDir + "/" + $0 }

    var sessions: [TerminalSession] = []
    var replayers: [CastReplayer] = []
    defer {
        replayers.forEach { $0.stop() }
        sessions.forEach { $0.close() }
    }
    do {
        var castIdx = 0
        for idx in 0..<sessionCount {
            let kind = load.resolved(forIndex: idx)
            // cast 回放走隔离模式（无 shell，直灌 vt）；其余经 PTY shell 跑脚本
            let s = try TerminalSession(
                cols: 120, rows: 40, maxScrollbackLines: 10_000,
                spawnShell: kind != .cast, label: "stress\(idx)")
            sessions.append(s)
            if kind == .cast {
                guard !castFiles.isEmpty else {
                    FileHandle.standardError.write("no .cast files in \(castDir)\n".data(using: .utf8)!)
                    return 1
                }
                let r = try CastReplayer(path: castFiles[castIdx % castFiles.count])
                castIdx += 1
                r.start(into: s, speed: 10, loop: true)
                replayers.append(r)
            }
        }
    } catch {
        FileHandle.standardError.write("stress spawn failed: \(error)\n".data(using: .utf8)!)
        return 1
    }
    for (idx, s) in sessions.enumerated() where load.resolved(forIndex: idx) != .cast {
        LoadDriver.startScript(on: s, loadsDir: loadsDir, kind: load, index: idx, seconds: seconds + 15)
    }

    // 周期采样 footprint；wrap 负载的会话由探针侧做程序化连续 resize（reflow 风暴）
    var samples: [Double] = []
    let interval = 0.5
    let totalTicks = max(1, Int(Double(seconds) / interval))
    for tick in 0..<totalTicks {
        Thread.sleep(forTimeInterval: interval)
        samples.append(Metrics.physFootprintMB())
        if tick % 4 == 3 {
            for (idx, s) in sessions.enumerated() where load.resolved(forIndex: idx) == .wrap {
                let shrink = (tick / 4) % 2 == 0
                s.resize(cols: shrink ? 84 : 120, rows: 40)
            }
        }
    }

    let steadyMB = Metrics.steadyStateMB(samples: samples)
    let peakMB = samples.max() ?? 0
    let marginalMB = Metrics.marginalMBPerSession(
        baselineMB: baselineMB, steadyMB: steadyMB, sessions: sessionCount)
    let bytesPerSession = sessions.map { $0.bytesFed }

    let fmt = DateFormatter()
    fmt.dateFormat = "yyyyMMdd-HHmmss"
    fmt.timeZone = TimeZone.current
    let stamp = fmt.string(from: Date())

    let report: [String: Any] = [
        "probe": "term-probe stress",
        "timestamp": stamp,
        "sessions": sessionCount,
        "seconds": seconds,
        "load": load.rawValue,
        "baseline_mb": (baselineMB * 100).rounded() / 100,
        "steady_mb": (steadyMB * 100).rounded() / 100,
        "peak_mb": (peakMB * 100).rounded() / 100,
        "marginal_per_session_mb": (marginalMB * 100).rounded() / 100,
        "samples_mb": samples.map { ($0 * 100).rounded() / 100 },
        "bytes_fed_per_session": bytesPerSession,
        "bytes_fed_total": bytesPerSession.reduce(UInt64(0), +),
    ]
    guard let data = try? JSONSerialization.data(
        withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    else {
        return 1
    }
    let json = String(decoding: data, as: UTF8.self)
    print(json)

    let rawDir = root + "/reports/raw"
    try? FileManager.default.createDirectory(atPath: rawDir, withIntermediateDirectories: true)
    let outPath = rawDir + "/stress-\(stamp)-\(load.rawValue)-s\(sessionCount).json"
    try? (json + "\n").write(toFile: outPath, atomically: true, encoding: .utf8)
    FileHandle.standardError.write("report written: \(outPath)\n".data(using: .utf8)!)
    return 0
}

// MARK: - bench-vt-ingest

func runBenchVTIngest(args: [String]) -> Int32 {
    var castArg = "all"
    var runs = 3
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--cast":
            i += 1
            if i < args.count { castArg = args[i] }
        case "--runs":
            i += 1
            runs = i < args.count ? Int(args[i]) ?? runs : runs
        default:
            FileHandle.standardError.write("unknown bench-vt-ingest arg: \(args[i])\n".data(using: .utf8)!)
            return 2
        }
        i += 1
    }

    let root = probeRoot()
    let castDir = root + "/loads/cast"
    let castFiles: [String]
    if castArg == "all" {
        castFiles = ((try? FileManager.default.contentsOfDirectory(atPath: castDir)) ?? [])
            .filter { $0.hasSuffix(".cast") }.sorted().map { castDir + "/" + $0 }
    } else {
        castFiles = [castArg.hasPrefix("/") ? castArg : castDir + "/" + castArg]
    }
    guard !castFiles.isEmpty else {
        FileHandle.standardError.write("no .cast files in \(castDir)\n".data(using: .utf8)!)
        return 1
    }

    let fmt = DateFormatter()
    fmt.dateFormat = "yyyyMMdd-HHmmss"
    fmt.timeZone = TimeZone.current
    let stamp = fmt.string(from: Date())
    let rawDir = root + "/reports/raw"
    try? FileManager.default.createDirectory(atPath: rawDir, withIntermediateDirectories: true)

    func round4(_ x: Double) -> Double { (x * 10_000).rounded() / 10_000 }
    func distJSON(_ d: IngestBench.Distribution) -> [String: Any] {
        [
            "count": d.count,
            "p50": round4(d.p50Ms), "p95": round4(d.p95Ms),
            "p99": round4(d.p99Ms), "max": round4(d.maxMs),
            "mean": round4(d.meanMs),
        ]
    }

    for path in castFiles {
        let result: IngestBench.Result
        do {
            result = try IngestBench.run(castPath: path, runs: runs)
        } catch {
            FileHandle.standardError.write("bench-vt-ingest failed for \(path): \(error)\n".data(using: .utf8)!)
            return 1
        }
        // 内容真实性：跑完后整屏 dump 必须非空（防 vt 空转出假延迟数据）
        guard result.runs.allSatisfy({ $0.finalDumpBytes > 0 }) else {
            FileHandle.standardError.write("bench-vt-ingest: empty dump after replay of \(path)\n".data(using: .utf8)!)
            return 1
        }

        let castBase = ((path as NSString).lastPathComponent as NSString).deletingPathExtension
        let throughputs = result.runs.map {
            $0.wallSeconds > 0 ? Double($0.bytesFed) / 1_048_576 / $0.wallSeconds : 0
        }
        let report: [String: Any] = [
            "probe": "term-probe bench_vt_ingest",
            "timestamp": stamp,
            "cast_file": (path as NSString).lastPathComponent,
            "cast_events": result.eventCount,
            "cast_duration_s": (result.castDurationSeconds * 100).rounded() / 100,
            "cols": Int(result.cols),
            "rows": Int(result.rows),
            "max_scrollback": 10_000,
            "runs": runs,
            "frame_window_ms": round4(IngestBench.frameWindowSeconds * 1000),
            "feed_ms": distJSON(result.feed),
            "update_ms": distJSON(result.update),
            "active_frames_per_run": result.runs.map { $0.activeFrames },
            "bytes_per_run": result.runs.map { $0.bytesFed },
            "wall_s_per_run": result.runs.map { round4($0.wallSeconds) },
            "throughput_mb_s_per_run": throughputs.map { ($0 * 100).rounded() / 100 },
            "final_dump_bytes_per_run": result.runs.map { $0.finalDumpBytes },
        ]
        guard let data = try? JSONSerialization.data(
            withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        else {
            return 1
        }
        let json = String(decoding: data, as: UTF8.self)
        print(json)

        let outPath = rawDir + "/bench_vt_ingest-\(stamp)-\(castBase).json"
        try? (json + "\n").write(toFile: outPath, atomically: true, encoding: .utf8)
        FileHandle.standardError.write("report written: \(outPath)\n".data(using: .utf8)!)
    }
    return 0
}

// MARK: - 入口

let argv = Array(CommandLine.arguments.dropFirst())
guard let cmd = argv.first else {
    usage()
    exit(2)
}
switch cmd {
case "sanity":
    exit(runSanity())
case "stress":
    exit(runStress(args: Array(argv.dropFirst())))
case "winsize":
    exit(runWinsize())
case "crc":
    exit(runCRC())
case "record":
    exit(runRecord(args: Array(argv.dropFirst())))
case "bench-vt-ingest", "bench_vt_ingest":
    exit(runBenchVTIngest(args: Array(argv.dropFirst())))
case "--help", "-h", "help":
    usage()
    exit(0)
default:
    usage()
    exit(2)
}
