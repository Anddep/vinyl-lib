import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'setPassword.ts');
let envPath: string;

function run(password: string): { status: number; stderr: string } {
  try {
    execFileSync('npx', ['ts-node', '--transpile-only', SCRIPT, password], {
      env: { ...process.env, ENV_FILE: envPath },
      stdio: 'pipe',
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const e = error as { status: number; stderr: Buffer };
    return { status: e.status, stderr: String(e.stderr) };
  }
}

function storedHash(): string {
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('ADMIN_PASSWORD_HASH='));
  return line?.split('=')[1] ?? '';
}

/** What Docker Compose hands the container after interpolating the file. */
function asCompose(escaped: string): string {
  return escaped.split('$$').join('$');
}

beforeEach(() => {
  envPath = path.join(mkdtempSync(path.join(tmpdir(), 'vinyl-env-')), '.env');
  writeFileSync(
    envPath,
    'NODE_ENV=development\nADMIN_PASSWORD_HASH=$$2b$$12$$OLD\nSESSION_SECRET=keep-me\n',
  );
});

describe('admin:set-password', () => {
  it('writes a hash that verifies the password once Compose un-escapes it', () => {
    expect(run('testpw').status).toBe(0);

    const escaped = storedHash();
    // A 60-char bcrypt hash plus one extra character per doubled $.
    expect(escaped).toHaveLength(63);
    expect(bcrypt.compareSync('testpw', asCompose(escaped))).toBe(true);
  });

  it('leaves every $ doubled', () => {
    run('testpw');

    // Regression guard: passing the line as a replacement string rather than a
    // function makes `$$` mean a literal `$`, silently collapsing the escaping
    // back to one and sending a blank hash to the container.
    expect(storedHash().startsWith('$$2b$$12$$')).toBe(true);
    expect(asCompose(storedHash()).startsWith('$2b$12$')).toBe(true);
  });

  it('preserves the rest of the file', () => {
    run('testpw');

    const contents = readFileSync(envPath, 'utf8');
    expect(contents).toContain('NODE_ENV=development');
    expect(contents).toContain('SESSION_SECRET=keep-me');
  });

  it('appends the key when the file does not have one yet', () => {
    writeFileSync(envPath, 'NODE_ENV=development\n');

    expect(run('testpw').status).toBe(0);
    expect(bcrypt.compareSync('testpw', asCompose(storedHash()))).toBe(true);
  });

  it('rejects a password under the minimum without touching the file', () => {
    const before = readFileSync(envPath, 'utf8');
    const result = run('abc');

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/at least 4/i);
    expect(readFileSync(envPath, 'utf8')).toBe(before);
  });
});
