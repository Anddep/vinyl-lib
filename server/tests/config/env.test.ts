import { describe, expect, it } from 'vitest';
import { parsePort } from '../../src/config/env';

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
