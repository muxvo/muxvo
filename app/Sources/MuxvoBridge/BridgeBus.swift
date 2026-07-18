// BridgeBus：桥协议 v1 核心总线（specs/bridge/bridge-v1.md v1-frozen §2/§3）。
// 职责：信封解码与分发、握手门控、push 队列与 ui.state 合并。
// 刻意不 import WebKit——WK 适配层是 BridgeScriptMessageHandler / WebViewPushSink 两个薄壳，
// 核心逻辑全部可经 handleIncoming(_:) / push 注入闭包做纯单测。
import Foundation

/// 协议 §2 错误码（信封层结构，不在 protocol.json 的 payload 类型面内，手写维护）。
public enum BridgeErrorCode: String, Sendable {
    case unimplemented = "UNIMPLEMENTED"
    case badRequest = "BAD_REQUEST"
    case internalError = "INTERNAL"
    case unavailable = "UNAVAILABLE"
    case versionMismatch = "VERSION_MISMATCH"
}

/// 全部桥操作在主线程（§3）：@MainActor final class 而非 actor——
/// actor 会把 WKScriptMessageHandlerWithReply 的同步 replyHandler 路径逼成 async，得不偿失。
@MainActor
public final class BridgeBus {
    public typealias PushSink = ([String: Any]) -> Void

    /// native→web 推送出口。生产接 WebViewPushSink.send；测试接数组收集闭包。
    public var pushSink: PushSink? {
        didSet { flushQueueIfPossible() }
    }
    /// ui.action 落点。M2 起暂无消费者（demo 闭环已删，nil 时动作丢弃仍回 ok）；M3 接真实状态源。
    public var onAction: ((UIAction) -> Void)?
    /// term.command（request #4）原生落点：spawn/close/zoom 等可能异步的原生工作。
    /// nil = 无原生处理器（TerminalService 未接线，批 4③前）→ 回 UNAVAILABLE（§2 协议错误）。
    /// 业务失败（上限满/无效 cwd…）由处理器回 TermCommandResponse.rejected（类型化 payload，不占信封错误，草案 §2）。
    public var onTermCommand: ((TermCommandRequest) async -> TermCommandResponse)?
    /// chat.request（request，M5 激活）原生落点：projects/sessions/session/search/export 只读读取（Chat 服务）。
    /// nil = Chat 服务未接线（批3 装配前）→ 回 UNAVAILABLE（仿 term.command/orch.command）。
    /// 业务失败（无效 projectHash、导出失败…）由处理器回 ChatResponse.rejected（类型化 payload，不占信封错误）。
    public var onChatRequest: ((ChatRequest) async -> ChatResponse)?
    /// config.request（#7，M6 批1）原生落点：偏好 get/set + 资源/settings/MCP/plugins 数据面（ConfigRequestHandler）。
    /// nil = 处理器未接线（批1 装配前）→ 回 UNAVAILABLE。业务失败经 ConfigResponse.rejected（类型化 payload）。
    public var onConfigRequest: ((ConfigRequest) async -> ConfigResponse)?
    /// app.request（#8，M6 批1）原生落点：selectDirectory 原生目录选择器（AppRequestHandler + DirectoryPicker）。
    /// nil → UNAVAILABLE。取消经 AppResponse.selectionCancelled（类型化 payload），非信封错误。
    public var onAppRequest: ((AppRequest) async -> AppResponse)?
    /// fs.request（#6，M6 批A）原生落点：readDir/showFileMenu/worktree/readFile/writeFile（FsRequestRouter）。
    /// nil = 处理器未接线 → 回 UNAVAILABLE。业务失败经 FsResponse.rejected（类型化 payload）。
    public var onFsRequest: ((FsRequest) async -> FsResponse)?
    /// 握手完成回调（冷启动 + re-hello 均触发）：波3a 接投影层 forceSnapshot，令 web 挂接即得新 orch snapshot（§3）。
    public var onHandshake: (() -> Void)?
    /// app.telemetry（event，v35 激活；analytics.md §4）落点：web 侧 L4 埋点事件 → AnalyticsTracker。
    /// nil 时事件丢弃仍回 ok（fire-and-forget，仿 ui.action；埋点未装配=启用门关，属正常态）。
    public var onTelemetry: ((TelemetryEvent) -> Void)?

