import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Route tests share one Postgres database and truncate between cases, so
    // running files in parallel would let one test wipe another's fixtures.
    fileParallelism: false,
    // Raised from the 5s default. Every test now signs in through the real
    // OAuth callback — two requests, a session write and a transaction — against
    // a Dockerised Postgres, and a busy host pushes the occasional case past
    // five seconds. Generous enough to absorb that, still short enough that a
    // genuine hang fails rather than stalls the run.
    testTimeout: 15_000,
  },
});
