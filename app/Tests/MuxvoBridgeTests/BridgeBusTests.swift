// BridgeBus 核心单测：全部走 handleIncoming(_:) + 注入 pushSink，零 WebKit 依赖。
// WK 适配层（BridgeScriptMessageHandler/WebViewPushSink）是无逻辑薄壳且 WKScriptMessage
// 不可构造，不进单测——端到端由 app.sh run 冒烟 + visual-diff bridge-isolation 兜底。
// 命名纪律：除 ERROR_L1_01（spec 认领）外，测试显示名一律中文开头（spec-runner 防伪面）。
// handleIncoming 自 M3（桥 v2）起为 async——term.command（#4）需 await 原生工作；同步消息 handler
// body 不 await，全程 @MainActor 主线程无 actor 跨域跳。
import Foundation
import Testing

@testable import MuxvoBridge

@MainActor
@Suite("BridgeBus 核心：信封、握手门控、队列合并")
struct BridgeBusTests {
    // MARK: - 工具

    /// push 收集器：sink 闭包写入 class box，测试读取
    final class SentBox {
        var envelopes: [[String: Any]] = []
    }

    private func makeBus(appVersion: String = "0.0.0-test") -> (BridgeBus, SentBox) {
        let bus = BridgeBus(appVersion: appVersion)
        let box = SentBox()
        bus.pushSink = { box.envelopes.append($0) }
        return (bus, box)
    }

    private func envelope(_ type: String, payload: Any? = nil) -> [String: Any] {
        var e: [String: Any] = ["v": 1, "type": type]
        if let payload { e["payload"] = payload }
        return e
    }

    private func helloPayload(version: Int = BridgeProtocol.version) -> [String: Any] {
        ["protocolVersion": version, "webBuild": "test"]
    }

    private func isOk(_ reply: [String: Any]) -> Bool {
        reply["ok"] as? Bool == true
    }

    private func errorCode(_ reply: [String: Any]) -> String? {
        (reply["error"] as? [String: Any])?["code"] as? String
    }

    private func sentType(_ envelope: [String: Any]) -> String? {
        envelope["type"] as? String
    }

    /// ui.state 信封 → snapshot 的 state.id
    private func snapshotStateId(_ envelope: [String: Any]) -> String? {
        let payload = envelope["payload"] as? [String: Any]
        return (payload?["state"] as? [String: Any])?["id"] as? String
    }

    private func makeState(id: String) -> UIState {
        UIState(
            id: id, theme: .dark, homePath: "/Users/test", viewMode: .tiling,
            focusedId: nil, selectedId: nil, activeSidebarId: nil, maxReached: false,
            dragging: nil, dragOver: nil, editing: nil, waitingNotification: nil, searchBar: nil,
            quitConfirm: nil, restoreBanner: nil,
            terminals: [], palette: Palette(background: "#1e1e1e", foreground: "#cccccc")
        )
    }

    // MARK: - 错误信封形状（spec 认领）

    @Test("ERROR_L1_01: 统一错误响应格式 {code, message, details?}")
    func unifiedErrorEnvelope() async {
        let (bus, _) = makeBus()
        let reply = await bus.handleIncoming(envelope("nonsense.type"))
        // 错误一律结构化回包 {ok:false, error:{code,message}}，不 reject（bridge-v1.md §2，
        // 对应 legacy spec target error.responseFormat）
        #expect(reply["ok"] as? Bool == false)
        let error = reply["error"] as? [String: Any]
        #expect(error != nil)
        // code：机器可读标识（非空、SCREAMING_SNAKE 形）
        let code = error?["code"] as? String
        #expect(code != nil && !code!.isEmpty)
        #expect(code!.allSatisfy { $0.isUppercase || $0 == "_" })
        // message：人类可读说明（非空字符串）
        let message = error?["message"] as? String
        #expect(message != nil && !message!.isEmpty)
        // details 可选：缺省合法——error 对象只含已定义键
        #expect(error!.keys.allSatisfy { ["code", "message", "details"].contains($0) })
    }

    // MARK: - 信封 round-trip 与错误码界线