    private let appVersion: String
    private(set) var handshaken = false
    private var lastUIState: UIState?
    /// 握手前 push 缓冲：FIFO；ui.state 入队合并（就地替换保持原队位，§3「只保留最新」）。
    private(set) var queue: [(typeRaw: String, envelope: [String: Any])] = []
    /// 防御性封顶：M1 实际只有合并后的 1 条 ui.state；超限 drop-oldest 并记日志。
    private static let queueLimit = 64
    /// 分发表（穷举 allCases，无 default 兜底）。closure 一律 @MainActor async 签名：@MainActor 保证
    /// 调用不跨 actor 域（否则非 Sendable 的 [String:Any] 回包无法穿越）；同步 handler（hello/
    /// ui.action…）body 直接 return 不 await，term.command 需 await 原生工作（§ term.command）。
    private(set) var handlers: [BridgeMessageType: @MainActor (Any?) async -> [String: Any]] = [:]

    public init(appVersion: String) {
        self.appVersion = appVersion
        registerHandlers()
    }

    // MARK: - 入向（web→native）

    /// 唯一入口（WK 薄壳与测试共用）：body 即 WKScriptMessage.body。async 因 term.command（#4）
    /// 需 await 原生工作；同步消息（hello/ui.action…）的 handler body 不 await，@MainActor 全程主线程
    /// 无 actor 跨域跳。永不 throw、永远返回完整回包信封——错误一律走 {ok:false, error:{code,message}}，不 reject（§2）。
    public func handleIncoming(_ body: Any) async -> [String: Any] {
        guard let dict = body as? [String: Any] else {
            return Self.errReply(.badRequest, "信封必须是对象 {v, type, payload}")
        }
        guard let v = dict["v"] as? Int, v == 1 else {
            return Self.errReply(.badRequest, "信封缺 v 或版本不支持（要求 v=1）")
        }
        guard let typeRaw = dict["type"] as? String else {
            return Self.errReply(.badRequest, "信封缺 type")
        }
        guard let type = BridgeMessageType(rawValue: typeRaw) else {
            // 台账外未知 type → BAD_REQUEST（§2 错误码界线）
            return Self.errReply(.badRequest, "未知消息 type: \(typeRaw)（台账外）")
        }
        guard let handler = handlers[type] else {
            // registerHandlers 穷举 allCases，此路不可达；防御兜底
            return Self.errReply(.internalError, "无 handler: \(typeRaw)")
        }
        return await handler(dict["payload"])
    }

