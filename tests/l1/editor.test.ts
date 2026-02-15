/**
 * EDITOR L1 -- 契约层测试
 * Source: docs/Muxvo_测试_v2/02_modules/test_EDITOR.md
 * Total: 8 L1 cases (EDITOR_L1_01 ~ EDITOR_L1_08)
 *
 * RED phase: all tests have real assertions but will FAIL because
 * source modules are not yet implemented.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleIpc, invokeIpc, resetIpcMocks } from '../helpers/mock-ipc';
import { textForwardFixtures, imageFixtures } from '../helpers/test-fixtures';
import editorSpec from '../specs/l1/editor.spec.json';

describe('EDITOR L1 -- 契约层测试', () => {
  beforeEach(() => {
    resetIpcMocks();
  });

  // -------------------------------------------------------------------------
  // IPC 消息格式
  // -------------------------------------------------------------------------
  describe('IPC 消息格式', () => {
    const ipcCases = editorSpec.cases.filter((c) => c.type === 'ipc');

    test('EDITOR_L1_01: terminal:write 文本发送 -- 编辑器发送 "hello" 调用 pty.write("hello\\r")', async () => {
      // RED: import the real text-forward module (will fail)
      const { forwardTextToPty } = await import('@/main/ipc/text-forward');

      const result = forwardTextToPty({
        text: 'hello',
        foregroundProcess: 'bash',
      });

      // The forwarded data should append \r for single-line send
      expect(result).toBe('hello\r');
    });

    test('EDITOR_L1_02: terminal:write 多行(CC) -- 前台=Claude Code 时使用 \\x1b\\r 分隔', async () => {
      // RED: import the real text-forward module (will fail)
      const { forwardTextToPty } = await import('@/main/ipc/text-forward');

      const result = forwardTextToPty({
        text: 'line1\nline2',
        foregroundProcess: 'Claude Code',
      });

      // CC protocol: lines separated by ESC+CR, terminated by CR
      expect(result).toBe('line1\x1b\rline2\r');

      // Also verify fixtures match the expected CC protocol
      expect(textForwardFixtures.claudeCode.separator).toBe('\x1b\r');
      expect(textForwardFixtures.claudeCode.submit).toBe('\r');
    });

    test('EDITOR_L1_03: terminal:write 多行(shell) -- 前台=bash 时使用 \\n 分隔', async () => {
      // RED: import the real text-forward module (will fail)
      const { forwardTextToPty } = await import('@/main/ipc/text-forward');

      const result = forwardTextToPty({
        text: 'line1\nline2',
        foregroundProcess: 'bash',
      });

      // Shell protocol: lines separated by \n, terminated by \n
      expect(result).toBe('line1\nline2\n');

      // Verify fixtures match the expected shell protocol
      expect(textForwardFixtures.shell.separator).toBeNull();
      expect(textForwardFixtures.shell.submit).toBe('\n');
    });

    test('EDITOR_L1_04: fs:write-temp-image -- 粘贴图片保存到 /tmp/muxvo-images/{uuid}.png', async () => {
      // RED: import the real image handler (will fail)
      const { writeTempImage } = await import('@/main/ipc/image-handler');

      const result = await writeTempImage({
        imageData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG magic bytes
        format: 'PNG',
      });

      // Should return a path under /tmp/muxvo-images/ with .png extension
      expect(result.filePath).toMatch(/^\/tmp\/muxvo-images\/[a-f0-9-]+\.png$/);
    });

    test('EDITOR_L1_05: fs:write-clipboard-image -- CC 前台时图片写入剪贴板后发送 \\x16', async () => {
      // RED: import the real clipboard image handler (will fail)
      const { writeClipboardImage } = await import('@/main/ipc/image-handler');

      const result = await writeClipboardImage({
        imageData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        foregroundProcess: 'Claude Code',
      });

      // When CC is foreground, should write to clipboard then send Ctrl+V
      expect(result.action).toBe('clipboard_paste');
      expect(result.keySent).toBe('\x16'); // Ctrl+V
    });

    // Verify all IPC spec cases have correct channel definitions
    test.each(ipcCases)('$id: IPC channel "$channel" is defined -- $description', ({ channel }) => {
      expect(channel).toBeDefined();
      expect(typeof channel).toBe('string');
      expect(channel).toMatch(/^(terminal|fs):/);
    });
  });

  // -------------------------------------------------------------------------
  // 默认值
  // -------------------------------------------------------------------------
  describe('默认值', () => {
    const defaultCases = editorSpec.cases.filter((c) => c.type === 'default-value');

    test('EDITOR_L1_06: 默认模式 -- 终端启动时为 RichEditor 模式', async () => {
      // RED: import the real editor config (will fail)
      const { getEditorDefaults } = await import('@/renderer/components/editor/editor-config');

      const defaults = getEditorDefaults();
      expect(defaults.mode).toBe('RichEditor');
    });

    test('EDITOR_L1_07: 默认发送快捷键 -- Enter/Cmd+Enter 发送, Shift+Enter 换行', async () => {
      // RED: import the real editor config (will fail)
      const { getEditorDefaults } = await import('@/renderer/components/editor/editor-config');

      const defaults = getEditorDefaults();
      expect(defaults.sendKey).toEqual(
        expect.objectContaining({
          send: expect.arrayContaining(['Enter', 'Cmd+Enter']),
          newline: 'Shift+Enter',
        }),
      );
    });

    test('EDITOR_L1_08: 默认编辑器类型 -- MVP 使用 contenteditable div', async () => {
      // RED: import the real editor config (will fail)
      const { getEditorDefaults } = await import('@/renderer/components/editor/editor-config');

      const defaults = getEditorDefaults();
      expect(defaults.technology).toBe('contenteditable div');
    });

    // Verify all default-value spec cases are defined
    test.each(defaultCases)('$id: spec default-value case present -- $description', ({ target, expectedValue }) => {
      expect(target).toBeDefined();
      expect(expectedValue).toBeDefined();
    });
  });
});
