/**
 * Applies migrations to the test database.
 *
 * Prisma reads DATABASE_URL, so this points it at DATABASE_URL_TEST for the
 * duration of the child process. Doing it in Node rather than inline shell
 * keeps it working the same on macOS, Linux and Windows.
 */
import { execFileSync } from 'node:child_process';

const url =
  process.env.DATABASE_URL_TEST ??
  'postgresql://vinyl_lib:vinyl_lib_dev_password@localhost:5432/vinyl_lib_test?schema=public';

execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
