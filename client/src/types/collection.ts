/**
 * Domain types for the collection.
 *
 * Named `VinylRecord` rather than `Record` on purpose — `Record` is a built-in
 * TypeScript utility type, and shadowing it makes every `Record<K, V>` in the
 * codebase resolve to the domain model instead.
 */
export interface VinylRecord {
  id: string;
  slug: string;
  title: string;
  artist: string;
  year: number;
  /** e.g. "LP", "2×LP" */
  format: string;
  /** e.g. "Jazz", "Ukrainian" */
  genre: string;
  /** Collector's one-line note, shown on the featured cards. */
  note?: string;
  /** ISO date string. */
  addedAt?: string;
  /** Human-readable "Added 18 Aug" — precomputed for the compact cards. */
  addedLabel?: string;
  coverUrl?: string;
  isNew?: boolean;
}

export interface WishlistItem {
  id: string;
  title: string;
  artist: string;
  /** The pressing being hunted, e.g. "1971 original". */
  pressing: string;
}

export interface CollectionStat {
  id: string;
  icon: StatIconName;
  value: string;
  label: string;
}

export type StatIconName = 'disc' | 'bars' | 'square' | 'sleeve';

export interface SetupItem {
  id: string;
  icon: SetupIconName;
  label: string;
  value: string;
}

export type SetupIconName = 'turntable' | 'cartridge' | 'amplifier' | 'speakers' | 'cable';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}
