import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 仅在 build 时置相对路径 './'，供 app bundle 内 file:// 加载（含动态 import 的
// bridge/client chunk，Vite 相对 base 会注入 import.meta.url 解析）。dev server 与
// ?screenshot=1 截图路径恒走默认 base '/'，行为字节级不变（visual-diff 64/64 取证）。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    port: 5198,
    strictPort: true,
  },
}));
