// muxvo-term-bench：bench_input_to_pixel 宿主入口（terminal-rendering.md §8，批 4①）。
//
// 用法：muxvo-term-bench [--scene cat|zsh] [--keys N] [--spacing-ms M] [--mode auto|gpu|cpu]
//                        [--report PATH] [--cols C] [--rows R] [--flush-every N]
//   --scene   cat（主判据，/bin/cat 行规程 echo，判 p99<16ms）/ zsh（zsh -f 提示符，参考不判红）
//   --mode    auto（有 GPU present 走 gpu，否则降级 cpu-segment）/ gpu / cpu
//   --report  写 markdown+JSON 报告到该路径（JSON 亦打到 stdout）
import AppKit

func parseOptions() -> BenchOptions {
    var o = BenchOptions()
    let args = Array(CommandLine.arguments.dropFirst())
    func next(_ i: inout Int) -> String? { i += 1; return i < args.count ? args[i] : nil }
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--scene": if let v = next(&i), let s = BenchScene(rawValue: v) { o.scene = s }
        case "--keys": if let v = next(&i), let n = Int(v) { o.keys = n }
        case "--spacing-ms": if let v = next(&i), let n = Int(v) { o.spacingMs = n }
        case "--mode": if let v = next(&i), let m = BenchMode(rawValue: v) { o.mode = m }
        case "--report": o.reportPath = next(&i)
        case "--cols": if let v = next(&i), let n = UInt16(v) { o.cols = n }
        case "--rows": if let v = next(&i), let n = UInt16(v) { o.rows = n }
        case "--flush-every": if let v = next(&i), let n = Int(v) { o.flushEvery = n }
        case "--settle-ms": if let v = next(&i), let n = Int(v) { o.settleMs = n }
        case "--help", "-h":
            print("""
            muxvo-term-bench —— bench_input_to_pixel 宿主
            --scene cat|zsh   --keys N   --spacing-ms M   --mode auto|gpu|cpu
            --report PATH     --cols C   --rows R         --flush-every N  --settle-ms M
            """)
            exit(0)
        default:
            FileHandle.standardError.write("未知参数：\(args[i])\n".data(using: .utf8)!)
            exit(2)
        }
        i += 1
    }
    return o
}

let options = parseOptions()
let app = NSApplication.shared
let delegate = BenchAppDelegate(options: options)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
