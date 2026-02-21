import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(import.meta.dirname, './src'),
      test: resolve(import.meta.dirname, './test'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    mockReset: true,
    clearMocks: true,
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads',
    include: ['src/**/*.{test,spec}.{ts,js,mjs}'],
    coverage: {
      provider: 'v8',
      reporter: process.env.TEST_MODE === 'ci' ? ['json-summary'] : ['text'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,js,mjs}'],
      exclude: ['src/index.ts', 'src/**/models/**/*.{ts,js,mjs}'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
