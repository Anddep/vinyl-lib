import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

/**
 * Parses the body against a schema and hands the admin forms a field-keyed
 * error object they can render against the matching input, rather than one
 * opaque string.
 *
 * The parsed value lands on `res.locals.body`, so handlers work from the
 * stripped, coerced data instead of the raw request — an unknown key like
 * `isAdmin` never reaches Prisma.
 */
export function validate(
  schema: ZodType,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        // First message wins: it is the most specific for that field.
        if (!fields[key]) {
          fields[key] = issue.message;
        }
      }
      res.status(400).json({ error: 'Validation failed', fields });
      return;
    }

    res.locals.body = result.data;
    next();
  };
}
