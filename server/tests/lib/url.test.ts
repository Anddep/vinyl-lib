import { describe, expect, it } from 'vitest';
import { imageSource, safeUrl } from '../../src/lib/url';

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

describe('imageSource with owner-scoped uploads', () => {
  it('accepts an owner-scoped upload path', () => {
    expect(imageSource.safeParse('/uploads/12/9f3c1b2a.webp').success).toBe(true);
  });

  it('still accepts a flat path, because files predating the change are not moved', () => {
    expect(imageSource.safeParse('/uploads/9f3c1b2a.webp').success).toBe(true);
  });

  it('rejects a deeper path, which is the shape a traversal attempt would take', () => {
    expect(imageSource.safeParse('/uploads/12/nested/a.webp').success).toBe(false);
    expect(imageSource.safeParse('/uploads/../../etc/passwd').success).toBe(false);
  });

  it('rejects a non-numeric first segment', () => {
    expect(imageSource.safeParse('/uploads/admin/a.webp').success).toBe(false);
  });
});
