import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Route tests share one Postgres database and truncate between cases, so
    // running files in parallel would let one test wipe another's fixtures.
    fileParallelism: false,
  },
});
