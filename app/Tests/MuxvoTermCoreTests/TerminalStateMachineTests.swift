import Foundation
import Testing

@testable import MuxvoTermCore

/// spec §2.1 矩阵的机器可读形态：from|event|to 三元组。
private struct Transition: Hashable, CustomStringConvertible {
    let from: TerminalState
    let event: TerminalEvent
    let to: TerminalState
    var description: String { "\(from.rawValue) --\(event.rawValue)--> \(to.rawValue)" }
}

/// 解析 specs/behavior/terminal-session.md §2.1 转移矩阵（文档是 oracle：改表不改文档必红；
/// 比照 MuxvoTaskEngine 解析 task-state-machine.md §4 的做法）。
private enum SpecMatrix {
    static func repoRoot() -> URL {
        // <repo>/app/Tests/MuxvoTermCoreTests/本文件 → 上溯到 <repo>
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // MuxvoTermCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // app
            .deletingLastPathComponent() // <repo>
    }

    static func load() throws -> Set<Transition> {
        let specURL = repoRoot()
            .appendingPathComponent("specs/behavior/terminal-session.md")
        let text = try String(contentsOf: specURL, encoding: .utf8)

        // 截取 §2.1 小节：从 "### 2.1 转移矩阵" 到下一个 "\n### " 或 "\n## "（取更早者）。
        guard let sectionStart = text.range(of: "### 2.1 转移矩阵") else {
            throw SpecParseError("找不到 §2.1 标题")
        }
        let after = text[sectionStart.upperBound...]
        let subEnd = after.range(of: "\n### ")?.lowerBound
        let topEnd = after.range(of: "\n## ")?.lowerBound
        let end = [subEnd, topEnd].compactMap { $0 }.min()
        let section = end.map { after[..<$0] } ?? after

        var transitions: Set<Transition> = []
        let arrowPattern = /([A-Z_]+)→([A-Za-z]+)/
        for line in section.split(separator: "\n") {
            guard line.hasPrefix("|") else { continue }
            let cells = line.split(separator: "|").map {
                $0.trimmingCharacters(in: .whitespaces)
            }
            guard cells.count >= 2 else { continue }
            // from-cell 去反引号（spec 里状态名用 `Created` 包裹）
            let fromCell = cells[0].trimmingCharacters(in: CharacterSet(charactersIn: "`"))
            // 表头 / 分隔行 / 终态无转移行的 from-cell 都不是合法 state → 跳过（不产三元组）
            guard let from = TerminalState(rawValue: fromCell) else { continue }
            for entry in cells[1].split(separator: "；") {
                guard let match = entry.firstMatch(of: arrowPattern) else { continue }
                guard let event = TerminalEvent(rawValue: String(match.1)),
                      let to = TerminalState(rawValue: String(match.2))
                else {
                    throw SpecParseError("无法识别的迁移条目：\(entry)")
                }
                transitions.insert(Transition(from: from, event: event, to: to))
            }
        }
        return transitions
    }

    struct SpecParseError: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }
}

@Suite("TerminalStateMachine（spec §2.1 v1-frozen 为 oracle）")
struct TerminalStateMachineTests {
    @Test("transitionTable 与 spec §2.1 矩阵机器比对一致")
    func tableMatchesSpecMatrix() throws {
        let specTransitions = try SpecMatrix.load()
        var tableTransitions: Set<Transition> = []
        for (from, row) in TerminalStateMachine.transitionTable {
            for (event, to) in row {
                tableTransitions.insert(Transition(from: from, event: event, to: to))
            }
        }
        // 集合相等 = 双向无遗漏无多余（解析失败→空集时与非空 table 必不等，无假绿面）
        #expect(specTransitions == tableTransitions, """
        spec 独有：\(specTransitions.subtracting(tableTransitions))
        table 独有：\(tableTransitions.subtracting(specTransitions))
        """)
        // §2.1 实拍 16 条合法迁移（created1 starting2 running4 busy1 waitingInput2 stopping2
        // stopped1 disconnected2 failed1 removed0）
        #expect(specTransitions.count == 16)
        // transitionTable 须覆盖全部 10 态（终态 Removed 行为空但必须在表内留位）
        #expect(Set(TerminalStateMachine.transitionTable.keys) == Set(TerminalState.allCases))
    }

    @Test("10 态 × 14 事件笛卡尔积穷举（oracle=spec 矩阵；未命中静默忽略=nil）")
    func exhaustiveCartesianProduct() throws {
        let specTransitions = try SpecMatrix.load()
        var specTarget: [TerminalState: [TerminalEvent: TerminalState]] = [:]
        for t in specTransitions { specTarget[t.from, default: [:]][t.event] = t.to }

        var combinations = 0
        for state in TerminalState.allCases {
            for event in TerminalEvent.allCases {
                combinations += 1
                let result = TerminalStateMachine.next(event, from: state)
                if let to = specTarget[state]?[event] {
                    #expect(result == to, "\(state) × \(event)")
                } else {
                    // 表外组合一律 nil（宽松语义：send 会静默忽略保持原态）
                    #expect(result == nil, "\(state) × \(event) 应静默忽略（nil）")
                }
            }
        }
        #expect(combinations == 140)
    }

    @Test("send 宽松语义：命中推进返回 true；未命中静默保持原态返回 false")
    func sendLenientSemantics() {
        var m = TerminalStateMachine() // 初态 .created
        #expect(m.state == .created)

        // 命中：Created --SPAWN--> Starting
        #expect(m.send(.spawn) == true)
        #expect(m.state == .starting)

        // 未命中：Starting 上 USER_INPUT 无边 → 静默保持 Starting，返回 false
        #expect(m.send(.userInput) == false)
        #expect(m.state == .starting)

        // 命中：Starting --SPAWN_SUCCESS--> Running；再 CLOSE→Stopping；EXIT_NORMAL→Stopped
        #expect(m.send(.spawnSuccess) == true)
        #expect(m.state == .running)
        #expect(m.send(.close) == true)
        #expect(m.state == .stopping)
        #expect(m.send(.exitNormal) == true)
        #expect(m.state == .stopped)

        // 终态 Removed 无出边：任何事件静默忽略
        var terminal = TerminalStateMachine(state: .removed)
        for event in TerminalEvent.allCases {
            #expect(terminal.send(event) == false)
            #expect(terminal.state == .removed)
        }
    }

    @Test("枚举基数：10 态 / 14 事件")
    func enumCardinality() {
        #expect(TerminalState.allCases.count == 10)
        #expect(TerminalEvent.allCases.count == 14)
    }
}
