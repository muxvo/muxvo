// 渲染实例值类型：快照 → GPU 实例的中间产物（纯逻辑，不碰 Metal）。
//
// 手法平移探针 ProbeRendererMetal.QuadInstance（64B，逐字段对齐 MSL），但**结构不带入**：
// 探针视图持 render state + 行级增量缓存；本实现视图无状态，每帧从不可变快照重建实例
// （terminal-rendering.md §1.1「视图 draw 只读最新 snapshot 指针」）。
//
// 多页 atlas（合同③）下 glyph 实例可能跨页——按 (kind,page) 聚合成批，每批一个 draw call
// 绑定对应页纹理（设计权衡见 m3-batch3-surface-report.md：选「按页分组 draw」而非纹理数组，
// 页数 ≤12 且常态 1-2 页，draw call 开销可忽略，且避开纹理数组的分配/绑定复杂度）。
import simd

/// 与 MSL `QuadInstance` 逐字段对应（64B）。rect/uvPx 为 drawable 像素（左上原点）。
struct QuadInstance: Equatable {
    var rect: SIMD4<Float>    // x,y,w,h（drawable 像素）
    var uvPx: SIMD4<Float>    // atlas 像素矩形（mode!=0 时有效）
    var color: SIMD4<Float>   // 未预乘 rgba；shader 侧按 mode 处理
    var mode: SIMD4<UInt32>   // x: 0=实心 1=mask tint 2=彩色纹理（y/z/w 预留对齐到 16B）

    init(rect: SIMD4<Float>, uvPx: SIMD4<Float> = .zero, color: SIMD4<Float>, mode: UInt32) {
        self.rect = rect
        self.uvPx = uvPx
        self.color = color
        self.mode = SIMD4<UInt32>(mode, 0, 0, 0)
    }
}

/// 一批同 (kind,page) 的字形实例——一个 draw call 绑定该页纹理绘制。
struct GlyphPageBatch: Equatable {
    let kind: GlyphPageKind
    let page: Int
    var instances: [QuadInstance]
}

/// 聚合字形实例用的字典键。
struct GlyphPageBatchKey: Hashable {
    let kind: GlyphPageKind
    let page: Int
}

/// 一帧的三批实例（§1「三批 draw：bg 实心 / glyph 纹理 / cursor」）。
/// background 含 cell 背景 + 选区高亮 + 下划线/删除线（皆 mode 0 实心 quad）。
/// cursor：实心 block/bar/underline = 1 个；hollow = 4 条边框；block 下含反色字形（见 builder）。
struct FrameInstances: Equatable {
    var background: [QuadInstance] = []
    var glyphBatches: [GlyphPageBatch] = []
    var cursor: [QuadInstance] = []
    /// 本帧快照 generation（bench 打点：commandBuffer 完成回调回传此值）。
    var generation: UInt64 = 0

    /// 三批总实例数（测试/诊断）。
    var totalCount: Int {
        background.count + glyphBatches.reduce(0) { $0 + $1.instances.count } + cursor.count
    }
}
