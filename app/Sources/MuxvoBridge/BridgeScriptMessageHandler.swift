// WK 适配薄壳：WKScriptMessageHandlerWithReply → BridgeBus.handleIncoming。
// 刻意薄到一行转发——WKScriptMessage 无法构造，此层不进单测；
// 端到端由 app.sh run 冒烟 + tools/visual-diff 的 bridge-isolation 断言兜底。
import Foundation
import WebKit

@MainActor
public final class BridgeScriptMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let bus: BridgeBus // 强持有；bus 不持 handler，无环

    public init(bus: BridgeBus) {
        self.bus = bus
    }

    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        // handleIncoming 现为 async（term.command 需 await 原生工作，bridge-v1.md §2 / 草案 §term.command）。
        // 已在 @MainActor 上下文，Task { @MainActor } 不跨 actor 域；body 先取出避免在闭包里再触 WKScriptMessage。
        let body = message.body
        Task { @MainActor in
            // 第二参数永远 nil：错误也走 {ok:false} 结构化回包，不 reject（bridge-v1.md §2）
            replyHandler(await bus.handleIncoming(body), nil)
        }
    }
}
