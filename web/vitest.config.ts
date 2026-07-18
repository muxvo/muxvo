// M2 任务1：web 宇宙测试设施。include 与 spec-runner 的 web 宇宙扫描范围
// （web/{src,tests}/**/*.{test,spec}.{ts,tsx,js,jsx}）保持一致——spec-runner 查
// 「测试存在且命名 1:1」，vitest 真执行，两道防线缺一不可（preflight 第 2 步）。
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts}'],
  },
})