    @Test("信封 round-trip：hello 回 ok:true 与完整 HelloResponse")
    func helloRoundTrip() async throws {
        let (bus, _) = makeBus(appVersion: "9.9.9-test")
        let reply = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        #expect(isOk(reply))
        // 回包 payload 经 JSON 往返 decode 回 Gen 类型，证明双向 schema 一致
        let payload = try #require(reply["payload"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: payload)
        let response = try JSONDecoder().decode(HelloResponse.self, from: data)
        #expect(response.protocolVersion == BridgeProtocol.version)
        #expect(response.appVersion == "9.9.9-test")
        // M3：term.command 激活；M5 批0：chat.request（#5）激活；M6 批0：config.request/app.request/data.event 激活；
        // M6 批2：fs.request（#6）激活 → 插 chat.request 与 config.request 之间（allCases=消息插入序）；
        // M4a 批4 波1b：orch 四条激活 → 末 4 项；埋点批2（v35）：app.telemetry 激活（协议已无 stub）。
        // active 序 = allCases（= protocol.json 消息插入序）过滤 active。
        // 公开仓 core-only：无 orch 四条消息，active = 10 条核心消息。
        #expect(response.active == [
            "bridge.hello", "ui.state", "ui.action", "term.command",
            "chat.request", "fs.request", "config.request", "app.request", "data.event",
            "app.telemetry",
        ])
    }

    @Test("台账外未知 type 回 BAD_REQUEST")
    func unknownTypeBadRequest() async {
        let (bus, _) = makeBus()
        let reply = await bus.handleIncoming(envelope("nonsense.foo"))
        #expect(!isOk(reply))
        #expect(errorCode(reply) == "BAD_REQUEST")
    }

    // 「stub 回 UNIMPLEMENTED」历史用例退役（埋点批2）：app.telemetry 为最后一条 stub，v35 激活后
    // 协议已无 stub 消息；语义由下方 telemetry 专项用例接棒。

    @Test("AN_bridge_telemetry_decode: app.telemetry 合法 payload → onTelemetry 收同值事件、回 ok（analytics.md §4）")
    func telemetryDecodeAndForward() async {
        let (bus, _) = makeBus()
        var received: [TelemetryEvent] = []
        bus.onTelemetry = { received.append($0) }
        let reply = await bus.handleIncoming(envelope("app.telemetry", payload: [
            "metric": "settings.theme_changed",
            "value": 1,
            "params": [["key": "theme", "value": "dark"]],
        ]))
        #expect(isOk(reply))
        #expect(received == [TelemetryEvent(
            metric: "settings.theme_changed", value: 1,
            params: [KeyValue(key: "theme", value: "dark")])])
        // 可选字段缺省同样合法（value/params optional）。
        let minimal = await bus.handleIncoming(envelope("app.telemetry", payload: ["metric": "skills.opened"]))
        #expect(isOk(minimal))
        #expect(received.count == 2)
        #expect(received[1] == TelemetryEvent(metric: "skills.opened", value: nil, params: nil))
    }

    @Test("AN_bridge_telemetry_bad_payload: 坏 payload → BAD_REQUEST 不 crash、onTelemetry 不触发")
    func telemetryBadPayload() async {
        let (bus, _) = makeBus()
        var received: [TelemetryEvent] = []
        bus.onTelemetry = { received.append($0) }
        for bad in [nil, ["nonsense": true], ["metric": 42]] as [Any?] {
            let reply = await bus.handleIncoming(envelope("app.telemetry", payload: bad))
            #expect(errorCode(reply) == "BAD_REQUEST")
        }
        #expect(received.isEmpty)
    }

    @Test("M6 批0 激活的 config.request/app.request（request 未接处理器）回 UNAVAILABLE、data.event（push）被上行调用回 BAD_REQUEST")
    func m6Batch0ActivatedSemantics() async {
        let (bus, _) = makeBus()
        // config.request/app.request 是 request（web→native）：active 但原生处理器批后接线 → 信封层 UNAVAILABLE（同 term.command 未接线路径）
        let configReply = await bus.handleIncoming(envelope("config.request", payload: ["kind": "get"]))
        #expect(errorCode(configReply) == "UNAVAILABLE", "config.request 未接处理器应回 UNAVAILABLE")
        let appReply = await bus.handleIncoming(envelope("app.request", payload: ["kind": "selectDirectory"]))
        #expect(errorCode(appReply) == "UNAVAILABLE", "app.request 未接处理器应回 UNAVAILABLE")
        // data.event 是 push（native→web）：web 上行调用属请求格式错误 → BAD_REQUEST（同 ui.state / orch.state 先例）
        let dataReply = await bus.handleIncoming(envelope("data.event"))
        #expect(errorCode(dataReply) == "BAD_REQUEST", "data.event 被上行调用应回 BAD_REQUEST")
    }

    // 编排四条消息语义断言（orch.command/query/state/transcript）——公开仓 core-only 协议无这四条消息类型，
    // 上行会得 BAD_REQUEST（未知 type）而非 UNAVAILABLE，故整测编排专属，条件编译。

    @Test("active 但方向 native→web 的 ui.state 被上行调用回 BAD_REQUEST")
    func uiStateUpstreamBadRequest() async {
        let (bus, _) = makeBus()
        let reply = await bus.handleIncoming(envelope("ui.state", payload: ["kind": "snapshot"]))
        #expect(errorCode(reply) == "BAD_REQUEST")
    }

    @Test("payload 不符 schema 回 BAD_REQUEST")
    func schemaViolationBadRequest() async {
        let (bus, _) = makeBus()
        // 缺必填字段
        let missing = await bus.handleIncoming(envelope("bridge.hello", payload: ["webBuild": "x"]))
        #expect(errorCode(missing) == "BAD_REQUEST")
        // 字段类型错误
        let wrongType = await bus.handleIncoming(
            envelope("bridge.hello", payload: ["protocolVersion": "one", "webBuild": "x"]))
        #expect(errorCode(wrongType) == "BAD_REQUEST")
        // payload 整个缺失
        let absent = await bus.handleIncoming(envelope("bridge.hello"))
        #expect(errorCode(absent) == "BAD_REQUEST")
    }

    @Test("信封不合形：非对象 body、v 不支持、type 缺失均回 BAD_REQUEST")
    func malformedEnvelopeBadRequest() async {
        let (bus, _) = makeBus()
        #expect(errorCode(await bus.handleIncoming("just a string")) == "BAD_REQUEST")
        #expect(errorCode(await bus.handleIncoming(["v": 2, "type": "bridge.hello"])) == "BAD_REQUEST")
        #expect(errorCode(await bus.handleIncoming(["v": 1])) == "BAD_REQUEST")
    }

    // MARK: - 握手门控与队列

    @Test("hello 版本不匹配回 VERSION_MISMATCH 且握手门不开")
    func versionMismatchKeepsGateClosed() async {
        let (bus, box) = makeBus()
        let reply = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload(version: 999)))
        #expect(errorCode(reply) == "VERSION_MISMATCH")
        #expect(!bus.handshaken)
        // 门未开：push 仍入队不直发
        bus.pushUIState(makeState(id: "s1"))
        #expect(box.envelopes.isEmpty)
        #expect(bus.queue.count == 1)
    }

    @Test("握手前 push 入队，hello 后按入队序 flush")
    func queueFlushedInOrderAfterHello() async {
        let (bus, box) = makeBus()
        bus.pushUIState(makeState(id: "s1"))
        bus.push(type: .dataEvent, payloadObject: ["domain": "test"], coalesce: false)
        #expect(box.envelopes.isEmpty) // 握手前零直发
        let reply = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        #expect(isOk(reply))
        #expect(box.envelopes.count == 2)
        #expect(sentType(box.envelopes[0]) == "ui.state")
        #expect(sentType(box.envelopes[1]) == "data.event")
        #expect(bus.queue.isEmpty)
    }

    @Test("队内 ui.state 合并只保留最新且保持原队位")
    func uiStateCoalescedInPlace() async {
        let (bus, box) = makeBus()
        bus.pushUIState(makeState(id: "sA"))
        bus.push(type: .dataEvent, payloadObject: ["domain": "test"], coalesce: false)
        bus.pushUIState(makeState(id: "sB")) // 就地替换 sA，仍在队首
        #expect(bus.queue.count == 2)
        _ = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        #expect(box.envelopes.count == 2)
        #expect(sentType(box.envelopes[0]) == "ui.state")
        #expect(snapshotStateId(box.envelopes[0]) == "sB") // 只剩最新
        #expect(sentType(box.envelopes[1]) == "data.event")
    }

    @Test("hello 幂等重入：清队列并补推一条最新 snapshot")
    func helloReentrantResendsLatestSnapshot() async {
        let (bus, box) = makeBus()
        _ = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        bus.pushUIState(makeState(id: "s1")) // 已握手：直发
        #expect(box.envelopes.count == 1)
        box.envelopes.removeAll()
        let reply = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        #expect(isOk(reply))
        #expect(box.envelopes.count == 1)
        #expect(sentType(box.envelopes[0]) == "ui.state")
        #expect(snapshotStateId(box.envelopes[0]) == "s1")
        #expect(bus.queue.isEmpty)
    }

    @Test("didCommit 重置后 push 重新入队，再握手恢复最新态恰一条")
    func resetThenRehandshakeRecoversLatest() async {
        let (bus, box) = makeBus()
        _ = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        bus.pushUIState(makeState(id: "s1"))
        box.envelopes.removeAll()
        bus.resetHandshake() // didCommit：门关 + 预灌 s1
        #expect(!bus.handshaken)
        bus.pushUIState(makeState(id: "s2")) // 入队并与预灌 s1 合并
        #expect(box.envelopes.isEmpty)
        _ = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        #expect(box.envelopes.count == 1) // 合并后恰一条，且是最新
        #expect(snapshotStateId(box.envelopes[0]) == "s2")
    }

    // MARK: - ui.action

    @Test("ui.action tileClick 分发到 action handler 并立即回 ok payload:null")
    func tileClickDispatched() async {
        let (bus, _) = makeBus()
        var received: UIAction?
        bus.onAction = { received = $0 }
        let reply = await bus.handleIncoming(
            envelope("ui.action", payload: ["kind": "tileClick", "terminalId": "t1"]))
        #expect(received == .tileClick(terminalId: "t1"))
        #expect(isOk(reply))
        #expect(reply["payload"] is NSNull) // event 模式：payload:null（§2）
    }

    @Test("ui.action M3 新分支全 decode：选中/最大化/回平铺/重命名/清红/重排/分隔条/搜索/布局上报")
    func uiActionNewVariantsDecoded() async {
        let (bus, _) = makeBus()
        var received: [UIAction] = []
        bus.onAction = { received.append($0) }
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "sidebarSelect", "terminalId": "t2"]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "maximizeTile", "terminalId": "t1"]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "restoreTiling"]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "renameSubmit", "terminalId": "t1", "name": "api"]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "acknowledgeWaiting", "terminalId": "t3"]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "reorder", "order": ["t2", "t1"]]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "gridResize", "columnRatios": [0.5, 0.5], "rowRatios": [1.0]]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "searchQuery", "terminalId": "t1", "query": "err"]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "searchClose", "terminalId": "t1"]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: [
            "kind": "layoutReport", "stateId": "s1",
            "rects": [["terminalId": "t1", "x": 0.0, "y": 0.0, "w": 100.0, "h": 50.0, "visible": true, "role": "grid"]],
        ]))
        #expect(received.count == 10)
        #expect(received[0] == .sidebarSelect(terminalId: "t2"))
        #expect(received[1] == .maximizeTile(terminalId: "t1"))
        #expect(received[2] == .restoreTiling)
        #expect(received[3] == .renameSubmit(terminalId: "t1", name: "api"))
        #expect(received[4] == .acknowledgeWaiting(terminalId: "t3"))
        #expect(received[5] == .reorder(order: ["t2", "t1"]))
        #expect(received[6] == .gridResize(columnRatios: [0.5, 0.5], rowRatios: [1.0]))
        #expect(received[7] == .searchQuery(terminalId: "t1", query: "err"))
        #expect(received[8] == .searchClose(terminalId: "t1"))
        #expect(received[9] == .layoutReport(
            stateId: "s1",
            rects: [TermRect(terminalId: "t1", x: 0, y: 0, w: 100, h: 50, visible: true, role: .grid)],
            viewportW: nil, viewportH: nil
        ))
    }

    @Test("ui.action 退出确认分支 decode：confirmQuit / cancelQuit 无载荷（DOGFOOD_M3_19）")
    func uiActionQuitVariantsDecoded() async {
        let (bus, _) = makeBus()
        var received: [UIAction] = []
        bus.onAction = { received.append($0) }
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "confirmQuit"]))
        _ = await bus.handleIncoming(envelope("ui.action", payload: ["kind": "cancelQuit"]))
        #expect(received.count == 2)
        #expect(received[0] == .confirmQuit)
        #expect(received[1] == .cancelQuit)
    }

    @Test("F2 穿透岛：TermRect role=island decode + layoutReport 混装洞与岛各归位")
    func termRectIslandDecoded() async throws {
        // 单个 TermRect（role=island）直 decode：新增枚举值可解，哨兵 id 保真。
        let json = #"{"terminalId":"_island","x":1400,"y":820,"w":44,"h":44,"visible":true,"role":"island"}"#
        let rect = try JSONDecoder().decode(TermRect.self, from: Data(json.utf8))
        #expect(rect.role == .island)
        #expect(rect.terminalId == "_island")

        // layoutReport 携带「洞 + 岛」混装：两 rect 均 decode、role 各归位（native 侧据 role 分穿透区/岛）。
        let (bus, _) = makeBus()
        var received: UIAction?
        bus.onAction = { received = $0 }
        _ = await bus.handleIncoming(envelope("ui.action", payload: [
            "kind": "layoutReport", "stateId": "s1",
            "rects": [
                ["terminalId": "t1", "x": 0.0, "y": 0.0, "w": 100.0, "h": 50.0, "visible": true, "role": "grid"],
                ["terminalId": "_island", "x": 1400.0, "y": 820.0, "w": 44.0, "h": 44.0, "visible": true, "role": "island"],
            ],
        ]))
        #expect(received == .layoutReport(
            stateId: "s1",
            rects: [
                TermRect(terminalId: "t1", x: 0, y: 0, w: 100, h: 50, visible: true, role: .grid),
                TermRect(terminalId: "_island", x: 1400, y: 820, w: 44, h: 44, visible: true, role: .island),
            ],
            viewportW: nil, viewportH: nil
        ))
    }

    // MARK: - term.command（#4，M3 激活）

    @Test("term.command create 分发到 onTermCommand 闭包并回传 created")
    func termCommandCreateDispatched() async throws {
        let (bus, _) = makeBus()
        var received: TermCommandRequest?
        bus.onTermCommand = { req in
            received = req
            return .created(terminalId: "t-new", pid: 4242)
        }
        let reply = await bus.handleIncoming(
            envelope("term.command", payload: ["kind": "create", "cwd": "/Users/test/proj"]))
        #expect(received == .create(cwd: "/Users/test/proj"))
        #expect(isOk(reply))
        let payload = try #require(reply["payload"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: payload)
        let resp = try JSONDecoder().decode(TermCommandResponse.self, from: data)
        #expect(resp == .created(terminalId: "t-new", pid: 4242))
    }

    @Test("term.command 业务失败 rejected 透传为 ok:true 的类型化 payload（不占信封错误）")
    func termCommandRejectedPassthrough() async throws {
        let (bus, _) = makeBus()
        bus.onTermCommand = { _ in .rejected(code: .maxReached, message: "已达上限") }
        let reply = await bus.handleIncoming(envelope("term.command", payload: ["kind": "create"]))
        // 草案 §2：业务失败走 rejected 分支，信封仍 {ok:true}
        #expect(isOk(reply))
        let payload = try #require(reply["payload"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: payload)
        let resp = try JSONDecoder().decode(TermCommandResponse.self, from: data)
        #expect(resp == .rejected(code: .maxReached, message: "已达上限"))
    }

    @Test("term.command 无原生处理器（onTermCommand=nil）回 UNAVAILABLE")
    func termCommandUnavailableWithoutHandler() async {
        let (bus, _) = makeBus()
        // 不设 onTermCommand（TerminalService 未接线）
        let reply = await bus.handleIncoming(
            envelope("term.command", payload: ["kind": "close", "terminalId": "t1"]))
        #expect(errorCode(reply) == "UNAVAILABLE")
    }

    @Test("term.command payload 不符 schema 回 BAD_REQUEST（含未知 kind）")
    func termCommandBadSchema() async {
        let (bus, _) = makeBus()
        bus.onTermCommand = { _ in .closed(terminalId: "x") }
        // 缺 kind
        let noKind = await bus.handleIncoming(envelope("term.command", payload: ["cwd": "/x"]))
        #expect(errorCode(noKind) == "BAD_REQUEST")
        // 未知 kind
        let unknownKind = await bus.handleIncoming(
            envelope("term.command", payload: ["kind": "teleport"]))
        #expect(errorCode(unknownKind) == "BAD_REQUEST")
        // close 缺必填 terminalId
        let missingField = await bus.handleIncoming(
            envelope("term.command", payload: ["kind": "close"]))
        #expect(errorCode(missingField) == "BAD_REQUEST")
    }

    @Test("term.command zoom 枚举 action round-trip（in/out/reset）")
    func termCommandZoomRoundTrip() async {
        let (bus, _) = makeBus()
        var received: TermCommandRequest?
        bus.onTermCommand = { req in
            received = req
            return .zoomed(fontSize: 15)
        }
        let reply = await bus.handleIncoming(
            envelope("term.command", payload: ["kind": "zoom", "action": "reset"]))
        #expect(received == .zoom(action: .reset))
        #expect(isOk(reply))
    }

    // MARK: - orch 四条接线（波2a）——公开仓无编排整段不编译（引 OrchCommand/Query/State/Transcript Gen 类型）


    @Test("onHandshake 回调在 hello 成功后触发（3a 接 forceSnapshot 冷启动重推）")
    func onHandshakeFiresAfterHello() async {
        let (bus, _) = makeBus()
        var fired = 0
        bus.onHandshake = { fired += 1 }
        _ = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        #expect(fired == 1)
    }

    // MARK: - chat.request（#5，M5 批0 激活）/ data.event（#9，push）

    @Test("chat.request 分发到 onChatRequest 闭包并回传 projects；无处理器回 UNAVAILABLE")
    func chatRequestDispatched() async throws {
        let (bus, _) = makeBus()
        // 无处理器（Chat 服务未接线，批3 装配前）→ UNAVAILABLE（须先给合法 payload 过 decode，
        // 才走到 onChatRequest=nil 的 guard——decode 失败会先回 BAD_REQUEST）
        let unavailable = await bus.handleIncoming(envelope("chat.request", payload: ["kind": "projects"]))
        #expect(errorCode(unavailable) == "UNAVAILABLE", "chat.request 未接处理器应回 UNAVAILABLE")
        // 接闭包后往返
        var received: ChatRequest?
        bus.onChatRequest = { req in
            received = req
            return .projects(projects: [], ccDetected: true)
        }
        let reply = await bus.handleIncoming(envelope("chat.request", payload: ["kind": "projects"]))
        #expect(received == .projects)
        #expect(isOk(reply))
        let payload = try #require(reply["payload"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: payload)
        let resp = try JSONDecoder().decode(ChatResponse.self, from: data)
        #expect(resp == .projects(projects: [], ccDetected: true))
    }

    @Test("chat.request rejected 透传为 ok:true 的类型化 payload；payload 不符 schema 回 BAD_REQUEST")
    func chatRequestRejectedAndBadSchema() async throws {
        let (bus, _) = makeBus()
        bus.onChatRequest = { _ in .rejected(code: "NOT_FOUND", message: "会话不存在") }
        // 业务失败走 rejected 分支，信封仍 {ok:true}（§2，同 term.command/orch.command 先例）
        let reply = await bus.handleIncoming(envelope("chat.request", payload: [
            "kind": "session", "projectHash": "p1", "sessionId": "s1",
        ]))
        #expect(isOk(reply))
        let payload = try #require(reply["payload"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: payload)
        let resp = try JSONDecoder().decode(ChatResponse.self, from: data)
        #expect(resp == .rejected(code: "NOT_FOUND", message: "会话不存在"))
        // 未知 kind → BAD_REQUEST
        let badKind = await bus.handleIncoming(envelope("chat.request", payload: ["kind": "teleport"]))
        #expect(errorCode(badKind) == "BAD_REQUEST")
        // 缺必填字段（session 缺 sessionId）→ BAD_REQUEST
        let missing = await bus.handleIncoming(
            envelope("chat.request", payload: ["kind": "session", "projectHash": "p1"]))
        #expect(errorCode(missing) == "BAD_REQUEST")
    }

    @Test("data.event 是 native→web 推送，被 web 上行调用回 BAD_REQUEST（同 ui.state/orch.state 先例）")
    func dataEventUpstreamBadRequest() async {
        let (bus, _) = makeBus()
        let reply = await bus.handleIncoming(envelope("data.event"))
        #expect(errorCode(reply) == "BAD_REQUEST")
    }

    // MARK: - config.request / app.request（#7/#8，M6 批1 接线）

    @Test("config.request 分发到 onConfigRequest 闭包并回传 snapshot；无处理器回 UNAVAILABLE；坏 schema 回 BAD_REQUEST")
    func configRequestDispatch() async throws {
        let (bus, _) = makeBus()
        // 无处理器 → UNAVAILABLE
        let unavailable = await bus.handleIncoming(envelope("config.request", payload: ["kind": "get"]))
        #expect(errorCode(unavailable) == "UNAVAILABLE")
        // 接闭包后往返（回 getSettings 类型化 payload）
        var received: ConfigRequest?
        bus.onConfigRequest = { req in
            received = req
            return .settingsJson(json: "{}")
        }
        let reply = await bus.handleIncoming(envelope("config.request", payload: ["kind": "getSettings"]))
        #expect(received == .getSettings)
        #expect(isOk(reply))
        let payload = try #require(reply["payload"] as? [String: Any])
        let resp = try JSONDecoder().decode(
            ConfigResponse.self, from: JSONSerialization.data(withJSONObject: payload))
        #expect(resp == .settingsJson(json: "{}"))
        // 坏 schema（未知 kind）→ BAD_REQUEST
        let bad = await bus.handleIncoming(envelope("config.request", payload: ["kind": "teleport"]))
        #expect(errorCode(bad) == "BAD_REQUEST")
    }

    @Test("app.request 分发到 onAppRequest；无处理器回 UNAVAILABLE；坏 schema 回 BAD_REQUEST")
    func appRequestDispatch() async throws {
        let (bus, _) = makeBus()
        let unavailable = await bus.handleIncoming(
            envelope("app.request", payload: ["kind": "selectDirectory"]))
        #expect(errorCode(unavailable) == "UNAVAILABLE")
        bus.onAppRequest = { _ in .directorySelected(path: "/x") }
        let reply = await bus.handleIncoming(
            envelope("app.request", payload: ["kind": "selectDirectory", "defaultPath": "/y"]))
        #expect(isOk(reply))
        let payload = try #require(reply["payload"] as? [String: Any])
        let resp = try JSONDecoder().decode(
            AppResponse.self, from: JSONSerialization.data(withJSONObject: payload))
        #expect(resp == .directorySelected(path: "/x"))
        let bad = await bus.handleIncoming(envelope("app.request", payload: ["kind": "teleport"]))
        #expect(errorCode(bad) == "BAD_REQUEST")
    }

    @Test("pushDataEvent 握手后即刻投递（FIFO、不合并）")
    func pushDataEventDelivered() async {
        let (bus, box) = makeBus()
        _ = await bus.handleIncoming(envelope("bridge.hello", payload: helloPayload()))
        bus.pushDataEvent(.configResourcesChanged(resourceType: "skills"))
        bus.pushDataEvent(.configResourcesChanged(resourceType: "plugins"))
        #expect(box.envelopes.count == 2)
        #expect(sentType(box.envelopes[0]) == "data.event")
        #expect(sentType(box.envelopes[1]) == "data.event")
    }

    // MARK: - 纵深防御（抓绕过 codegen 手改 Gen 文件的路径）

    @Test("纵深防御：消息类型总数不超过 15")
    func messageBudgetCeiling() {
        #expect(BridgeMessageType.allCases.count <= 15)
    }

    @Test("纵深防御：非 orch 前缀消息不超过 11，编排配额 4 条不被侵占")
    func nonOrchBudgetCeiling() {
        let nonOrch = BridgeMessageType.allCases.filter { !$0.rawValue.hasPrefix("orch.") }
        #expect(nonOrch.count <= 11)
    }
}
