import { describe, expect, it } from 'vitest';
import { safeUrl } from '../../src/lib/url';

describe('safeUrl', () => {
  it.each(['https://discogs.com/release/1', 'http://example.com'])('accepts %s', (value) => {
    expect(safeUrl.parse(value)).toBe(value);
  });

  it.each([
    // `new URL()` parses every one of these happily. Each becomes stored XSS
    // or worse once rendered into an href the visitor clicks.
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
  ])('rejects %s', (value) => {
    expect(() => safeUrl.parse(value)).toThrow();
  });

  it('rejects a string that is not a url at all', () => {
    expect(() => safeUrl.parse('not a url')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => safeUrl.parse('')).toThrow();
  });
});
