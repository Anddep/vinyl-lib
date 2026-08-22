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
// A real bcryptjs hash of "test-password" at cost 12. Tests log in with that
// literal, so this must stay in sync with tests/helpers/auth.ts.
process.env.ADMIN_PASSWORD_HASH = '$2b$12$ATaedXgAVts7LfRAtZR1quKUX0SF6pFs88/DSbIA5SYegl6xUTHIO';

// Uploads go to a temp directory, never into server/uploads — a test run
// should not leave files in the source tree, and the container writes there
// under a different user.
process.env.UPLOAD_DIR = path.join(tmpdir(), 'vinyl-lib-test-uploads');
