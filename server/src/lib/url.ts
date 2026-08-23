import { z } from 'zod';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * A URL the collector pastes ends up in an href the visitor clicks, so the
 * protocol allowlist is the whole point: `new URL('javascript:alert(1)')`
 * parses perfectly happily, as do `data:` and `file:`.
 */
export const safeUrl = z.string().refine(
  (value) => {
    try {
      // Trimmed first: a leading space does not stop a browser following
      // " javascript:..." but would change how a naive check reads it.
      return ALLOWED_PROTOCOLS.has(new URL(value.trim()).protocol);
    } catch {
      return false;
    }
  },
  { message: 'Must be an http or https URL' },
);

/**
 * Where an image can come from: an uploaded file, or an external URL subject to
 * the same protocol allowlist as any other link.
 *
 * The owner segment is optional because files written before uploads became
 * owner-scoped still sit flat in the directory and their coverUrl values were
 * deliberately not rewritten. Exactly one optional numeric segment, so the
 * pattern cannot be talked into matching a traversal.
 */
export const imageSource = z.union([safeUrl, z.string().regex(/^\/uploads\/(?:\d+\/)?[\w.-]+$/)]);
