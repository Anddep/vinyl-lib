/**
 * Homepage content, transcribed from the design handoff.
 *
 * This is seed data so the page renders standalone. The handoff maps each block
 * to an endpoint that the server does not expose yet:
 *   featuredRecords -> GET /api/records?featured=true&limit=8
 *   recentRecords   -> GET /api/records?sort=addedAt&limit=6
 *   collectionStats -> GET /api/stats
 *   wishlist        -> GET /api/wishlist
 *   contact form    -> POST /api/contact
 * Swap these constants for fetched data once those routes land; the component
 * props are already shaped like the documented `VinylRecord` payload.
 */
import type {
  CollectionStat,
  FaqItem,
  SetupItem,
  VinylRecord,
  WishlistItem,
} from '../types/collection';

export const TOTAL_RECORDS = 324;

export const GENRE_FILTERS = [
  { label: 'All', value: 'All' },
  { label: 'Rock', value: 'Rock' },
  { label: 'Jazz', value: 'Jazz' },
  { label: 'Electronic', value: 'Electronic' },
  { label: 'Hip-Hop', value: 'Hip-Hop' },
  { label: 'Classical', value: 'Classical' },
  { label: 'Soundtracks', value: 'Soundtrack' },
  { label: 'Ukrainian', value: 'Ukrainian' },
] as const;

/** Chip label -> the first year of that decade. */
export const DECADE_FILTERS = [
  { label: '60s', value: 1960 },
  { label: '70s', value: 1970 },
  { label: '80s', value: 1980 },
  { label: '90s', value: 1990 },
  { label: '00s', value: 2000 },
  { label: '10s', value: 2010 },
  { label: '20s', value: 2020 },
] as const;

export const collectionStats: CollectionStat[] = [
  { id: 'total', icon: 'disc', value: '324', label: 'Total records' },
  { id: 'genre', icon: 'bars', value: 'Jazz', label: 'Top genre · 64 records' },
  { id: 'label', icon: 'square', value: 'Blue Note', label: 'Top label · 21 records' },
  { id: 'since', icon: 'sleeve', value: '2009', label: 'Collecting since' },
];

export const featuredRecords: VinylRecord[] = [
  {
    id: 'r1',
    slug: 'bitches-brew',
    title: 'Bitches Brew',
    artist: 'Miles Davis',
    year: 1970,
    format: '2×LP',
    genre: 'Jazz',
    note: 'First pressing, gatefold intact',
  },
  {
    id: 'r2',
    slug: 'selected-ambient-works-85-92',
    title: 'Selected Ambient Works 85–92',
    artist: 'Aphex Twin',
    year: 1992,
    format: '2×LP',
    genre: 'Electronic',
    note: 'The record that started the electronic shelf',
  },
  {
    id: 'r3',
    slug: 'chervona-ruta',
    title: 'Chervona Ruta',
    artist: 'Sofia Rotaru',
    year: 1971,
    format: 'LP',
    genre: 'Ukrainian',
    note: 'Found at a flea market in Chernivtsi',
  },
  {
    id: 'r4',
    slug: 'a-love-supreme',
    title: 'A Love Supreme',
    artist: 'John Coltrane',
    year: 1965,
    format: 'LP',
    genre: 'Jazz',
    note: 'Never lent out. Ever.',
  },
  {
    id: 'r5',
    slug: 'remain-in-light',
    title: 'Remain in Light',
    artist: 'Talking Heads',
    year: 1980,
    format: 'LP',
    genre: 'Rock',
    note: 'Second copy — the first wore out',
  },
  {
    id: 'r6',
    slug: 'blue-train',
    title: 'Blue Train',
    artist: 'John Coltrane',
    year: 1958,
    format: 'LP',
    genre: 'Jazz',
    note: 'Blue Note reissue, 180g',
  },
  {
    id: 'r7',
    slug: 'blade-runner-ost',
    title: 'Blade Runner OST',
    artist: 'Vangelis',
    year: 1994,
    format: 'LP',
    genre: 'Soundtrack',
    note: 'Best late-night side in the house',
  },
  {
    id: 'r8',
    slug: 'endtroducing',
    title: 'Endtroducing.....',
    artist: 'DJ Shadow',
    year: 1996,
    format: '2×LP',
    genre: 'Hip-Hop',
    note: 'A record made of records',
  },
];

export const RECENT_WINDOW_LABEL = 'Last 30 days · 11 records';

