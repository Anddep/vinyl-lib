import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapOwnerEmail,
  limits,
  parseCount,
  parsePort,
  signupMode,
} from '../../src/config/env';

afterEach(() => vi.unstubAllEnvs());

describe('parsePort', () => {
  it('accepts a numeric string', () => {
    expect(parsePort('4000')).toBe(4000);
  });

  it('falls back on an empty string', () => {
    // Compose substitutes "" for an unset variable, and Number("") is 0, not
    // NaN — so a naive parse silently binds the server to a random port.
    expect(parsePort('')).toBe(4000);
  });

  it('falls back on whitespace', () => {
    expect(parsePort('   ')).toBe(4000);
  });

  it('falls back on undefined', () => {
    expect(parsePort(undefined)).toBe(4000);
  });

  it('throws on a non-numeric value rather than binding somewhere unexpected', () => {
    expect(() => parsePort('abc')).toThrow(/Invalid PORT/);
  });
});

describe('parseCount', () => {
  it('falls back on an empty string, which is what Compose sends for an unset variable', () => {
    expect(parseCount('', 100)).toBe(100);
    expect(parseCount(undefined, 100)).toBe(100);
  });

  it('falls back rather than accepting zero or a negative, which would disable the limit', () => {
    expect(parseCount('0', 100)).toBe(100);
    expect(parseCount('-5', 100)).toBe(100);
  });

  it('throws on a value that is not a number, rather than silently using the fallback', () => {
    expect(() => parseCount('lots', 100)).toThrow();
  });

  it('reads a real value', () => {
    expect(parseCount('250', 100)).toBe(250);
  });
});

describe('signupMode', () => {
  it('defaults to invite, so an unconfigured deployment is not open', () => {
    vi.stubEnv('SIGNUP_MODE', '');
    expect(signupMode()).toBe('invite');
  });

  it.each(['closed', 'invite', 'open'])('accepts %s', (mode) => {
    vi.stubEnv('SIGNUP_MODE', mode);
    expect(signupMode()).toBe(mode);
  });

  it('throws on an unrecognised mode rather than guessing', () => {
    vi.stubEnv('SIGNUP_MODE', 'public');
    expect(() => signupMode()).toThrow(/SIGNUP_MODE/);
  });
});

describe('bootstrapOwnerEmail', () => {
  it('is null when unset', () => {
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', '');
    expect(bootstrapOwnerEmail()).toBeNull();
  });

  it('is lowercased and trimmed, because it is compared against a provider address', () => {
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', '  Andriy@Example.COM ');
    expect(bootstrapOwnerEmail()).toBe('andriy@example.com');
  });
});

describe('limits', () => {
  it('defaults to 5 MB per file and 150 MB per user', () => {
    vi.stubEnv('MAX_UPLOAD_BYTES', '');
    vi.stubEnv('UPLOAD_QUOTA_BYTES', '');
    expect(limits().maxUploadBytes).toBe(5 * 1024 * 1024);
    expect(limits().uploadQuotaBytes).toBe(150 * 1024 * 1024);
  });

  it('reads overrides', () => {
    vi.stubEnv('MAX_RECORDS_PER_USER', '10');
    expect(limits().maxRecords).toBe(10);
  });
});
