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
    include: ['tests/verify/**/*.test.ts'],
    exclude: ['node_modules/**'],
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
      '@xterm/addon-ligatures$': path.resolve(__dirname, './node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs'),
    },
  },
});
