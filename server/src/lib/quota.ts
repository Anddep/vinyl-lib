import type { Response } from 'express';

/**
 * Answers the 409 when a per-account ceiling is reached, and reports whether
 * the caller should continue.
 *
 * 409 rather than 403: the request is well-formed and the caller is entitled to
 * make it — the conflict is with the state of their account. It carries a
 * form-level message, which the admin screens already know how to render.
 */
export function enforceCeiling(
  res: Response,
  { count, max, noun }: { count: number; max: number; noun: string },
): boolean {
  if (count >= max) {
    res.status(409).json({ error: `You have reached the limit of ${max} ${noun}.` });
    return false;
  }
  return true;
}
