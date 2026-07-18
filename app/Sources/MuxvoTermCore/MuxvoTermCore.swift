// MuxvoTermCore：纯 Swift、零 C 依赖、零 vendor 依赖。
//
// 定位（m3-design-annex-A §1.1）：状态机 10 态、SessionRegistry 策略（上限 20/去抖）、
// env 合同构造、默认配置。这些是 spec 密集区，拆成 vendor-free 纯 Swift 后单测最快，
// 也是 CI 逃生舱（MUXVO_NO_VENDOR=1）仍能覆盖的可测面。
//
// M3 批 0：仅占位。批 1（A2）落地状态机与默认配置。

public enum MuxvoTermCoreInfo {
    /// 模块占位版本号（批 1 起随实装内容演进）。
    public static let version = "0.0.1"
}
