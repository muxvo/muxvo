import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const PROJECT = resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  root: resolve(PROJECT, 'src/renderer'),
  resolve: {
    alias: { '@': resolve(PROJECT, 'src') },
  },
  server: { port: 5173 },
});
