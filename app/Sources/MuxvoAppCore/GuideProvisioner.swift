// guide.md 落数据根（右上角批 B3；menu-bar.md §6）：帮助会话注入的 claude 命令引用
// `<dataRoot>/guide.md`——启动时从源拷入，**每启覆盖**（内容随版本更新，legacy main 启动拷
// docs/muxvo-guide.md → ~/.muxvo/guide.md 同语义；新版落各分身数据根，不碰 ~/.muxvo）。
import Foundation
import MuxvoKit

public enum GuideProvisioner {
    /// 源解析序：① env `MUXVO_GUIDE_SOURCE`（dev：scripts/app.sh run 注入仓库 docs/muxvo-guide.md）
    /// ② Bundle.main `Resources/muxvo-guide.md`（bundle：scripts/app.sh do_bundle cp 落）。
    /// 均缺 → nil（帮助会话仍可开，claude 会自行报文件不存在——不做静默假内容兜底）。
    static func resolveSource(env: [String: String]) -> URL? {
        if let p = env["MUXVO_GUIDE_SOURCE"], !p.isEmpty, FileManager.default.fileExists(atPath: p) {
            return URL(fileURLWithPath: p)
        }
        return Bundle.main.url(forResource: "muxvo-guide", withExtension: "md")
    }

    /// 拷 guide 源 → `<dataRoot>/guide.md`（原子写，每启覆盖）。源缺/写失败只 .notice 不打断启动。
    public static func provision(
        dataRoot: URL, env: [String: String] = ProcessInfo.processInfo.environment
    ) {
        guard let src = resolveSource(env: env) else {
            Log.app.notice("guide.md 源缺失（MUXVO_GUIDE_SOURCE 与 bundle 资源均无）→ 跳过 provisioning")
            return
        }
        let dest = dataRoot.appendingPathComponent("guide.md")
        do {
            let data = try Data(contentsOf: src)
            try data.write(to: dest, options: .atomic)
        } catch {
            Log.app.notice("guide.md provisioning 失败：\(String(describing: error), privacy: .public)")
        }
    }
}