    /// 穷举注册（无 default 兜底分支）：新增消息进 protocol.json 后此 switch 编译失败，
    /// 强制有意识地决定其 handler——stub/reserved 逐条显式回 UNIMPLEMENTED（§2 要求）。
    private func registerHandlers() {
        for type in BridgeMessageType.allCases {
            switch type {
            case .bridgeHello:
                handlers[type] = { [unowned self] payload in self.handleHello(payload) }
            case .uiAction:
                handlers[type] = { [unowned self] payload in self.handleUIAction(payload) }
            case .uiState:
                // active 但方向 native→web：被 web 上行调用属请求格式错误 → BAD_REQUEST
                handlers[type] = { _ in
                    Self.errReply(.badRequest, "ui.state 是 native→web 推送，web 端不可调用")
                }
            case .termCommand:
                // active（#4）：decode → onTermCommand 闭包（nil 回 UNAVAILABLE，草案 §term.command）
                handlers[type] = { [unowned self] payload in await self.handleTermCommand(payload) }
            case .chatRequest:
                // active（#5，M5）：decode → onChatRequest 闭包（nil 回 UNAVAILABLE，仿 term.command）
                handlers[type] = { [unowned self] payload in await self.handleChatRequest(payload) }
            // 编排收发（护城河，公开仓物理剥离）：orch 消息类型不在 core-only 枚举内，故条件编译。
            case .dataEvent:
                // 公开仓（无 orch）：data.event 仍是 native→web 推送，web 端不可调用 → BAD_REQUEST。
                handlers[type] = { [raw = type.rawValue] _ in
                    Self.errReply(.badRequest, "\(raw) 是 native→web 推送，web 端不可调用")
                }
            case .configRequest:
                // active（#7，M6 批1 接线）：decode → onConfigRequest 闭包（nil 回 UNAVAILABLE，仿 term.command）。
                handlers[type] = { [unowned self] payload in await self.handleConfigRequest(payload) }
            case .appRequest:
                // active（#8，M6 批1 接线）：decode → onAppRequest 闭包（nil 回 UNAVAILABLE）。
                handlers[type] = { [unowned self] payload in await self.handleAppRequest(payload) }
            case .fsRequest:
                // active（#6，M6 批2 激活）：decode → onFsRequest 闭包（nil 回 UNAVAILABLE，仿 config.request）。
                handlers[type] = { [unowned self] payload in await self.handleFsRequest(payload) }
            case .appTelemetry:
                // active（v35，埋点批2）：decode → onTelemetry 闭包（event 模式立即回 ok，仿 ui.action）。
                handlers[type] = { [unowned self] payload in self.handleTelemetry(payload) }
            }
        }
    }

    private func handleHello(_ payload: Any?) -> [String: Any] {
        let request: HelloRequest
        do {
            request = try Self.decodePayload(HelloRequest.self, from: payload)
        } catch {
            return Self.errReply(.badRequest, "bridge.hello payload 不符 schema")
        }
        guard request.protocolVersion == BridgeProtocol.version else {
            // 不置握手位、队列保留——给换对版本后的 re-hello 留恢复路径（§3 版本必须显形）
            return Self.errReply(
                .versionMismatch,
                "协议版本不匹配：native=\(BridgeProtocol.version) web=\(request.protocolVersion)；请重新 codegen 双侧并刷新"
            )
        }
        if handshaken {
            // 幂等可重入（§3）：清空未 flush 队列，补推一条最新 snapshot
            queue.removeAll()
            if let state = lastUIState { enqueueUIState(state) }
        }
        handshaken = true
        let active = BridgeMessageType.allCases.filter { $0.status == .active }.map(\.rawValue)
        let response = HelloResponse(
            protocolVersion: BridgeProtocol.version, appVersion: appVersion, active: active
        )
        let reply = Self.okReply(Self.encodeToJSONObject(response))
        // web 端时序契约保证 receive 已先于 hello 安装（§3），收到 hello 即可安全 flush
        flushQueueIfPossible()
        // 冷启动 + re-hello 均触发：波3a 接投影层 forceSnapshot，令 web 挂接即得新 orch snapshot（§3）。
        onHandshake?()
        return reply
    }

    private func handleUIAction(_ payload: Any?) -> [String: Any] {
        let action: UIAction
        do {
            action = try Self.decodePayload(UIAction.self, from: payload)
        } catch {
            return Self.errReply(.badRequest, "ui.action payload 不符 schema")
        }
        onAction?(action)
        // event 模式：native 立即回 {ok:true, payload:null}，web 不 await（§2）
        return Self.okReply(nil)
    }

    private func handleTelemetry(_ payload: Any?) -> [String: Any] {
        let event: TelemetryEvent
        do {
            event = try Self.decodePayload(TelemetryEvent.self, from: payload)
        } catch {
            return Self.errReply(.badRequest, "app.telemetry payload 不符 schema")
        }
        onTelemetry?(event)
        // event 模式：native 立即回 {ok:true, payload:null}，web 不 await（仿 ui.action）
        return Self.okReply(nil)
    }

