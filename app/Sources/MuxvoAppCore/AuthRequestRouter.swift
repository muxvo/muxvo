// app.request auth 变体 → AuthManager 薄路由（右上角批 B5；bridge-v1.md §8 AUTH）。
// AppDelegate 的 onAppRequest 闭包先问本路由（auth 变体返回非 nil），其余透传 AppRequestHandler。
// 错误：AuthError → rejected{code=稳定码, message=英文 debug}；中文文案在 web auth-strings.ts。
import Foundation
import MuxvoAuth
import MuxvoBridge

@MainActor
public final class AuthRequestRouter {
    private let manager: AuthManager

    public init(manager: AuthManager) {
        self.manager = manager
    }

    /// 桥 AuthView（Gen 类型）← manager 快照。
    public func bridgeView() -> MuxvoBridge.AuthView {
        let snap = manager.statusView
        return MuxvoBridge.AuthView(
            loggedIn: snap.loggedIn,
            user: snap.user.map {
                AuthUserView(username: $0.username, email: $0.email, avatarUrl: $0.avatarUrl, provider: $0.provider)
            })
    }

    /// auth 变体处理；非 auth 变体返回 nil（调用方透传 AppRequestHandler）。
    public func handle(_ request: AppRequest) async -> AppResponse? {
        switch request {
        case .selectDirectory, .openExternal, .updateCheck, .updateDownload, .releaseNotes, .whatsNewStatus,
             .hookStatus, .hookEnable, .hookDisable, .hookAutoEnableNotice, .legacyMigrationNotice:
            return nil // 非 auth → 透传 AppRequestHandler
        case .authStatus:
            return .authState(auth: bridgeView())
        case let .authLoginOAuth(provider):
            return await run(ack: .authAck) {
                try await self.manager.loginOAuth(provider: provider.rawValue)
            }
        case let .authLoginPassword(email, password):
            return await run(ack: nil) {
                try await self.manager.loginPassword(email: email, password: password)
            }
        case let .authRegister(email, code, password):
            return await run(ack: nil) {
                try await self.manager.register(email: email, code: code, password: password)
            }
        case let .authSendEmailCode(email, purpose):
            // 桥枚举 reset → 服务端 purpose 'reset-password'（register 同名直通）。
            let serverPurpose = purpose == .reset ? "reset-password" : "register"
            return await run(ack: .authAck) {
                try await self.manager.sendEmailCode(email: email, purpose: serverPurpose)
            }
        case let .authResetPassword(email, code, newPassword):
            return await run(ack: .authAck) {
                try await self.manager.resetPassword(email: email, code: code, newPassword: newPassword)
            }
        case .authLogout:
            await manager.logout()
            return .authState(auth: bridgeView())
        }
    }

    /// 统一执行包装：成功 → `ack`（nil = 回当前登录态 authState，密码/注册成功即已登录）；
    /// 失败 → rejected{稳定码}。
    private func run(ack: AppResponse?, _ body: () async throws -> Void) async -> AppResponse {
        do {
            try await body()
            return ack ?? .authState(auth: bridgeView())
        } catch let e as AuthError {
            return .rejected(code: e.code.rawValue, message: e.message)
        } catch {
            return .rejected(code: AuthErrorCode.network.rawValue, message: error.localizedDescription)
        }
    }
}
