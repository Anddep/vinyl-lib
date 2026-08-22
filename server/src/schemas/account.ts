import { z } from 'zod';
import { USER_SLUG_PATTERN, isReserved } from '../lib/userSlug';

/**
 * Strict, so an unknown key is a 400 rather than a silently ignored no-op — and
 * so a posted `suspendedAt` or `bootstrap` is refused at the boundary rather
 * than relying on the handler to pick fields carefully.
 */
export const accountUpdateSchema = z
  .strictObject({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(USER_SLUG_PATTERN, '3-32 characters: lowercase letters, numbers and inner hyphens')
      .refine((value) => !isReserved(value), { message: 'That address is not available' }),
    displayName: z.string().trim().min(1, 'A name is required').max(80, 'That name is too long'),
    isPublic: z.boolean(),
  })
  .partial();
