import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'VERIFY-*.spec.ts',
  timeout: 30000,
  retries: 0,
  use: {
    trace: 'off',
  },
  reporter: [['list']],
});
