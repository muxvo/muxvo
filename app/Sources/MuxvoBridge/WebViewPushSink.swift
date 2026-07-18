// native→web 推送出口：callAsyncJavaScript + arguments 字典传值，
// 绕开 evaluateJavaScript 字符串拼接转义坑（bridge-v1.md §3）。
// receive 注入与 handler 注册必须同在 .page contentWorld。
import Foundation
import WebKit

@MainActor
public final class WebViewPushSink {
    private weak var webView: WKWebView? // weak：webView→configuration→handler→bus 不成环

    public init(webView: WKWebView) {
        self.webView = webView
    }

    public func send(_ envelope: [String: Any]) {
        webView?.callAsyncJavaScript(
            "window.__muxvoBridge.receive(msg)",
            arguments: ["msg": envelope],
            in: nil,
            in: .page
        ) { result in
            if case .failure(let error) = result {
                NSLog("[muxvo] bridge push failed: \(error.localizedDescription)")
            }
        }
    }
}