    private func handleTermCommand(_ payload: Any?) async -> [String: Any] {
        let request: TermCommandRequest
        do {
            request = try Self.decodePayload(TermCommandRequest.self, from: payload)
        } catch {
            return Self.errReply(.badRequest, "term.command payload 不符 schema")
        }
        guard let onTermCommand else {
            // 无原生落点（TerminalService 未接线）→ 信封层 UNAVAILABLE（台账内 active 但暂不可用，§2）
            return Self.errReply(.unavailable, "term.command 暂无原生处理器（TerminalService 未接线）")
        }
        // 业务失败经 TermCommandResponse.rejected 分支回传（类型化 payload），仍是 {ok:true}（草案 §2）
        let response = await onTermCommand(request)
        return Self.okReply(Self.encodeToJSONObject(response))
    }


    private func handleChatRequest(_ payload: Any?) async -> [String: Any] {
        let request: ChatRequest
        do {
            request = try Self.decodePayload(ChatRequest.self, from: payload)
        } catch {
            return Self.errReply(.badRequest, "chat.request payload 不符 schema")
        }
        guard let onChatRequest else {
            // 无原生落点（Chat 服务未接线，批3 装配前）→ 信封层 UNAVAILABLE（台账内 active 但暂不可用，§2）
            return Self.errReply(.unavailable, "chat.request 暂无原生处理器（Chat 服务未接线）")
        }
        // 业务失败经 ChatResponse.rejected 分支回传（类型化 payload），仍是 {ok:true}（§2）
        let response = await onChatRequest(request)
        return Self.okReply(Self.encodeToJSONObject(response))
    }

    private func handleConfigRequest(_ payload: Any?) async -> [String: Any] {
        let request: ConfigRequest
        do {
            request = try Self.decodePayload(ConfigRequest.self, from: payload)
        } catch {
            return Self.errReply(.badRequest, "config.request payload 不符 schema")
        }
        guard let onConfigRequest else {
            return Self.errReply(.unavailable, "config.request 暂无原生处理器（ConfigRequestHandler 未接线）")
        }
        // 业务失败经 ConfigResponse.rejected 分支回传（类型化 payload），仍是 {ok:true}（§2）。
        let response = await onConfigRequest(request)
        return Self.okReply(Self.encodeToJSONObject(response))
    }

    private func handleAppRequest(_ payload: Any?) async -> [String: Any] {
        let request: AppRequest
        do {
            request = try Self.decodePayload(AppRequest.self, from: payload)
        } catch {
            return Self.errReply(.badRequest, "app.request payload 不符 schema")
        }
        guard let onAppRequest else {
            return Self.errReply(.unavailable, "app.request 暂无原生处理器（AppRequestHandler 未接线）")
        }
        let response = await onAppRequest(request)
        return Self.okReply(Self.encodeToJSONObject(response))
    }

    private func handleFsRequest(_ payload: Any?) async -> [String: Any] {
        let request: FsRequest
        do {
            request = try Self.decodePayload(FsRequest.self, from: payload)
        } catch {
            return Self.errReply(.badRequest, "fs.request payload 不符 schema")
        }
        guard let onFsRequest else {
            return Self.errReply(.unavailable, "fs.request 暂无原生处理器（FsRequestHandler 未接线）")
        }
        // 业务失败经 FsResponse.rejected 分支回传（类型化 payload），仍是 {ok:true}（§2）。
        let response = await onFsRequest(request)
        return Self.okReply(Self.encodeToJSONObject(response))
    }

    // MARK: - 出向（native→web）

    /// 推送最新 UI 快照。snapshot 语义 = 最新态完全覆盖（§3）；握手前入队并合并。
    public func pushUIState(_ state: UIState) {
        lastUIState = state
        enqueueOrDeliverUIState(state)
    }


    /// 推送 data.event（#9，M6 批1）。**不合并**（coalesce:false）——资源变化事件独立不可丢
    /// （configResourcesChanged 每类去抖已在 watcher 侧完成，此处 FIFO 投递）。握手前入队。
    public func pushDataEvent(_ event: DataEvent) {
        guard let payloadObject = Self.encodeToJSONObject(event) else {
            NSLog("[muxvo] bridge: data.event payload 编码失败，丢弃"); return
        }
        push(type: .dataEvent, payloadObject: payloadObject, coalesce: false)
    }

