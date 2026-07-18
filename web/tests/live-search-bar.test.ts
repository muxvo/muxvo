// 终端内搜索条交互逻辑（terminal-search-bar.md §5.5，批5②）：键映射 + 输入防抖派发器。
// LiveSearchBar 组件本身是薄挂载胶水（量 rect + createPortal），逻辑抽到 searchBarLogic 直测（node 环境）。
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, makeQueryDebouncer, searchKeyAction } from '../src/screen/search/searchBarLogic';

describe('searchKeyAction 键映射', () => {
  test('Enter→searchNext；Shift+Enter→searchPrev；Escape→searchClose；其余→null', () => {
    expect(searchKeyAction('Enter', false)).toBe('searchNext');
    expect(searchKeyAction('Enter', true)).toBe('searchPrev');
    expect(searchKeyAction('Escape', false)).toBe('searchClose');
    expect(searchKeyAction('Escape', true)).toBe('searchClose');
    expect(searchKeyAction('a', false)).toBeNull();
    expect(searchKeyAction('ArrowDown', false)).toBeNull();
  });
});

describe('makeQueryDebouncer 输入防抖', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('连打只在停顿满 delay 后派发一次，取最后一次的值', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const d = makeQueryDebouncer((q) => seen.push(q));
    d.schedule('f');
    d.schedule('fo');
    d.schedule('foo');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(seen).toEqual([]); // 未满 delay，零派发
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['foo']); // 满 delay，只出最后一次
  });

  test('flush 冲刷待发（派发 + 返回 true）；无待发时返回 false', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const d = makeQueryDebouncer((q) => seen.push(q));
    expect(d.flush()).toBe(false); // 无待发
    d.schedule('bar');
    expect(d.flush()).toBe(true); // 有待发 → 立即派发
    expect(seen).toEqual(['bar']);
    // 冲刷后计时器已清，再 flush 无待发。
    expect(d.flush()).toBe(false);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(seen).toEqual(['bar']); // 不重复派发
  });

  test('cancel 丢弃待发（关闭 / 卸载）', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const d = makeQueryDebouncer((q) => seen.push(q));
    d.schedule('gone');
    d.cancel();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    expect(seen).toEqual([]); // 取消后不派发
    expect(d.flush()).toBe(false);
  });
});
