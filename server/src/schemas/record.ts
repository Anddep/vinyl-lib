import { z } from 'zod';
import { imageSource, safeUrl } from '../lib/url';

export const recordCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  artist: z.string().trim().min(1, 'Artist is required'),
  // Vinyl predates 1880 by nothing worth cataloguing; the upper bound stops a
  // fat-fingered 19700 sorting to the top of every decade filter forever.
  year: z.number().int().min(1880, 'Year looks wrong').max(2100, 'Year looks wrong'),
  format: z.string().trim().min(1, 'Format is required'),
  genre: z.string().trim().min(1, 'Genre is required'),
  slug: z.string().trim().min(1).optional(),
  url: safeUrl.nullish(),
  coverUrl: imageSource.nullish(),
  featured: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  addedAt: z.coerce.date().optional(),
});

// Derived from the same object, so create and update can never drift apart.
export const recordUpdateSchema = recordCreateSchema.partial();

export type RecordCreate = z.infer<typeof recordCreateSchema>;
