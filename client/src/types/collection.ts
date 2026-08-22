/**
 * Domain types mirroring the API payloads.
 *
 * Named `VinylRecord` rather than `Record` on purpose — `Record` is a built-in
 * TypeScript utility type, and shadowing it makes every `Record<K, V>` in the
 * codebase resolve to the domain model instead.
 */
export interface VinylRecord {
  id: number;
  slug: string;
  title: string;
  artist: string;
  year: number;
  /** e.g. "LP", "2×LP" */
  format: string;
  /** e.g. "Jazz", "Ukrainian" */
  genre: string;
  /** External link used as the card's click target. */
  url?: string | null;
  /** Uploaded path (/uploads/…) or an external image URL. */
  coverUrl?: string | null;
  featured?: boolean;
  position?: number;
  /** ISO date string. */
  addedAt?: string;
  /** Server-derived: exactly one record carries the "New" badge. */
  isNew?: boolean;
}

export interface WishlistItem {
  id: number;
  title: string;
  artist: string;
  url?: string | null;
  /** Uploaded path (/uploads/…) or an external image URL. */
  coverUrl?: string | null;
  position?: number;
}

export interface CollectionStat {
  id: string;
  icon: StatIconName;
  value: string;
  label: string;
}

export type StatIconName = 'disc' | 'bars' | 'square' | 'sleeve';

export interface SetupItem {
  id: number;
  icon: SetupIconName;
  label: string;
  value: string;
  position?: number;
}

export type SetupIconName = 'turntable' | 'cartridge' | 'amplifier' | 'speakers' | 'cable';

/** Editable copy and imagery that the homepage cannot derive from records. */
export interface SiteSettings {
  collectingSince?: string;
  heroEyebrow?: string;
  /** Newlines are meaningful — the design breaks the headline by hand. */
  heroHeadline?: string;
  heroLede?: string;
  heroImageUrl?: string;
  setupEyebrow?: string;
  setupHeading?: string;
  setupImageUrl?: string;
}
