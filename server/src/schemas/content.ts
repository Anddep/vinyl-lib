import { z } from 'zod';
import { imageSource, safeUrl } from '../lib/url';

/**
 * Must stay in step with `setupIcons` in
 * client/src/components/ui/icons.tsx — an icon with no component renders
 * nothing, so the API refuses to store one.
 */
export const SETUP_ICONS = ['turntable', 'cartridge', 'amplifier', 'speakers', 'cable'] as const;

export const wishlistCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  artist: z.string().trim().min(1, 'Artist is required'),
  url: safeUrl.nullish(),
  coverUrl: imageSource.nullish(),
  position: z.number().int().min(0).optional(),
});
export const wishlistUpdateSchema = wishlistCreateSchema.partial();

export const setupCreateSchema = z.object({
  icon: z.enum(SETUP_ICONS, { error: 'Not an available icon' }),
  label: z.string().trim().min(1, 'Label is required'),
  value: z.string().trim().min(1, 'Value is required'),
  position: z.number().int().min(0).optional(),
});
export const setupUpdateSchema = setupCreateSchema.partial();

const text = (max: number) => z.string().trim().max(max);

/**
 * Strict, so an unknown key is a 400 rather than a silently ignored no-op — a
 * typo in a setting name should not look like a successful save.
 */
export const settingsSchema = z
  .strictObject({
    collectingSince: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Use a four-digit year'),
    heroEyebrow: text(120),
    // Newlines are meaningful here: the design breaks the headline across
    // three lines by hand rather than letting it wrap.
    heroHeadline: text(200),
    heroLede: text(500),
    heroImageUrl: imageSource,
    setupEyebrow: text(120),
    setupHeading: text(200),
    setupImageUrl: imageSource,
  })
  .partial();

/** Every key the settings screen edits, so client and server cannot drift. */
export const SETTING_KEYS = [
  'collectingSince',
  'heroEyebrow',
  'heroHeadline',
  'heroLede',
  'heroImageUrl',
  'setupEyebrow',
  'setupHeading',
  'setupImageUrl',
] as const;
