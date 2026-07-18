// GlyphAtlasCore：多页 LRU atlas 的纯逻辑层（无 Metal / 无 CoreText，处处可测）。
//
// 合同③（terminal-rendering.md §3 + M0 TerminalAreaViewController.swift:3-9 第 3 条）：
//   - 页规格：mask R8 1024²×≤8 页；color RGBA8 1024²×≤4 页；页内 shelf packing。
//   - 淘汰单位 = 整页：全满放不下时回收 lastUsedFrame 最老的整页、页世代号++（旧世代引用自动失效）。
//   - 硬约束：任何一帧内不得整体重建全 atlas（探针 2048² 单页装满 resetAtlas 作废）；
//     驱逐只在帧边界执行。暴露 fullRebuildCount（恒 0）/ pageEvictionCount 供断言。
//
// 帧模型（驱逐只发生在帧边界调用点）：
//   - lookup(key)：命中即 touch（lastUsedFrame=当前帧）返回；未命中返回 nil。
//   - insert(key,w,h)：未命中时装箱。能装（现有页 / 加新页至上限）→ 返回条目；全满装不下 →
//     记 pending 压力、返回 nil（本帧不驱逐、调用方本帧回退），空间留到帧边界回收。
//   - frameBoundary()：若有 pending 压力，驱逐一张「本帧未触及」的 LRU 页（reset+世代++），
//     pageEvictionCount++；随后帧号 +1。被驱逐页的条目即时清除，下一帧重新装箱（重新分配）。
//
// 单线程访问（渲染在主线程），结构体值语义，无锁。页尺寸/上限可注入以便小规模逼真触发驱逐。
import Foundation

/// 单页 shelf packing 状态 + 世代/最近使用帧。
struct GlyphPage: Equatable, Sendable {
    let dim: Int
    let pad: Int
    private(set) var shelfX: Int
    private(set) var shelfY: Int
    private(set) var shelfRowH: Int
    var generation: UInt64 = 0
    var lastUsedFrame: UInt64 = 0

    init(dim: Int, pad: Int = 1) {
        self.dim = dim
        self.pad = pad
        self.shelfX = pad
        self.shelfY = pad
        self.shelfRowH = 0
    }

    /// 尝试装入 w×h。成功推进 shelf 游标并返回矩形；本页放不下返回 nil。
    mutating func place(w: Int, h: Int) -> GlyphRect? {
        // 换行：当前 shelf 右侧放不下则起新 shelf。
        if shelfX + w + pad > dim {
            shelfY += shelfRowH + pad
            shelfX = pad
            shelfRowH = 0
        }
        guard shelfY + h + pad <= dim else { return nil }
        let rect = GlyphRect(x: shelfX, y: shelfY, w: w, h: h)
        shelfX += w + pad
        shelfRowH = max(shelfRowH, h)
        return rect
    }

    /// 页内是否放得下（不推进游标）——本页当前 shelf 状态下的判断。
    func canFit(w: Int, h: Int) -> Bool {
        var x = shelfX
        var y = shelfY
        var rowH = shelfRowH
        if x + w + pad > dim {
            y += rowH + pad
            x = pad
            rowH = 0
        }
        return y + h + pad <= dim
    }

    /// 驱逐后重置装箱状态并跨代。
    mutating func evict() {
        shelfX = pad
        shelfY = pad
        shelfRowH = 0
        generation &+= 1
    }
}

public struct GlyphAtlasCore: Sendable {
    // 页规格（默认合同值；测试可注入小规格逼真触发驱逐）。
    public let pageDim: Int
    public let maxMaskPages: Int
    public let maxColorPages: Int

    private(set) var maskPages: [GlyphPage] = []
    private(set) var colorPages: [GlyphPage] = []
    private(set) var entries: [GlyphKey: GlyphEntry] = [:]

    /// 当前帧号（frameBoundary 递增）。
    public private(set) var frame: UInt64 = 0
    /// 整体重建计数——本实现无此路径，恒 0（合同③验收硬断言）。存在即为证明探针 resetAtlas 未被带入。
    public private(set) var fullRebuildCount: Int = 0
    /// 整页驱逐次数。
    public private(set) var pageEvictionCount: Int = 0

    private var pendingMask = false
    private var pendingColor = false

    public init(pageDim: Int = 1024, maxMaskPages: Int = 8, maxColorPages: Int = 4) {
        self.pageDim = pageDim
        self.maxMaskPages = maxMaskPages
        self.maxColorPages = maxColorPages
    }

    // MARK: 查询

    /// 命中查询：live 命中则 touch 并返回；否则 nil（调用方栅格后走 insert）。
    public mutating func lookup(_ key: GlyphKey) -> GlyphEntry? {
        guard var e = entries[key], isLive(e) else {
            // 悬空（旧世代）条目顺手清掉。
            if entries[key] != nil { entries[key] = nil }
            return nil
        }
        e.lastUsedFrame = frame
        entries[key] = e
        touchPage(kind: e.kind, index: e.page)
        return e
    }

