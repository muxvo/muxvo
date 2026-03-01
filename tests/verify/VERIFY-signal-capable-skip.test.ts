/**
 * VERIFY: Bug 4 — signalCapable 终端跳过文本模式匹配 + 去抖
 *
 * 验证：
 * 1. 收到 BEL 信号后，终端标记为 signalCapable
 * 2. signalCapable 终端后续数据不触发 detectWaitingInput 文本匹配
 * 3. AUTO_RESUME_THRESHOLD 从 500 提高到 2000
 * 4. WaitingInput 至少 500ms 后才允许 auto-resume（时间去抖）
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  detectWaitingInput,
  resetInputDetector,
  shouldExitWaiting,
  detectBellSignal,
  detectOscNotification,
} from '@/main/services/terminal/input-detector';

describe('Bug 4: WaitingInput 误触发修复', () => {
  beforeEach(() => {
    resetInputDetector();
  });

  // =========================================================================
  // Fix B: signalCapable — BEL/OSC 信号检测
  // =========================================================================
  describe('signalCapable 信号检测', () => {
    test('detectBellSignal 检测独立 BEL 字符', () => {
      expect(detectBellSignal('\x07')).toBe(true);
      expect(detectBellSignal('some text\x07more text')).toBe(true);
    });

    test('detectBellSignal 排除 OSC 终止符中的 BEL', () => {
      // OSC 序列使用 \x07 作为终止符，不是真正的 bell
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
  // Fix B: CC 输出中的误报场景
  // =========================================================================
  describe('CC 输出误报场景（signalCapable 应跳过这些）', () => {
    test('CC 讨论代码时出现 ? 不应触发（对 signalCapable 终端）', () => {
      // 这些文本在 CC 输出中很常见，但对 signalCapable 终端应被跳过
      // 这里验证 detectWaitingInput 对这类文本仍然返回 true
      // （manager.ts 中的 signalCapable 检查负责跳过调用）
      const result = detectWaitingInput('? Select an option:\n', 'cc-term');
      expect(result).toBe(true); // 检测器本身会匹配

      // 关键：manager.ts 中当 signalCapable=true 时不会调用 detectWaitingInput
      // 这个逻辑在 manager.ts 行 186-188:
      //   if (!managed?.signalCapable) { ... detectWaitingInput ... }
    });

    test('(y/n) 模式被 GENERIC_PATTERNS 匹配', () => {
      const result = detectWaitingInput('Continue? (y/n)', 'test-term');
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // Fix C: AUTO_RESUME_THRESHOLD 提高到 2000
  // =========================================================================
  describe('AUTO_RESUME_THRESHOLD = 2000', () => {
    test('500 字节不足以触发 shouldExitWaiting', () => {
      // 先触发一次正检测（清空 buffer）
      detectWaitingInput('Esc to cancel\n', 'term-1');
      // 然后写入 600 字节（旧阈值会触发，新阈值不会）
      const chunk = 'x'.repeat(600);
      detectWaitingInput(chunk, 'term-1');
      expect(shouldExitWaiting('term-1')).toBe(false);
    });

    test('2000 字节足以触发 shouldExitWaiting', () => {
      detectWaitingInput('Esc to cancel\n', 'term-1');
      const chunk = 'x'.repeat(2100);
      detectWaitingInput(chunk, 'term-1');
      expect(shouldExitWaiting('term-1')).toBe(true);
    });

    test('1500 字节不触发（确认不是旧的 500 阈值）', () => {
      detectWaitingInput('Esc to cancel\n', 'term-1');
      const chunk = 'x'.repeat(1500);
      detectWaitingInput(chunk, 'term-1');
      expect(shouldExitWaiting('term-1')).toBe(false);
    });
  });

  // =========================================================================
  // Fix C: 时间去抖（manager.ts 层面）
  // =========================================================================
  describe('WaitingInput 时间去抖逻辑（manager.ts 层面）', () => {
    test('manager.ts 中 WAITING_DEBOUNCE_MS 常量存在且为 500', async () => {
      // 读取 manager.ts 源码验证常量值
      const fs = await import('fs');
      const path = await import('path');
      const managerSrc = fs.readFileSync(
        path.resolve(__dirname, '../../src/main/services/terminal/manager.ts'),
        'utf-8'
      );
      expect(managerSrc).toContain('WAITING_DEBOUNCE_MS = 500');
    });

    test('manager.ts 中 ManagedTerminal 包含 waitingSince 字段', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const managerSrc = fs.readFileSync(
        path.resolve(__dirname, '../../src/main/services/terminal/manager.ts'),
        'utf-8'
      );
      expect(managerSrc).toContain('waitingSince: number | null');
    });

    test('manager.ts 中 signalCapable 终端跳过 detectWaitingInput', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const managerSrc = fs.readFileSync(
        path.resolve(__dirname, '../../src/main/services/terminal/manager.ts'),
        'utf-8'
      );
      // 验证关键守卫条件存在
      expect(managerSrc).toContain('!managed?.signalCapable');
    });
  });

  // =========================================================================
  // Fix D: WaitingInputNotification dismiss 按钮
  // =========================================================================
  describe('WaitingInputNotification dismiss 功能', () => {
    test('组件包含 dismissed 状态和关闭按钮', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../src/renderer/components/terminal/WaitingInputNotification.tsx'),
        'utf-8'
      );
      // 验证 dismissed state 存在
      expect(src).toContain('dismissed');
      expect(src).toContain('setDismissed');
      // 验证显示条件：dismissed 为 true 时 return null
      expect(src).toContain('|| dismissed) return null');
    });
  });
});
