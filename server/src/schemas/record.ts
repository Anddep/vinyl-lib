import { z } from 'zod';
import { imageSource, safeUrl } from '../lib/url';

/**
 * Bounded as well as required.
 *
 * These were unbounded, which was harmless with one collector and is a payload
 * on a public site: they are the spam text itself, they break the card layout,
 * and genre feeds the filter chips on every visitor's page.
 */
const text = (max: number, required: string) =>
  z.string().trim().min(1, required).max(max, 'That is too long');

export const recordCreateSchema = z.object({
  title: text(200, 'Title is required'),
  artist: text(200, 'Artist is required'),
  // Vinyl predates 1880 by nothing worth cataloguing; the upper bound stops a
  // fat-fingered 19700 sorting to the top of every decade filter forever.
  year: z.number().int().min(1880, 'Year looks wrong').max(2100, 'Year looks wrong'),
  format: text(200, 'Format is required'),
  genre: text(200, 'Genre is required'),
  slug: z.string().trim().min(1).max(200).optional(),
  url: safeUrl.nullish(),
  coverUrl: imageSource.nullish(),
  position: z.number().int().min(0).optional(),
  addedAt: z.coerce.date().optional(),
});

// Derived from the same object, so create and update can never drift apart.
export const recordUpdateSchema = recordCreateSchema.partial();

export type RecordCreate = z.infer<typeof recordCreateSchema>;
