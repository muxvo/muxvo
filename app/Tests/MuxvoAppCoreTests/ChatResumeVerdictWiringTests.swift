// M5-R1 批2 D：chatResume 回填闸装配件（AppDelegate）——ChatRestore.Outcome → ChatResumeGateVerdict
// 纯函数映射 + 弹窗文案 + NSAlert 弹窗缝触达（注入假闭包断言，不真弹 NSAlert）。
// 闸对注入链的行为（block 跳注入 / proceed 注入 / codex 不过闸）已由 ChatResumeGateTests 以捕注入假
// harness 覆盖；ChatRestore 回填本体由 ChatRestoreTests 覆盖。本文件只测装配件本身。
import AppKit
import Foundation
import Testing
@testable import MuxvoAppCore
@testable import MuxvoChatHistory

@Suite("chatResume 回填闸装配件（AppDelegate）")
struct ChatResumeVerdictWiringTests {

    @Test("Outcome→verdict 三映射：restored/alreadyPresent→proceed；archiveMissing→ARCHIVE_NOT_FOUND；failed→RESTORE_FAILED")
    func verdictMapping() {
        #expect(AppDelegate.chatResumeVerdict(.restored) == .proceed)
        #expect(AppDelegate.chatResumeVerdict(.alreadyPresent) == .proceed)
        #expect(AppDelegate.chatResumeVerdict(.archiveMissing) == .block(code: "ARCHIVE_NOT_FOUND"))
        #expect(AppDelegate.chatResumeVerdict(.failed("io error")) == .block(code: "RESTORE_FAILED"))
    }

    @Test("弹窗文案：归档缺失/回填失败各有专文案且相异；未知 code 兜底文案含 code")
    func alertMessages() {
        let missing = AppDelegate.chatResumeAlertMessage(code: "ARCHIVE_NOT_FOUND")
        let failed = AppDelegate.chatResumeAlertMessage(code: "RESTORE_FAILED")
        #expect(!missing.isEmpty)
        #expect(!failed.isEmpty)
        #expect(missing != failed)
        #expect(AppDelegate.chatResumeAlertMessage(code: "X_CODE").contains("X_CODE"))
    }

    @Test("NSAlert 弹窗缝触达：makeChatResumeFeedback → hop main 调 presentChatResumeAlert（假闭包不真弹窗）")
    @MainActor func feedbackReachesInjectedAlertSeam() async {
        let delegate = AppDelegate()
        var seen: [(sid: String, code: String)] = []
        delegate.presentChatResumeAlert = { sid, code in seen.append((sid, code)) }
        let feedback = delegate.makeChatResumeFeedback()
        feedback("11111111-2222-3333-4444-555555555555", "ARCHIVE_NOT_FOUND")
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline, seen.isEmpty {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        #expect(seen.count == 1)
        #expect(seen.first?.sid == "11111111-2222-3333-4444-555555555555")
        #expect(seen.first?.code == "ARCHIVE_NOT_FOUND")
    }
}
