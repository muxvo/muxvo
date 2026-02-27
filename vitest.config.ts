import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/verify/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.ts'],
    },
    testTimeout: 10000,
    setupFiles: ['./tests/setup.ts'],
    server: {
      deps: {
        inline: [/^@\//],
      },
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
      // @xterm/addon-ligatures has broken main field (points to non-existent .js, only .mjs exists)
      '@xterm/addon-ligatures$': path.resolve(__dirname, './node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs'),
    },
  },
});
