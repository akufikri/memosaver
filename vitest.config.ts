import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    server: {
      deps: {
        external: ['node:sqlite', 'node:fs', 'node:path', 'node:os', /^node:/]
      }
    },
    testTimeout: 20000
  }
});