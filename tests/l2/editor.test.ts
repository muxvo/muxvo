/**
 * EDITOR L2 -- Rule Layer Tests
 *
 * Source: docs/Muxvo_测试_v2/02_modules/test_EDITOR.md
 * Covers: Rich editor state machine, key passthrough, text forwarding,
 *         image sending, auto mode detection, temp file cleanup, UI mapping
 *
 * Total cases: 44
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetIpcMocks } from '../helpers/mock-ipc';
import {
  asbSignals,
  textForwardFixtures,
  imageFixtures,
  timeConstants,
  defaultConfig,
} from '../helpers/test-fixtures';

describe('EDITOR L2 -- 规则层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // ---------------------------------------------------------------------------
  // 2.1 状态机: 富编辑器覆盖层 (PRD 6.13)
  // ---------------------------------------------------------------------------
  describe('状态机: 富编辑器覆盖层', () => {
    describe('RichEditor 内部转换 (7/7)', () => {
      test('EDITOR_L2_01_init_idle: E1 [*] -> RichEditor.Idle', async () => {
        // RED: import the real editor state machine (will fail)
        const { createEditorMachine } = await import(
          '@/shared/machines/rich-editor'
        );
        const machine = createEditorMachine();

        // Initial transition: [*] -> RichEditor.Idle
        expect(machine.state).toBe('Idle');
      });

      test('EDITOR_L2_02_idle_composing: E2 Idle -> Composing', async () => {
        const { createEditorMachine } = await import(
          '@/shared/machines/rich-editor'
        );
        const machine = createEditorMachine();
        expect(machine.state).toBe('Idle');

        // Trigger: 用户开始输入
        machine.send('INPUT_START');
        expect(machine.state).toBe('Composing');
      });

      test('EDITOR_L2_03_composing_continue: E3 Composing -> Composing (继续输入)', async () => {
        const { createEditorMachine } = await import(
          '@/shared/machines/rich-editor'
        );
        const machine = createEditorMachine();
        machine.send('INPUT_START');
        expect(machine.state).toBe('Composing');

        // Trigger: 继续输入/粘贴文本
        machine.send({ type: 'INPUT_CONTINUE', text: 'hello' });
        expect(machine.state).toBe('Composing');
        expect(machine.context.content).toContain('hello');

        // Append more text
        machine.send({ type: 'INPUT_CONTINUE', text: ' world' });
        expect(machine.state).toBe('Composing');
        expect(machine.context.content).toContain('hello world');
      });

      test('EDITOR_L2_04_composing_attaching: E4 Composing -> ImageAttaching', async () => {
        const { createEditorMachine } = await import(
          '@/shared/machines/rich-editor'
        );
        const machine = createEditorMachine();
        machine.send('INPUT_START');
        expect(machine.state).toBe('Composing');

        // Trigger: 粘贴图片（Ctrl+V）
        machine.send({ type: 'PASTE_IMAGE', imageData: 'base64...' });
        expect(machine.state).toBe('ImageAttaching');
      });

      test('EDITOR_L2_05_attaching_composing: E5 ImageAttaching -> Composing', async () => {
        const { createEditorMachine } = await import(
          '@/shared/machines/rich-editor'
        );
        const machine = createEditorMachine();
        machine.send('INPUT_START');
        machine.send({ type: 'PASTE_IMAGE', imageData: 'base64...' });
        expect(machine.state).toBe('ImageAttaching');

        // Trigger: 图片保存到临时文件
        machine.send({
          type: 'IMAGE_SAVED',
          tempPath: '/tmp/muxvo-images/img1.png',
        });
        expect(machine.state).toBe('Composing');
        // 显示缩略图
        expect(machine.context.attachedImages).toHaveLength(1);
        expect(machine.context.attachedImages[0].path).toBe(
          '/tmp/muxvo-images/img1.png',
        );
      });

      test('EDITOR_L2_06_composing_sending: E6 Composing -> Sending', async () => {
        const { createEditorMachine } = await import(
          '@/shared/machines/rich-editor'
        );
        const machine = createEditorMachine();
        machine.send('INPUT_START');
        machine.send({ type: 'INPUT_CONTINUE', text: 'hello' });
        expect(machine.state).toBe('Composing');

        // Trigger: 按发送（Enter/Cmd+Enter）
        machine.send('SUBMIT');
        expect(machine.state).toBe('Sending');
      });

      test('EDITOR_L2_07_sending_idle: E7 Sending -> Idle', async () => {
        const { createEditorMachine } = await import(
          '@/shared/machines/rich-editor'
        );
        const machine = createEditorMachine();
        machine.send('INPUT_START');
        machine.send({ type: 'INPUT_CONTINUE', text: 'hello' });
        machine.send('SUBMIT');
        expect(machine.state).toBe('Sending');

        // Trigger: 提取文本 -> 检测进程 -> 转换协议 -> pty.write() -> 清空
        machine.send('SEND_COMPLETE');
        expect(machine.state).toBe('Idle');
        // 编辑器清空
        expect(machine.context.content).toBe('');
        expect(machine.context.attachedImages).toHaveLength(0);
      });
    });

    describe('模式切换 (4/4)', () => {
      test('EDITOR_L2_08_asb_enter: M1 RichEditor -> RawTerminal (ASB 进入)', async () => {
        const { createEditorModeMachine } = await import(
          '@/shared/machines/editor-mode'
        );
        const machine = createEditorModeMachine();
        expect(machine.state).toBe('RichEditor');

        // Trigger: 收到 \x1b[?1049h（ASB 进入信号）
        machine.send({ type: 'ASB_SIGNAL', signal: asbSignals.enterRaw });
        expect(machine.state).toBe('RawTerminal');
      });

      test('EDITOR_L2_09_asb_exit: M2 RawTerminal -> RichEditor (ASB 退出)', async () => {
        const { createEditorModeMachine } = await import(
          '@/shared/machines/editor-mode'
        );
        const machine = createEditorModeMachine();
        machine.send({ type: 'ASB_SIGNAL', signal: asbSignals.enterRaw });
        expect(machine.state).toBe('RawTerminal');

        // Trigger: 收到 \x1b[?1049l（ASB 退出信号）
        machine.send({ type: 'ASB_SIGNAL', signal: asbSignals.exitRaw });
        expect(machine.state).toBe('RichEditor');
      });

      test('EDITOR_L2_10_manual_to_raw: M3 RichEditor -> RawTerminal (手动切换)', async () => {
        const { createEditorModeMachine } = await import(
          '@/shared/machines/editor-mode'
        );
        const machine = createEditorModeMachine();
        expect(machine.state).toBe('RichEditor');

        // Trigger: 手动快捷键切换
        machine.send('TOGGLE_MODE');
        expect(machine.state).toBe('RawTerminal');
      });

      test('EDITOR_L2_11_manual_to_rich: M4 RawTerminal -> RichEditor (手动切换)', async () => {
        const { createEditorModeMachine } = await import(
          '@/shared/machines/editor-mode'
        );
        const machine = createEditorModeMachine();
        machine.send('TOGGLE_MODE');
        expect(machine.state).toBe('RawTerminal');

        // Trigger: 手动快捷键切换
        machine.send('TOGGLE_MODE');
        expect(machine.state).toBe('RichEditor');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2.2 按键穿透规则 (PRD 8.16)
  // ---------------------------------------------------------------------------
  describe('按键穿透规则', () => {
    test('EDITOR_L2_12_key_ctrl_c: Ctrl+C 穿透到终端（中断进程）', async () => {
      const { handleEditorKey } = await import(
        '@/shared/utils/editor-key-handler'
      );

      const result = handleEditorKey({
        key: 'c',
        ctrlKey: true,
        editorMode: 'RichEditor',
        editorState: 'Composing',
      });

      // Ctrl+C 穿透到终端（中断进程），编辑器内容保留
      expect(result.action).toBe('passthrough');
      expect(result.ptySignal).toBe('\x03'); // Ctrl+C byte
      expect(result.clearEditor).toBe(false);
    });

    test('EDITOR_L2_13_key_ctrl_z: Ctrl+Z 穿透到终端（挂起进程）', async () => {
      const { handleEditorKey } = await import(
        '@/shared/utils/editor-key-handler'
      );

      const result = handleEditorKey({
        key: 'z',
        ctrlKey: true,
        editorMode: 'RichEditor',
        editorState: 'Composing',
      });

      // Ctrl+Z 穿透到终端（挂起进程），编辑器内容保留
      expect(result.action).toBe('passthrough');
      expect(result.ptySignal).toBe('\x1a'); // Ctrl+Z byte
      expect(result.clearEditor).toBe(false);
    });

    test('EDITOR_L2_14_key_ctrl_d: Ctrl+D 穿透到终端（EOF）', async () => {
      const { handleEditorKey } = await import(
        '@/shared/utils/editor-key-handler'
      );

      const result = handleEditorKey({
        key: 'd',
        ctrlKey: true,
        editorMode: 'RichEditor',
        editorState: 'Idle',
      });

      // Ctrl+D 穿透到终端（EOF），编辑器不响应
      expect(result.action).toBe('passthrough');
      expect(result.ptySignal).toBe('\x04'); // Ctrl+D byte
      expect(result.editorHandled).toBe(false);
    });

    test('EDITOR_L2_15_key_enter_send: Enter 触发编辑器发送', async () => {
      const { handleEditorKey } = await import(
        '@/shared/utils/editor-key-handler'
      );

      const result = handleEditorKey({
        key: 'Enter',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        editorMode: 'RichEditor',
        editorState: 'Composing',
      });

      // Enter (默认配置) 触发编辑器发送
      expect(result.action).toBe('submit');
      expect(result.editorHandled).toBe(true);
    });

    test('EDITOR_L2_16_key_cmd_enter_send: Cmd+Enter 触发编辑器发送', async () => {
      const { handleEditorKey } = await import(
        '@/shared/utils/editor-key-handler'
      );

      const result = handleEditorKey({
        key: 'Enter',
        metaKey: true,
        editorMode: 'RichEditor',
        editorState: 'Composing',
      });

      // Cmd+Enter 触发编辑器发送
      expect(result.action).toBe('submit');
      expect(result.editorHandled).toBe(true);
    });

    test('EDITOR_L2_17_key_shift_enter: Shift+Enter 插入新行', async () => {
      const { handleEditorKey } = await import(
        '@/shared/utils/editor-key-handler'
      );

      const result = handleEditorKey({
        key: 'Enter',
        shiftKey: true,
        editorMode: 'RichEditor',
        editorState: 'Composing',
      });

      // Shift+Enter 插入新行，不发送
      expect(result.action).toBe('newline');
      expect(result.editorHandled).toBe(true);
    });

    test('EDITOR_L2_18_key_other: 普通字符键输入到编辑器', async () => {
      const { handleEditorKey } = await import(
        '@/shared/utils/editor-key-handler'
      );

      const result = handleEditorKey({
        key: 'a',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        editorMode: 'RichEditor',
        editorState: 'Idle',
      });

      // 普通字符键输入到编辑器
      expect(result.action).toBe('input');
      expect(result.editorHandled).toBe(true);
      expect(result.char).toBe('a');
    });

    test('EDITOR_L2_19_key_ctrl_c_preserve: Ctrl+C 穿透后编辑器内容不清空', async () => {
      const { handleEditorKey } = await import(
        '@/shared/utils/editor-key-handler'
      );

      const result = handleEditorKey({
        key: 'c',
        ctrlKey: true,
        editorMode: 'RichEditor',
        editorState: 'Composing',
        currentContent: 'some existing text',
      });

      // 穿透到终端，编辑器内已输入内容不清空
      expect(result.action).toBe('passthrough');
      expect(result.clearEditor).toBe(false);
      expect(result.preserveContent).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2.3 文本转发规则 (PRD 8.16, 分析报告 7.4)
  // ---------------------------------------------------------------------------
  describe('文本转发规则', () => {
    test('EDITOR_L2_20_text_cc_single: CC 单行文本转发', async () => {
      const { buildTextPayload } = await import(
        '@/shared/utils/text-forwarder'
      );

      // Input: foreground = Claude Code, text = "hello"
      const result = buildTextPayload({
        foreground: 'claude-code',
        text: 'hello',
      });

      // Expected: pty.write("hello\r")
      expect(result.payload).toBe('hello\r');
    });

    test('EDITOR_L2_21_text_cc_multi: CC 多行文本转发', async () => {
      const { buildTextPayload } = await import(
        '@/shared/utils/text-forwarder'
      );

      // Input: foreground = Claude Code, text = "line1\nline2\nline3"
      const result = buildTextPayload({
        foreground: 'claude-code',
        text: 'line1\nline2\nline3',
      });

      // Expected: pty.write("line1\x1b\rline2\x1b\rline3\r")
      // Uses ESC+CR separator between lines, CR at end
      expect(result.payload).toBe(textForwardFixtures.claudeCode.multiline);
    });

    test('EDITOR_L2_22_text_shell_single: shell 单行文本转发', async () => {
      const { buildTextPayload } = await import(
        '@/shared/utils/text-forwarder'
      );

      // Input: foreground = bash, text = "ls -la"
      const result = buildTextPayload({
        foreground: 'bash',
        text: 'ls -la',
      });

      // Expected: pty.write("ls -la\n")
      expect(result.payload).toBe('ls -la\n');
    });

    test('EDITOR_L2_23_text_shell_multi: shell 多行文本转发', async () => {
      const { buildTextPayload } = await import(
        '@/shared/utils/text-forwarder'
      );

      // Input: foreground = zsh, text = "echo a\necho b"
      const result = buildTextPayload({
        foreground: 'zsh',
        text: 'echo a\necho b',
      });

      // Expected: pty.write("echo a\necho b\n")
      // Shell 多行：直接发送
      expect(result.payload).toBe('echo a\necho b\n');
    });

    test('EDITOR_L2_24_text_fish: fish 文本转发（同 shell 协议）', async () => {
      const { buildTextPayload } = await import(
        '@/shared/utils/text-forwarder'
      );

      // Input: foreground = fish, text = "echo hello"
      const result = buildTextPayload({
        foreground: 'fish',
        text: 'echo hello',
      });

      // Expected: pty.write("echo hello\n")
      // fish 同 shell 协议
      expect(result.payload).toBe('echo hello\n');
    });

    test('EDITOR_L2_25_text_empty: 空文本不发送', async () => {
      const { buildTextPayload } = await import(
        '@/shared/utils/text-forwarder'
      );

      // Input: foreground = any, text = ""
      const result = buildTextPayload({
        foreground: 'claude-code',
        text: '',
      });

      // Expected: 不发送（忽略空输入）
      expect(result.shouldSend).toBe(false);
      expect(result.payload).toBeUndefined();
    });

    test('EDITOR_L2_26_text_special_chars: 特殊字符原样转发', async () => {
      const { buildTextPayload } = await import(
        '@/shared/utils/text-forwarder'
      );

      // Input: foreground = Claude Code, text = "echo $VAR && rm -rf"
      const result = buildTextPayload({
        foreground: 'claude-code',
        text: 'echo $VAR && rm -rf',
      });

      // Expected: 特殊字符原样转发，不转义
      expect(result.payload).toBe('echo $VAR && rm -rf\r');
      // Must NOT escape special chars
      expect(result.payload).toContain('$VAR');
      expect(result.payload).toContain('&&');
    });

    test('EDITOR_L2_27_text_very_long: 超长文本正常转发', async () => {
      const { buildTextPayload } = await import(
        '@/shared/utils/text-forwarder'
      );

      // Input: foreground = Claude Code, text = 10000 字符
      const longText = 'a'.repeat(10000);
      const result = buildTextPayload({
        foreground: 'claude-code',
        text: longText,
      });

      // Expected: 正常按协议转发
      expect(result.shouldSend).toBe(true);
      expect(result.payload).toBe(longText + '\r');
      expect(result.payload!.length).toBe(10001); // 10000 chars + \r
    });
  });

  // ---------------------------------------------------------------------------
  // 2.4 图片发送规则 (PRD 8.16, 分析报告 7.5)
  // ---------------------------------------------------------------------------
  describe('图片发送规则', () => {
    test('EDITOR_L2_28_img_cc_clipboard: CC 图片通过剪贴板发送', async () => {
      const { buildImagePayload } = await import(
        '@/shared/utils/image-sender'
      );

      // Input: foreground = Claude Code, 带图片消息
      const result = await buildImagePayload({
        foreground: 'claude-code',
        imagePath: '/tmp/muxvo-images/img1.png',
        clipboardAvailable: true,
      });

      // Expected: 图片写入系统剪贴板 -> 发送 \x16 (Ctrl+V) -> 触发 CC 原生粘贴
      expect(result.strategy).toBe('clipboard');
      expect(result.clipboardWrite).toBe(true);
      expect(result.ptyPayload).toBe('\x16'); // Ctrl+V
    });

    test('EDITOR_L2_29_img_cc_fallback: CC 剪贴板失败回退到文件路径', async () => {
      const { buildImagePayload } = await import(
        '@/shared/utils/image-sender'
      );

      // Input: foreground = Claude Code, 剪贴板写入失败
      const result = await buildImagePayload({
        foreground: 'claude-code',
        imagePath: '/tmp/muxvo-images/img1.png',
        clipboardAvailable: false,
      });

      // Expected: 插入文件路径作为文本
      expect(result.strategy).toBe('filepath');
      expect(result.textPayload).toContain('/tmp/muxvo-images/img1.png');
    });

    test('EDITOR_L2_30_img_gemini: Gemini CLI 图片发送文件路径', async () => {
      const { buildImagePayload } = await import(
        '@/shared/utils/image-sender'
      );

      // Input: foreground = Gemini CLI
      const result = await buildImagePayload({
        foreground: 'gemini',
        imagePath: '/tmp/muxvo-images/img1.png',
      });

      // Expected: 插入文件路径作为文本
      expect(result.strategy).toBe('filepath');
      expect(result.textPayload).toContain('/tmp/muxvo-images/img1.png');
    });

    test('EDITOR_L2_31_img_shell: shell 图片发送文件路径', async () => {
      const { buildImagePayload } = await import(
        '@/shared/utils/image-sender'
      );

      // Input: foreground = bash
      const result = await buildImagePayload({
        foreground: 'bash',
        imagePath: '/tmp/muxvo-images/img1.png',
      });

      // Expected: 插入文件路径作为文本
      expect(result.strategy).toBe('filepath');
      expect(result.textPayload).toContain('/tmp/muxvo-images/img1.png');
    });

    test('EDITOR_L2_32_img_oversize: 超过 5MB 图片限制', async () => {
      const { validateImage } = await import(
        '@/shared/utils/image-sender'
      );

      // Input: 粘贴 >5MB 图片
      const result = validateImage({
        format: imageFixtures.tooLarge.format,
        size: imageFixtures.tooLarge.size,
      });

      // Expected: 提示文件大小限制（单张 <= 5MB）
      expect(result.valid).toBe(false);
      expect(result.error).toContain('5MB');
      expect(result.errorType).toBe('oversize');
    });

    test('EDITOR_L2_33_img_invalid_format: 不支持的图片格式', async () => {
      const { validateImage } = await import(
        '@/shared/utils/image-sender'
      );

      // Input: 粘贴 BMP/WEBP 格式图片
      const result = validateImage({
        format: imageFixtures.invalidFormat.format,
        size: imageFixtures.invalidFormat.size,
      });

      // Expected: 提示格式限制（PNG/JPG/GIF）
      expect(result.valid).toBe(false);
      expect(result.errorType).toBe('invalid_format');
      expect(result.supportedFormats).toEqual(
        expect.arrayContaining(['PNG', 'JPG', 'GIF']),
      );
    });

    test('EDITOR_L2_34_img_remove: 移除已附加图片', async () => {
      const { createEditorMachine } = await import(
        '@/shared/machines/rich-editor'
      );
      const machine = createEditorMachine();

      // Pre-condition: RichEditor, 已附加图片
      machine.send('INPUT_START');
      machine.send({ type: 'PASTE_IMAGE', imageData: 'base64...' });
      machine.send({
        type: 'IMAGE_SAVED',
        tempPath: '/tmp/muxvo-images/img1.png',
      });
      expect(machine.context.attachedImages).toHaveLength(1);

      // Trigger: 点击缩略图 x 按钮
      machine.send({
        type: 'REMOVE_IMAGE',
        imagePath: '/tmp/muxvo-images/img1.png',
      });

      // Expected: 移除缩略图，恢复纯文本模式
      expect(machine.context.attachedImages).toHaveLength(0);
      expect(machine.state).toBe('Composing');
    });
  });

  // ---------------------------------------------------------------------------
  // 2.5 自动模式检测 (PRD 8.16 RE2)
  // ---------------------------------------------------------------------------
  describe('自动模式检测', () => {
    test('EDITOR_L2_35_detect_asb_vim: ASB 进入信号自动切换 Raw', async () => {
      const { createAutoModeDetector } = await import(
        '@/shared/utils/auto-mode-detector'
      );
      const detector = createAutoModeDetector();

      // Scenario: 用户运行 vim
      // Trigger: xterm.js 解析器收到 \x1b[?1049h
      const result = detector.onTerminalOutput(asbSignals.enterRaw);

      // Expected: 自动切换到 RawTerminal 模式
      expect(result.modeSwitch).toBe(true);
      expect(result.targetMode).toBe('RawTerminal');
      expect(result.trigger).toBe('asb_enter');
    });

    test('EDITOR_L2_36_detect_asb_exit_vim: ASB 退出信号自动恢复 Rich', async () => {
      const { createAutoModeDetector } = await import(
        '@/shared/utils/auto-mode-detector'
      );
      const detector = createAutoModeDetector();

      // vim 运行中
      detector.onTerminalOutput(asbSignals.enterRaw);

      // Trigger: 收到 \x1b[?1049l
      const result = detector.onTerminalOutput(asbSignals.exitRaw);

      // Expected: 自动恢复 RichEditor 模式
      expect(result.modeSwitch).toBe(true);
      expect(result.targetMode).toBe('RichEditor');
      expect(result.trigger).toBe('asb_exit');
    });

    test('EDITOR_L2_37_detect_process_htop: 进程名匹配 TUI 列表切换 Raw', async () => {
      const { createAutoModeDetector } = await import(
        '@/shared/utils/auto-mode-detector'
      );
      const detector = createAutoModeDetector();

      // Scenario: 用户运行 htop
      // Trigger: tcgetpgrp() 返回 htop，匹配已知 TUI 列表
      const result = detector.onForegroundProcessChange('htop');

      // Expected: fallback 切换到 RawTerminal
      expect(result.modeSwitch).toBe(true);
      expect(result.targetMode).toBe('RawTerminal');
      expect(result.trigger).toBe('process_name');
    });

    test('EDITOR_L2_38_detect_cc_no_asb: CC 无 ASB 信号保持 Rich', async () => {
      const { createAutoModeDetector } = await import(
        '@/shared/utils/auto-mode-detector'
      );
      const detector = createAutoModeDetector();

      // Scenario: 用户运行 Claude Code
      // Trigger: CC 不使用 ASB
      const result = detector.onForegroundProcessChange('claude');

      // Expected: 保持 RichEditor 模式不切换
      expect(result.modeSwitch).toBe(false);
      expect(result.targetMode).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 2.6 临时文件清理规则 (PRD 8.16, 附录 H)
  // ---------------------------------------------------------------------------
  describe('临时文件清理规则', () => {
    test('EDITOR_L2_39_cleanup_on_close: 终端关闭时清理临时图片', async () => {
      const { createTempFileManager } = await import(
        '@/main/services/temp-file-manager'
      );
      const manager = createTempFileManager();

      // Scenario: 终端有临时图片文件
      const terminalId = 'term-1';
      manager.registerFile(terminalId, '/tmp/muxvo-images/term-1/img1.png');
      manager.registerFile(terminalId, '/tmp/muxvo-images/term-1/img2.png');

      // Trigger: 关闭终端
      const result = await manager.cleanupTerminal(terminalId);

      // Expected: /tmp/muxvo-images/ 下该终端的临时图片被删除
      expect(result.deletedCount).toBe(2);
      expect(result.deletedPaths).toEqual(
        expect.arrayContaining([
          '/tmp/muxvo-images/term-1/img1.png',
          '/tmp/muxvo-images/term-1/img2.png',
        ]),
      );
      expect(manager.getFilesForTerminal(terminalId)).toHaveLength(0);
    });

    test('EDITOR_L2_40_cleanup_24h: 24 小时自动清理过期文件', async () => {
      const { createTempFileManager } = await import(
        '@/main/services/temp-file-manager'
      );
      const manager = createTempFileManager();

      // Scenario: 临时图片文件存在超过 24 小时
      const now = Date.now();
      const expiredTime = now - timeConstants.tempFileCleanup - 1000; // 24h + 1s ago

      manager.registerFile('term-old', '/tmp/muxvo-images/old.png', {
        createdAt: expiredTime,
      });
      manager.registerFile('term-new', '/tmp/muxvo-images/new.png', {
        createdAt: now,
      });

      // Trigger: 定时清理
      const result = await manager.cleanupExpired(now);

      // Expected: 自动清理过期临时文件
      expect(result.deletedCount).toBe(1);
      expect(result.deletedPaths).toContain('/tmp/muxvo-images/old.png');
      // New file should remain
      expect(result.keptCount).toBe(1);
    });

    test('EDITOR_L2_41_cleanup_no_premature: 不误删活跃终端文件', async () => {
      const { createTempFileManager } = await import(
        '@/main/services/temp-file-manager'
      );
      const manager = createTempFileManager();

      // Scenario: 终端仍在运行，图片已附加
      const terminalId = 'term-active';
      manager.registerFile(terminalId, '/tmp/muxvo-images/active.png', {
        createdAt: Date.now(),
      });
      manager.markTerminalActive(terminalId);

      // Attempt cleanup on active terminal
      const result = await manager.cleanupTerminal(terminalId);

      // Expected: 临时文件不被清理（活跃终端保护）
      expect(result.deletedCount).toBe(0);
      expect(result.skippedReason).toBe('terminal_active');
      expect(manager.getFilesForTerminal(terminalId)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2.7 模式 UI 映射验证 (PRD 6.13)
  // ---------------------------------------------------------------------------
  describe('模式 UI 映射', () => {
    test('EDITOR_L2_42_ui_rich: RichEditor 模式 UI', async () => {
      const { getEditorModeUI } = await import(
        '@/renderer/stores/editor-mode-ui-map'
      );

      // State: RichEditor
      const ui = getEditorModeUI('RichEditor');

      // Expected: 富编辑器可见
      expect(ui.richEditorVisible).toBe(true);
      // 接收键盘输入（Ctrl+C/Z/D 穿透）
      expect(ui.keyboardTarget).toBe('richEditor');
      expect(ui.passthroughKeys).toEqual(
        expect.arrayContaining(['Ctrl+C', 'Ctrl+Z', 'Ctrl+D']),
      );
      // xterm.js 键盘断开
      expect(ui.xtermKeyboardAttached).toBe(false);
    });

    test('EDITOR_L2_43_ui_raw: RawTerminal 模式 UI', async () => {
      const { getEditorModeUI } = await import(
        '@/renderer/stores/editor-mode-ui-map'
      );

      // State: RawTerminal
      const ui = getEditorModeUI('RawTerminal');

      // Expected: 富编辑器隐藏
      expect(ui.richEditorVisible).toBe(false);
      // xterm.js 直接接收键盘
      expect(ui.keyboardTarget).toBe('xterm');
      expect(ui.xtermKeyboardAttached).toBe(true);
    });

    test('EDITOR_L2_44_ui_image_thumb: 图片附加后 UI', async () => {
      const { getEditorModeUI } = await import(
        '@/renderer/stores/editor-mode-ui-map'
      );

      // State: RichEditor + 已附加图片
      const ui = getEditorModeUI('RichEditor', {
        hasAttachedImages: true,
      });

      // Expected: 编辑器显示缩略图 + x 移除按钮
      expect(ui.richEditorVisible).toBe(true);
      expect(ui.thumbnailVisible).toBe(true);
      expect(ui.removeButtonVisible).toBe(true);
      // xterm.js 键盘断开
      expect(ui.xtermKeyboardAttached).toBe(false);
    });
  });
});
