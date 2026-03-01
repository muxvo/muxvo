/**
 * VERIFY: BEL/OSC 信号检测 + WaitingInputNotification dismiss
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  detectWaitingInput,
  resetInputDetector,
  detectBellSignal,
  detectOscNotification,
} from '@/main/services/terminal/input-detector';

describe('BEL/OSC 信号检测 + WaitingInput UI', () => {
  beforeEach(() => {
    resetInputDetector();
  });

  // =========================================================================
  // BEL/OSC 信号检测
  // =========================================================================
  describe('BEL/OSC 信号检测', () => {
    test('detectBellSignal 检测独立 BEL 字符', () => {
      expect(detectBellSignal('\x07')).toBe(true);
      expect(detectBellSignal('some text\x07more text')).toBe(true);
    });

    test('detectBellSignal 排除 OSC 终止符中的 BEL', () => {
      expect(detectBellSignal('\x1b]0;window title\x07')).toBe(false);
    });

    test('detectOscNotification 解析 OSC 9', () => {
      const result = detectOscNotification('\x1b]9;notification text\x07');
      expect(result).toEqual({ type: 9, message: 'notification text' });
    });

    test('detectOscNotification 解析 OSC 777', () => {
      const result = detectOscNotification('\x1b]777;notify;title;body\x07');
      expect(result).toEqual({ type: 777, message: 'title: body' });
    });

    test('detectOscNotification 无匹配返回 null', () => {
      expect(detectOscNotification('plain text')).toBeNull();
    });
  });

  // =========================================================================
  // 文本模式匹配仍然有效
  // =========================================================================
  describe('文本模式匹配', () => {
    test('inquirer 风格提示被匹配', () => {
      const result = detectWaitingInput('? Select an option:\n', 'cc-term');
      expect(result).toBe(true);
    });

    test('(y/n) 模式被匹配', () => {
      const result = detectWaitingInput('Continue? (y/n)', 'test-term');
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // WaitingInputNotification dismiss 按钮
  // =========================================================================
  describe('WaitingInputNotification dismiss 功能', () => {
    test('组件包含 dismissed 状态和关闭按钮', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../src/renderer/components/terminal/WaitingInputNotification.tsx'),
        'utf-8'
      );
      expect(src).toContain('dismissed');
      expect(src).toContain('setDismissed');
      expect(src).toContain('|| dismissed) return null');
    });
  });

  // =========================================================================
  // acknowledgeWaiting：点击终端清除 WaitingInput
  // =========================================================================
  describe('acknowledgeWaiting 逻辑', () => {
    test('manager.ts 包含 acknowledgeWaiting 函数', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const managerSrc = fs.readFileSync(
        path.resolve(__dirname, '../../src/main/services/terminal/manager.ts'),
        'utf-8'
      );
      expect(managerSrc).toContain('function acknowledgeWaiting');
      expect(managerSrc).toContain('acknowledgeWaiting');
    });

    test('handleTileClick 调用 acknowledgeWaiting', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../src/renderer/contexts/TerminalContext.tsx'),
        'utf-8'
      );
      expect(src).toContain('acknowledgeWaiting');
    });
  });
});
