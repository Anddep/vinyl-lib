import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from '../../src/lib/slug';

describe('slugify', () => {
  it.each([
    ['Bitches Brew', 'bitches-brew'],
    ['Selected Ambient Works 85–92', 'selected-ambient-works-85-92'],
    ['Endtroducing.....', 'endtroducing'],
    ["Sensations' Fix", 'sensations-fix'],
    ['A Love Supreme', 'a-love-supreme'],
    ['Café Bleu', 'cafe-bleu'],
    ['  Padded  Title  ', 'padded-title'],
    ['Blade Runner OST', 'blade-runner-ost'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('falls back when a title has no slug-able characters', () => {
    // Cyrillic strips to nothing under an ASCII slug; better a stable
    // fallback than an empty string hitting a NOT NULL unique column.
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('Червона')).toBe('untitled');
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', async () => {
    expect(await uniqueSlug('blue-train', async () => false)).toBe('blue-train');
  });

  it('suffixes until it finds a gap', async () => {
    const taken = new Set(['blue-train', 'blue-train-2']);
    expect(await uniqueSlug('blue-train', async (s) => taken.has(s))).toBe('blue-train-3');
  });
});
