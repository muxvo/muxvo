/**
 * VERIFY: PDF 打开不再卡死
 *
 * 验证：
 * 1. mapExtToFileType('pdf') 返回 'pdf' 而非 'text'
 * 2. PDF 类型不会走 UTF-8 readFile 路径（即不会卡死）
 */

import { describe, test, expect } from 'vitest';
import { mapExtToFileType } from '@/renderer/utils/file-tree';

describe('PDF open freeze fix', () => {
  test('mapExtToFileType recognizes pdf extension', () => {
    expect(mapExtToFileType('pdf')).toBe('pdf');
  });

  test('pdf extension does NOT fall through to text', () => {
    expect(mapExtToFileType('pdf')).not.toBe('text');
  });

  test('other file types still work correctly', () => {
    expect(mapExtToFileType('md')).toBe('markdown');
    expect(mapExtToFileType('ts')).toBe('code');
    expect(mapExtToFileType('png')).toBe('image');
    expect(mapExtToFileType('xlsx')).toBe('spreadsheet');
    expect(mapExtToFileType('txt')).toBe('text');
    expect(mapExtToFileType('unknown')).toBe('text');
  });
});
