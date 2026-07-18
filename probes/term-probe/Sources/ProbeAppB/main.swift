// ProbeAppB 入口：程序化 AppKit app，applicationDidFinishLaunching 后自动跑场景并退出。
// 用法（从 probes/term-probe 目录运行，需要本机 GUI 会话）：
//   swift run -c release ProbeAppB -- --seconds 60 --cycles 100 --sessions 20 [--report path.json]
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
