// vitest 基建冒烟（M2 任务1）：证明测试管线真执行、glob 真命中。
// spec case 翻牌测试（test 名带 spec ID）随 B1 批落地，此文件刻意不用 spec ID 命名。
import { expect, test } from 'vitest'
import { rowDistribution } from '../src/grid/layout'

test('rowDistribution 冒烟：N=4 → [2,2]，任意 N 总数守恒', () => {
  expect(rowDistribution(4)).toEqual([2, 2])
  for (const n of [1, 5, 11, 20]) {
    expect(rowDistribution(n).reduce((a, b) => a + b, 0)).toBe(n)
  }
})
