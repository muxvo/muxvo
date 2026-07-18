// composite-probe 入口：程序化 AppKit app。
// 用法（从 probes/composite-probe 运行，需要 GUI/GPU 会话）：
//   swift run -c release composite-probe -- [--tiles 20] [--seconds 60] [--report path.json] [--keep-open]
//   --keep-open：跑完自动化后保持窗口，供人工复核 IME 候选窗定位 / 白闪逐帧视觉。
import AppKit

var tiles = 20
var seconds = 60
var reportPath: String?
var keepOpen = false

let args = Array(CommandLine.arguments.dropFirst())
var i = 0
while i < args.count {
    switch args[i] {
    case "--tiles": i += 1; if i < args.count { tiles = Int(args[i]) ?? tiles }
    case "--seconds": i += 1; if i < args.count { seconds = Int(args[i]) ?? seconds }
    case "--report": i += 1; if i < args.count { reportPath = args[i] }
    case "--keep-open": keepOpen = true
    default: break
    }
    i += 1
}

let app = NSApplication.shared
let delegate = SpikeAppDelegate(tiles: tiles, seconds: seconds, reportPath: reportPath, keepOpen: keepOpen)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
