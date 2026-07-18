// TerminalAutoResponse：终端自应答识别（wait-detector.md §3 reset 排除项）。
//
// reset_on_user_input 挂 PTY 用户写入路径（§3），但终端仿真器对 vt 查询的**自应答**字节
// （光标位置报告 / 焦点事件 / 设备属性）不是「用户输入」，不得触发 USER_INPUT 清红。
// 行为锚点亲验 legacy manager.ts:25-34 `isTerminalAutoResponse`（读行为不抄结构：legacy 用
// 三条正则，本实现走等价 byte-level 匹配，避开正则分配、且写路径 O(prefix) 短路）。
//
// 判据（三选一，且整帧仅此一条控制序列——多字节混合帧含真实用户字节即视作用户输入）：
//   ① 光标位置报告 CPR：`ESC [ <行数> ; <列数> R`（legacy `^\x1b\[\d+;\d+R$`）
//   ② 焦点事件：`ESC [ I`（focus in）/ `ESC [ O`（focus out）（legacy `^\x1b\[[IO]$`）
//   ③ 设备属性 DA 响应：`ESC [ ? <数字;> c`（legacy `^\x1b\[\?[\d;]*c$`）
//
// 本架构下自应答实际经 WRITE_PTY 回调（handleWritePty）单独成路，用户键盘/粘贴才经公开 write()；
// 本分类器作**防御纵深**（万一自应答字节混入 write() 路径也不误清红）+ 满足 §10 WD_reset_on_write
// 断言「终端自应答不 reset」的可单测纯函数。
import Foundation

public enum TerminalAutoResponse {
    private static let esc: UInt8 = 0x1B   // ESC
    private static let lbracket: UInt8 = 0x5B  // [

    /// 该写入帧是否为纯终端自应答（不应触发 USER_INPUT reset）。空帧 → false（无信号）。
    public static func isAutoResponse(_ bytes: [UInt8]) -> Bool {
        // 最短自应答 `ESC [ I` = 3 字节；`ESC [ ? c` = 4 字节。
        guard bytes.count >= 3, bytes[0] == esc, bytes[1] == lbracket else { return false }
        let body = bytes[2...]   // ESC[ 之后
        return matchesCPR(body) || matchesFocus(body) || matchesDeviceAttributes(body)
    }

    // MARK: 私有（ArraySlice，index 从 2 起）

    private static let semicolon: UInt8 = 0x3B  // ;
    private static let question: UInt8 = 0x3F   // ?
    private static let charR: UInt8 = 0x52      // R
    private static let charI: UInt8 = 0x49      // I
    private static let charO: UInt8 = 0x4F      // O
    private static let charC: UInt8 = 0x63      // c

    private static func isDigit(_ b: UInt8) -> Bool { b >= 0x30 && b <= 0x39 }

    /// `<digits> ; <digits> R`（末尾 R，中间一个分号分两段数字，各 ≥1 位）。
    private static func matchesCPR(_ body: ArraySlice<UInt8>) -> Bool {
        guard body.last == charR else { return false }
        let inner = body.dropLast()   // digits ; digits
        guard let semi = inner.firstIndex(of: semicolon) else { return false }
        let row = inner[inner.startIndex..<semi]
        let col = inner[inner.index(after: semi)...]
        guard !row.isEmpty, !col.isEmpty else { return false }
        // 分号必须唯一（否则形状不符）。
        guard !col.contains(semicolon) else { return false }
        return row.allSatisfy(isDigit) && col.allSatisfy(isDigit)
    }

    /// 单字符 `I` 或 `O`（焦点事件）。
    private static func matchesFocus(_ body: ArraySlice<UInt8>) -> Bool {
        body.count == 1 && (body.first == charI || body.first == charO)
    }

    /// `? <digits/;>* c`（设备属性响应；`?` 后允许空或数字与分号，末尾 c）。
    private static func matchesDeviceAttributes(_ body: ArraySlice<UInt8>) -> Bool {
        guard body.first == question, body.last == charC else { return false }
        let inner = body.dropFirst().dropLast()   // ? 与 c 之间
        return inner.allSatisfy { isDigit($0) || $0 == semicolon }
    }
}
