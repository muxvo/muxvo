// 批1 A1-1 占位冒烟：让 MuxvoChatHistoryTests target 可编译。
// A1-2/A1-3 在本目录另加 CD_* 投影/搜索案例（chat-data.md §7 案例池），与本文件并存。
import Testing

@testable import MuxvoChatHistory

@Suite("MuxvoChatHistory 骨架冒烟")
struct ChatHistoryModuleSmokeTests {
    @Test("specVersion 对齐 chat-data v1-frozen")
    func specVersionPinned() {
        #expect(ChatHistoryModule.specVersion == "chat-data v1")
    }
}
