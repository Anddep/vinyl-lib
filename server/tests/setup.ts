import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Runs inside each test worker before the test module is evaluated, so these
 * are in place before `src/config/env.ts` reads them at import time.
 *
 * This is deliberately not a Vitest `globalSetup`: that runs in the main
 * process, and env vars set there do not reliably reach worker threads.
 */
process.env.NODE_ENV = 'test';

// Never point tests at the development database — they truncate between cases.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://vinyl_lib:vinyl_lib_dev_password@localhost:5432/vinyl_lib_test?schema=public';

process.env.SESSION_SECRET = 'test-session-secret';

// The origin Supertest requests appear to come from, and the base for every
// OAuth redirect_uri the suite builds.
process.env.PUBLIC_BASE_URL = 'http://localhost:5173';

// Both providers configured, so a test can exercise either. Individual tests
// unset one with vi.stubEnv to assert that an unconfigured provider 404s.
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.GITHUB_CLIENT_ID = 'test-github-client';
process.env.GITHUB_CLIENT_SECRET = 'test-github-secret';

// Open by default so the bulk of the suite is not about invites. The signup
// gate has its own file, which stubs this per case.
process.env.SIGNUP_MODE = 'open';

// Uploads go to a temp directory, never into server/uploads — a test run
// should not leave files in the source tree, and the container writes there
// under a different user.
process.env.UPLOAD_DIR = path.join(tmpdir(), 'vinyl-lib-test-uploads');

/**
 * No test may reach the network.
 *
 * The OAuth helper swaps this out for a stub of the provider endpoints and puts
 * it back afterwards. Anything else calling fetch is a test that would depend on
 * the internet — and, worse, one whose failure surfaces as whatever the sandbox
 * or a proxy happened to answer rather than as a named problem. Fail loudly at
 * the call site instead.
 */
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`Unexpected network call in test: ${String(input)}`);
}) as unknown as typeof globalThis.fetch;
