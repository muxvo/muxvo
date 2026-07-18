// config.json 单写者中枢（M6 批1 步骤1）。
//
// 背景：config.json 原唯一写者 = TerminalService（持私有 MuxvoConfig 副本 + configStore.save）。
// M6 引入 config.request 偏好处理器后出现第二写者风险——两副本各写整份即互相覆盖（last-write-wins
// 丢字段）。本类收敛为单一 in-memory MuxvoConfig + 单一 save 出口：TerminalService 与 config.request
// 处理器共享同一实例（均 @MainActor，串行访问无竞争），杜绝双写者竞态。
//
// 依赖方向：MuxvoStorage 不 import MuxvoBridge——本类只认 MuxvoConfig（字段级），偏好 patch 的
// bridge 类型映射留在 AppCore 装配层（UIStateProjection/TerminalService 同款 bridge-free 分层）。
import Foundation

/// config.json 的单写者持有者。持一份权威 MuxvoConfig，所有落盘经 save()（包 ConfigStore→AtomicFile）。
/// @MainActor：与 TerminalService / config.request 处理器同上下文，无锁串行。
@MainActor
public final class ConfigModel {
    /// 权威 in-memory 配置（唯一真值）。外部只读；变更一律经 update/updatePrefs（保证同步落盘）。
    public private(set) var config: MuxvoConfig
    private let store: ConfigStore

    /// 偏好变更出口（updatePrefs 后触发，带新 config）：装配层接 badge 模式重算 + theme/fontSize 通路。
    /// 内部结构性写回（openTerminals/gridLayout/zoom fontSize）走 update(_:) 不触发——非偏好域，避免
    /// 每次 gridResize 都触发 badge 重算/重推等无关副作用。
    public var onPrefsChanged: ((MuxvoConfig) -> Void)?

    public init(store: ConfigStore) {
        self.store = store
        self.config = store.load()
    }

    /// 结构性/内部写回（TerminalService 的 openTerminals 维序 / gridLayout / zoom fontSize）：就地
    /// 改 + 原子落盘，**不**触发 onPrefsChanged。
    public func update(_ body: (inout MuxvoConfig) -> Void) {
        body(&config)
        try? store.save(config)
    }

    /// 偏好写回（config.request set{patch} 施加副作用）：就地改 + 原子落盘 + 触发 onPrefsChanged。
    public func updatePrefs(_ body: (inout MuxvoConfig) -> Void) {
        body(&config)
        try? store.save(config)
        onPrefsChanged?(config)
    }
}
