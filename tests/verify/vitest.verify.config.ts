import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
      '@tests': path.resolve(__dirname, '../../tests'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/verify/VERIFY-*.spec.ts', 'tests/verify/VERIFY-*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