    /// 装箱插入（假定未命中）。返回条目；全满装不下 → 记压力、返回 nil。字形超单页容量 → 返回 nil（无压力）。
    public mutating func insert(_ key: GlyphKey, width: Int, height: Int) -> GlyphEntry? {
        let kind: GlyphPageKind = key.color ? .color : .mask
        // 超大字形（含 pad 超单页）——任何页都装不下，直接放弃（不记驱逐压力）。
        if width > pageDim - 2 || height > pageDim - 2 { return nil }

        let result: PlaceResult
        switch kind {
        case .mask:
            result = place(in: &maskPages, maxPages: maxMaskPages, w: width, h: height, frame: frame)
        case .color:
            result = place(in: &colorPages, maxPages: maxColorPages, w: width, h: height, frame: frame)
        }

        switch result {
        case let .placed(page, rect, generation):
            let e = GlyphEntry(page: page, kind: kind, rect: rect,
                               pageGeneration: generation, lastUsedFrame: frame)
            entries[key] = e
            return e
        case .full:
            // 本帧不驱逐；标记压力，空间留到帧边界回收。
            if kind == .mask { pendingMask = true } else { pendingColor = true }
            return nil
        }
    }

    /// 帧边界：驱逐一张本帧未触及的 LRU 页（若有 pending 压力），再推进帧号。
    public mutating func frameBoundary() {
        if pendingMask { evictLRU(kind: .mask) }
        if pendingColor { evictLRU(kind: .color) }
        pendingMask = false
        pendingColor = false
        frame &+= 1
    }

    // MARK: 内部装箱/驱逐

    private enum PlaceResult {
        case placed(page: Int, rect: GlyphRect, generation: UInt64)
        case full
    }

    private func place(in pages: inout [GlyphPage], maxPages: Int, w: Int, h: Int, frame: UInt64) -> PlaceResult {
        for i in pages.indices {
            if let rect = pages[i].place(w: w, h: h) {
                pages[i].lastUsedFrame = frame
                return .placed(page: i, rect: rect, generation: pages[i].generation)
            }
        }
        if pages.count < maxPages {
            var p = GlyphPage(dim: pageDim)
            guard let rect = p.place(w: w, h: h) else { return .full }
            p.lastUsedFrame = frame
            pages.append(p)
            return .placed(page: pages.count - 1, rect: rect, generation: p.generation)
        }
        return .full
    }

    private mutating func evictLRU(kind: GlyphPageKind) {
        // 候选 = 本帧未触及的页（lastUsedFrame < frame）；取 lastUsedFrame 最老、并列取最低页号。
        let victim: Int?
        switch kind {
        case .mask: victim = lruVictim(in: maskPages)
        case .color: victim = lruVictim(in: colorPages)
        }
        guard let v = victim else { return }  // 全部本帧在用 → 本次无法安全驱逐（下帧再议）。

        switch kind {
        case .mask:
            maskPages[v].evict()
            maskPages[v].lastUsedFrame = frame
        case .color:
            colorPages[v].evict()
            colorPages[v].lastUsedFrame = frame
        }
        // 清除落在该页的条目（其 pageGeneration 已旧，isLive 亦会判失效；此处即时清理防字典膨胀）。
        entries = entries.filter { !($0.value.kind == kind && $0.value.page == v) }
        pageEvictionCount += 1
    }

    private func lruVictim(in pages: [GlyphPage]) -> Int? {
        var victim: Int?
        var oldest = UInt64.max
        for i in pages.indices where pages[i].lastUsedFrame < frame {
            if pages[i].lastUsedFrame < oldest {
                oldest = pages[i].lastUsedFrame
                victim = i
            }
        }
        return victim
    }

    private func isLive(_ e: GlyphEntry) -> Bool {
        switch e.kind {
        case .mask:
            return e.page < maskPages.count && maskPages[e.page].generation == e.pageGeneration
        case .color:
            return e.page < colorPages.count && colorPages[e.page].generation == e.pageGeneration
        }
    }

    private mutating func touchPage(kind: GlyphPageKind, index: Int) {
        switch kind {
        case .mask: maskPages[index].lastUsedFrame = frame
        case .color: colorPages[index].lastUsedFrame = frame
        }
    }

    // MARK: 测试/诊断只读访问

    /// 指定种类的页数（现有页，非上限）。
    public func pageCount(_ kind: GlyphPageKind) -> Int {
        kind == .mask ? maskPages.count : colorPages.count
    }

    /// 页世代号（驱逐后 ++）。
    public func pageGeneration(_ kind: GlyphPageKind, _ index: Int) -> UInt64 {
        kind == .mask ? maskPages[index].generation : colorPages[index].generation
    }

    /// 页最近使用帧。
    public func pageLastUsedFrame(_ kind: GlyphPageKind, _ index: Int) -> UInt64 {
        kind == .mask ? maskPages[index].lastUsedFrame : colorPages[index].lastUsedFrame
    }

    /// 当前 live 条目数。
    public var liveEntryCount: Int {
        entries.values.reduce(0) { isLive($1) ? $0 + 1 : $0 }
    }

    /// 某页上所有 live 条目的矩形（装箱无重叠断言用）。
    public func liveRects(kind: GlyphPageKind, page: Int) -> [GlyphRect] {
        entries.values
            .filter { $0.kind == kind && $0.page == page && isLive($0) }
            .map(\.rect)
    }

    /// 直接查条目（不 touch）——断言某键是否仍 live。
    public func peek(_ key: GlyphKey) -> GlyphEntry? {
        guard let e = entries[key], isLive(e) else { return nil }
        return e
    }
}
