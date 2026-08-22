import { PrismaClient } from '@prisma/client';

/**
 * Sample collection used by the test suite.
 *
 * This is a fixture, not a database seed. It used to run as `prisma db seed`,
 * which called deleteMany() on the ordered lists — running it against a real
 * collection would silently wipe curated content. Content is managed through
 * the admin panel now, so nothing writes this outside tests.
 *
 * Older records are backdated so ordering by addedAt returns a predictable
 * six for the "recently added" assertions.
 */
const records = [
  {
    slug: 'bitches-brew',
    title: 'Bitches Brew',
    artist: 'Miles Davis',
    year: 1970,
    format: '2×LP',
    genre: 'Jazz',
    position: 0,
    addedAt: new Date('2026-05-02'),
  },
  {
    slug: 'selected-ambient-works-85-92',
    title: 'Selected Ambient Works 85–92',
    artist: 'Aphex Twin',
    year: 1992,
    format: '2×LP',
    genre: 'Electronic',
    position: 1,
    addedAt: new Date('2026-04-18'),
  },
  {
    slug: 'chervona-ruta',
    title: 'Chervona Ruta',
    artist: 'Sofia Rotaru',
    year: 1971,
    format: 'LP',
    genre: 'Ukrainian',
    position: 2,
    addedAt: new Date('2026-03-11'),
  },
  {
    slug: 'a-love-supreme',
    title: 'A Love Supreme',
    artist: 'John Coltrane',
    year: 1965,
    format: 'LP',
    genre: 'Jazz',
    position: 3,
    addedAt: new Date('2026-02-20'),
  },
  {
    slug: 'remain-in-light',
    title: 'Remain in Light',
    artist: 'Talking Heads',
    year: 1980,
    format: 'LP',
    genre: 'Rock',
    position: 4,
    addedAt: new Date('2026-01-09'),
  },
  {
    slug: 'blue-train',
    title: 'Blue Train',
    artist: 'John Coltrane',
    year: 1958,
    format: 'LP',
    genre: 'Jazz',
    position: 5,
    addedAt: new Date('2025-12-14'),
  },
  {
    slug: 'blade-runner-ost',
    title: 'Blade Runner OST',
    artist: 'Vangelis',
    year: 1994,
    format: 'LP',
    genre: 'Soundtrack',
    position: 6,
    addedAt: new Date('2025-11-30'),
  },
  {
    slug: 'endtroducing',
    title: 'Endtroducing.....',
    artist: 'DJ Shadow',
    year: 1996,
    format: '2×LP',
    genre: 'Hip-Hop',
    position: 7,
    addedAt: new Date('2025-10-22'),
  },
  {
    slug: 'mezzanine',
    title: 'Mezzanine',
    artist: 'Massive Attack',
    year: 1998,
    format: '2×LP',
    genre: 'Electronic',
    position: 0,
    addedAt: new Date('2026-08-18'),
  },
  {
    slug: 'kind-of-blue',
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    year: 1959,
    format: 'LP',
    genre: 'Jazz',
    position: 0,
    addedAt: new Date('2026-08-14'),
  },
  {
    slug: 'sensations-fix',
    title: "Sensations' Fix",
    artist: 'Franco Falsini',
    year: 1974,
    format: 'LP',
    genre: 'Electronic',
    position: 0,
    addedAt: new Date('2026-08-11'),
  },
  {
    slug: 'vodyanyk',
    title: 'Vodyanyk',
    artist: 'Kobza',
    year: 1971,
    format: 'LP',
    genre: 'Ukrainian',
    position: 0,
    addedAt: new Date('2026-08-07'),
  },
  {
    slug: 'music-for-airports',
    title: 'Music for Airports',
    artist: 'Brian Eno',
    year: 1978,
    format: 'LP',
    genre: 'Electronic',
    position: 0,
    addedAt: new Date('2026-08-03'),
  },
  {
    slug: 'moon-safari',
    title: 'Moon Safari',
    artist: 'Air',
    year: 1998,
    format: 'LP',
    genre: 'Electronic',
    position: 0,
    addedAt: new Date('2026-07-29'),
  },
];

const wishlist = [
  { title: 'Fly or Die', artist: 'jaimie branch', position: 0 },
  {
    title: 'Journey in Satchidananda',
    artist: 'Alice Coltrane',
    position: 1,
  },
  { title: 'Karma', artist: 'Pharoah Sanders', position: 2 },
  { title: 'Chornobryvtsi', artist: 'Smerichka', position: 3 },
  {
    title: 'Artificial Intelligence',
    artist: 'Various · Warp',
    position: 4,
  },
  { title: 'Solaris OST', artist: 'Eduard Artemyev', position: 5 },
];

const setup = [
  {
    icon: 'turntable',
    label: 'Turntable',
    value: 'Technics SL-1200 MK2 · 1984, serviced 2023',
    position: 0,
  },
  { icon: 'cartridge', label: 'Cartridge', value: 'Ortofon 2M Blue', position: 1 },
  { icon: 'amplifier', label: 'Amplifier', value: 'Yamaha A-S501 · integrated', position: 2 },
  {
    icon: 'speakers',
    label: 'Speakers',
    value: 'Wharfedale Diamond 12.2 · on granite stands',
    position: 3,
  },
  {
    icon: 'cable',
    label: 'Cables',
    value: 'Nothing exotic — decent copper, kept short',
    position: 4,
  },
];

export async function loadFixture(client: PrismaClient): Promise<void> {
  // Records upsert on slug so a rerun updates rather than duplicating.
  for (const record of records) {
    await client.record.upsert({
      where: { slug: record.slug },
      create: record,
      update: record,
    });
  }

  // Ordered lists are short and position-keyed, so replacing them wholesale is
  // simpler than reconciling and cannot leave a stale row behind.
  await client.wishlistItem.deleteMany();
  await client.wishlistItem.createMany({ data: wishlist });

  await client.setupItem.deleteMany();
  await client.setupItem.createMany({ data: setup });

  await client.siteSetting.upsert({
    where: { key: 'collectingSince' },
    create: { key: 'collectingSince', value: '2009' },
    update: {},
  });
}
