import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['apps/**/*.{test,spec}.ts', 'packages/**/*.{test,spec}.ts'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/dist/**', '**/node_modules/**', '**/*.config.*'],
    },
  },
});
