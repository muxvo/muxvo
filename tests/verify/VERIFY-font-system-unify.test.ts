import { describe, test, expect } from 'vitest';

/**
 * VERIFY: 字体系统统一
 *
 * 验证：
 * 1. theme.css 的 --font-mono 和 --font-sans 变量值正确
 * 2. 所有 CSS 文件不再硬编码 font-family（使用 var(--font-mono) 或 var(--font-sans)）
 * 3. TS 终端配置使用共享常量 TERMINAL_FONT_FAMILY
 * 4. 终端默认字号为 14px
 * 5. font-smoothing 已设置
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SRC = resolve(ROOT, 'src');

// 已知的等宽硬编码模式（不应再出现在 CSS 文件中）
const HARDCODED_MONO_PATTERNS = [
  "'SF Mono', Monaco, 'Courier New', monospace",
  "'SF Mono', Monaco, 'Cascadia Code', monospace",
  "'Menlo', 'Monaco', 'Courier New', monospace",
  "font-family: monospace;",
];

// 已知的无衬线硬编码模式
const HARDCODED_SANS_PATTERNS = [
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
];

describe('Font system unification', () => {
  test('theme.css --font-mono includes JetBrains Mono + SF Mono + Cascadia Code', () => {
    const css = readFileSync(
      resolve(SRC, 'renderer/styles/theme.css'),
      'utf-8',
    );
    // 提取 --font-mono 变量值
    const monoMatch = css.match(/--font-mono:\s*([^;]+);/);
    expect(monoMatch).not.toBeNull();
    const monoValue = monoMatch![1];
    expect(monoValue).toContain('JetBrains Mono');
    expect(monoValue).toContain('SF Mono');
    expect(monoValue).toContain('Cascadia Code');
    expect(monoValue).toContain('monospace');
  });

  test('theme.css --font-sans includes PingFang SC and CJK fallbacks, no DM Sans', () => {
    const css = readFileSync(
      resolve(SRC, 'renderer/styles/theme.css'),
      'utf-8',
    );
    const sansMatch = css.match(/--font-sans:\s*([^;]+);/);
    expect(sansMatch).not.toBeNull();
    const sansValue = sansMatch![1];
    expect(sansValue).toContain('PingFang SC');
    expect(sansValue).toContain('Microsoft YaHei');
    expect(sansValue).toContain('Noto Sans CJK SC');
    expect(sansValue).not.toContain('DM Sans');
  });

  test('no hardcoded mono font-family in CSS files', () => {
    const cssFiles = findCssFiles(resolve(SRC, 'renderer'));
    const violations: string[] = [];

    for (const file of cssFiles) {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of HARDCODED_MONO_PATTERNS) {
        if (content.includes(pattern)) {
          // 允许 var() fallback 形式如 var(--font-mono, monospace)
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern) && !lines[i].includes('var(')) {
              violations.push(`${file}:${i + 1} — ${pattern}`);
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('no hardcoded sans font-family in CSS files', () => {
    const cssFiles = findCssFiles(resolve(SRC, 'renderer'));
    const violations: string[] = [];

    for (const file of cssFiles) {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of HARDCODED_SANS_PATTERNS) {
        if (content.includes(pattern)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern) && !lines[i].includes('var(')) {
              violations.push(`${file}:${i + 1} — ${pattern}`);
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('TS terminal config uses shared TERMINAL_FONT_FAMILY constant', () => {
    const termConfig = readFileSync(
      resolve(SRC, 'renderer/stores/terminal-config.ts'),
      'utf-8',
    );
    expect(termConfig).toContain('TERMINAL_FONT_FAMILY');

    const defaults = readFileSync(
      resolve(SRC, 'shared/config/defaults.ts'),
      'utf-8',
    );
    expect(defaults).toContain('TERMINAL_FONT_FAMILY');

    const config = readFileSync(
      resolve(SRC, 'main/services/app/config.ts'),
      'utf-8',
    );
    expect(config).toContain('TERMINAL_FONT_FAMILY');
  });

  test('shared fonts.ts constant exists and matches CSS variable', () => {
    const fontsTs = readFileSync(
      resolve(SRC, 'shared/constants/fonts.ts'),
      'utf-8',
    );
    expect(fontsTs).toContain('TERMINAL_FONT_FAMILY');
    expect(fontsTs).toContain('JetBrains Mono');
    expect(fontsTs).toContain('SF Mono');
    expect(fontsTs).toContain('Cascadia Code');
  });

  test('terminal default fontSize is 14', () => {
    const termConfig = readFileSync(
      resolve(SRC, 'renderer/stores/terminal-config.ts'),
      'utf-8',
    );
    // 查找 fontSize 默认值
    expect(termConfig).toMatch(/fontSize:\s*14/);

    const defaults = readFileSync(
      resolve(SRC, 'shared/config/defaults.ts'),
      'utf-8',
    );
    expect(defaults).toMatch(/fontSize:\s*14/);
  });

  test('font-smoothing is set for dark theme', () => {
    const css = readFileSync(
      resolve(SRC, 'renderer/styles/theme.css'),
      'utf-8',
    );
    expect(css).toContain('-webkit-font-smoothing: antialiased');
  });
});

/** Recursively find all .css files under a directory */
function findCssFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCssFiles(fullPath));
    } else if (entry.name.endsWith('.css')) {
      results.push(fullPath);
    }
  }
  return results;
}