    /// didCommit 重置握手门（整页刷新/Vite 场景，§3）。
    /// 预灌最新 snapshot 入队：下次 hello 走统一 flush 路径即恢复画面，与 re-hello 语义对称。
    public func resetHandshake() {
        handshaken = false
        queue.removeAll()
        if let state = lastUIState { enqueueUIState(state) }
    }

    /// internal：测试以 stub push 类型（如 data.event）验证 FIFO 顺序；生产仅 pushUIState 使用。
    func push(type: BridgeMessageType, payloadObject: Any, coalesce: Bool) {
        let envelope: [String: Any] = ["v": 1, "type": type.rawValue, "payload": payloadObject]
        if handshaken, let sink = pushSink {
            sink(envelope)
        } else {
            enqueue(typeRaw: type.rawValue, envelope: envelope, coalesce: coalesce)
        }
    }

    private func enqueueOrDeliverUIState(_ state: UIState) {
        guard let payloadObject = Self.encodeToJSONObject(UIStatePush.snapshot(state: state)) else {
            NSLog("[muxvo] bridge: ui.state payload 编码失败，丢弃")
            return
        }
        push(type: .uiState, payloadObject: payloadObject, coalesce: true)
    }

    private func enqueueUIState(_ state: UIState) {
        guard let payloadObject = Self.encodeToJSONObject(UIStatePush.snapshot(state: state)) else {
            NSLog("[muxvo] bridge: ui.state payload 编码失败，丢弃")
            return
        }
        let envelope: [String: Any] = [
            "v": 1, "type": BridgeMessageType.uiState.rawValue, "payload": payloadObject,
        ]
        enqueue(typeRaw: BridgeMessageType.uiState.rawValue, envelope: envelope, coalesce: true)
    }

    private func enqueue(typeRaw: String, envelope: [String: Any], coalesce: Bool) {
        if coalesce, let index = queue.firstIndex(where: { $0.typeRaw == typeRaw }) {
            queue[index] = (typeRaw, envelope) // 就地替换保持原队位（§3）
            return
        }
        queue.append((typeRaw, envelope))
        if queue.count > Self.queueLimit {
            queue.removeFirst()
            NSLog("[muxvo] bridge: 握手前队列超限 \(Self.queueLimit)，丢弃最旧一条")
        }
    }

    private func flushQueueIfPossible() {
        guard handshaken, let sink = pushSink, !queue.isEmpty else { return }
        let pending = queue
        queue.removeAll()
        for item in pending { sink(item.envelope) }
    }

    // MARK: - 回包构造 / Codable ↔ JSON object 衔接

    static func okReply(_ payload: Any?) -> [String: Any] {
        ["ok": true, "payload": payload ?? NSNull()]
    }

    /// ERROR_L1_01 的落点：统一错误形状 {code: 机器可读, message: 人类可读}（§2 / legacy spec error.responseFormat）。
    static func errReply(_ code: BridgeErrorCode, _ message: String) -> [String: Any] {
        ["ok": false, "error": ["code": code.rawValue, "message": message]]
    }

    /// WKScriptMessage.body 是 NS 桥接字典杂烩：经 JSONSerialization→JSONDecoder 往返，
    /// 让 Gen 类型的 optional/nullable 语义与 schema 校验（decode 失败→BAD_REQUEST）一步到位。
    private static func decodePayload<T: Decodable>(_ type: T.Type, from payload: Any?) throws -> T {
        guard let payload, JSONSerialization.isValidJSONObject(payload) else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: [], debugDescription: "payload 缺失或非 JSON 对象")
            )
        }
        let data = try JSONSerialization.data(withJSONObject: payload)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func encodeToJSONObject<T: Encodable>(_ value: T) -> Any? {
        guard let data = try? JSONEncoder().encode(value),
              let object = try? JSONSerialization.jsonObject(with: data)
        else { return nil }
        return object
    }
}
