/**
 * Parses a numeric route param.
 *
 * Returns null rather than NaN for anything unparseable: handing NaN to a
 * Prisma `where: { id }` throws a validation error that surfaces as a 500,
 * where the honest answer is a 400.
 */
export function parseId(raw: string | undefined): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