export const recentRecords: VinylRecord[] = [
  {
    id: 'n1',
    slug: 'mezzanine',
    title: 'Mezzanine',
    artist: 'Massive Attack',
    year: 1998,
    format: '2×LP',
    genre: 'Electronic',
    addedAt: '2026-08-18',
    addedLabel: 'Added 18 Aug',
    isNew: true,
  },
  {
    id: 'n2',
    slug: 'kind-of-blue',
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    year: 1959,
    format: 'LP',
    genre: 'Jazz',
    addedAt: '2026-08-14',
    addedLabel: 'Added 14 Aug',
  },
  {
    id: 'n3',
    slug: 'sensations-fix',
    title: "Sensations' Fix",
    artist: 'Franco Falsini',
    year: 1974,
    format: 'LP',
    genre: 'Electronic',
    addedAt: '2026-08-11',
    addedLabel: 'Added 11 Aug',
  },
  {
    id: 'n4',
    slug: 'vodyanyk',
    title: 'Vodyanyk',
    artist: 'Kobza',
    year: 1971,
    format: 'LP',
    genre: 'Ukrainian',
    addedAt: '2026-08-07',
    addedLabel: 'Added 07 Aug',
  },
  {
    id: 'n5',
    slug: 'music-for-airports',
    title: 'Music for Airports',
    artist: 'Brian Eno',
    year: 1978,
    format: 'LP',
    genre: 'Electronic',
    addedAt: '2026-08-03',
    addedLabel: 'Added 03 Aug',
  },
  {
    id: 'n6',
    slug: 'moon-safari',
    title: 'Moon Safari',
    artist: 'Air',
    year: 1998,
    format: 'LP',
    genre: 'Electronic',
    addedAt: '2026-07-29',
    addedLabel: 'Added 29 Jul',
  },
];

export const setupItems: SetupItem[] = [
  {
    id: 's1',
    icon: 'turntable',
    label: 'Turntable',
    value: 'Technics SL-1200 MK2 · 1984, serviced 2023',
  },
  { id: 's2', icon: 'cartridge', label: 'Cartridge', value: 'Ortofon 2M Blue' },
  { id: 's3', icon: 'amplifier', label: 'Amplifier', value: 'Yamaha A-S501 · integrated' },
  {
    id: 's4',
    icon: 'speakers',
    label: 'Speakers',
    value: 'Wharfedale Diamond 12.2 · on granite stands',
  },
  { id: 's5', icon: 'cable', label: 'Cables', value: 'Nothing exotic — decent copper, kept short' },
];

export const wishlist: WishlistItem[] = [
  { id: 'w1', title: 'Fly or Die', artist: 'jaimie branch', pressing: 'any pressing' },
  {
    id: 'w2',
    title: 'Journey in Satchidananda',
    artist: 'Alice Coltrane',
    pressing: '1971 original',
  },
  { id: 'w3', title: 'Karma', artist: 'Pharoah Sanders', pressing: 'Impulse! gatefold' },
  { id: 'w4', title: 'Chornobryvtsi', artist: 'Smerichka', pressing: 'Melodiya, any' },
  {
    id: 'w5',
    title: 'Artificial Intelligence',
    artist: 'Various · Warp',
    pressing: '1992 first press',
  },
  { id: 'w6', title: 'Solaris OST', artist: 'Eduard Artemyev', pressing: 'any reissue' },
];

export const faqItems: FaqItem[] = [
  {
    id: 'sell',
    question: 'Do you sell records?',
    answer:
      "Rarely, and only duplicates. This isn't a shop — but if a record here matters to you, write and we'll find a way.",
  },
  {
    id: 'trade',
    question: 'Do you trade?',
    answer:
      'Gladly. Anything from the wishlist gets my full attention, and I keep a shelf of trade-ready duplicates in the listening room.',
  },
  {
    id: 'care',
    question: 'Vinyl care tips?',
    answer:
      'Inner sleeves of paper are the enemy — swap them for anti-static. Store vertically, never stacked, away from radiators. A carbon brush before every side does more than any expensive gadget.',
  },
  {
    id: 'visit',
    question: 'Can I visit and listen?',
    answer:
      "Yes — the listening room fits three people comfortably. Write a week ahead and bring something I don't have.",
  },
];

export const CONTACT_CHANNELS =
  'or · hello@groovesanddust.ua · Telegram @andriy_lp · Discord andriy#1200';
