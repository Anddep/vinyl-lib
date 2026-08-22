const MAX_LIMIT = 100;

/**
 * Clamp a client-supplied limit into [1, 100]. Anything unparseable falls back
 * rather than erroring — a bad query string should not 500 a public page.
 */
export function parseLimit(raw: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, MAX_LIMIT);
}
