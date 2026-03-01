/**
 * Foreground Detector L2 Tests
 *
 * Tests the foreground process detection and CWD resolution functions
 * used for syncing terminal CWD with child process working directories.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'child_process';
import {
  getForegroundProcessName,
  getForegroundChildPid,
  getProcessCwd,
} from '@/main/services/terminal/foreground-detector';

const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Foreground Detector L2', () => {
  // ---------------------------------------------------------------------------
  // getForegroundProcessName
  // ---------------------------------------------------------------------------
  describe('getForegroundProcessName', () => {
    test('returns process name from ps output', () => {
      mockExecFileSync.mockReturnValue('node\n');
      expect(getForegroundProcessName(12345)).toBe('node');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'ps',
        ['-p', '12345', '-o', 'comm='],
        expect.objectContaining({ encoding: 'utf-8', timeout: 2000 }),
      );
    });

    test('returns null on empty output', () => {
      mockExecFileSync.mockReturnValue('');
      expect(getForegroundProcessName(12345)).toBeNull();
    });

    test('returns null on error', () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('No such process'); });
      expect(getForegroundProcessName(99999)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getForegroundChildPid
  // ---------------------------------------------------------------------------
  describe('getForegroundChildPid', () => {
    test('returns single child PID', () => {
      mockExecFileSync.mockReturnValue('54321\n');
      expect(getForegroundChildPid(12345)).toBe(54321);
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'pgrep',
        ['-P', '12345'],
        expect.objectContaining({ encoding: 'utf-8', timeout: 2000 }),
      );
    });

    test('returns last PID when multiple children exist', () => {
      mockExecFileSync.mockReturnValue('100\n200\n300\n');
      expect(getForegroundChildPid(12345)).toBe(300);
    });

    test('returns null when no children exist (error from pgrep)', () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('exit code 1'); });
      expect(getForegroundChildPid(12345)).toBeNull();
    });

    test('returns null on empty output', () => {
      mockExecFileSync.mockReturnValue('');
      expect(getForegroundChildPid(12345)).toBeNull();
    });

    test('filters out NaN entries from malformed output', () => {
      mockExecFileSync.mockReturnValue('abc\n200\n');
      expect(getForegroundChildPid(12345)).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // getProcessCwd
  // ---------------------------------------------------------------------------
  describe('getProcessCwd', () => {
    test('parses lsof output correctly', () => {
      mockExecFileSync.mockReturnValue('p54321\nfcwd\nn/Users/rl/project\n');
      expect(getProcessCwd(54321)).toBe('/Users/rl/project');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'lsof',
        ['-a', '-p', '54321', '-d', 'cwd', '-Fn'],
        expect.objectContaining({ encoding: 'utf-8', timeout: 2000 }),
      );
    });

    test('handles paths with spaces', () => {
      mockExecFileSync.mockReturnValue('p54321\nfcwd\nn/Users/rl/my project/src\n');
      expect(getProcessCwd(54321)).toBe('/Users/rl/my project/src');
    });

    test('handles paths with CJK characters', () => {
      mockExecFileSync.mockReturnValue('p54321\nfcwd\nn/Users/rl/文档/项目\n');
      expect(getProcessCwd(54321)).toBe('/Users/rl/文档/项目');
    });

    test('returns null on lsof error', () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('lsof failed'); });
      expect(getProcessCwd(54321)).toBeNull();
    });

    test('returns null when no path line in output', () => {
      mockExecFileSync.mockReturnValue('p54321\nfcwd\n');
      expect(getProcessCwd(54321)).toBeNull();
    });
  });
});
