# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the collector a password-protected admin panel to create, edit, delete and reorder every piece of authored homepage content, with an external URL and cover image per record.

**Architecture:** Prisma models back four content resources plus a key/value settings table. Express exposes public read routes and session-guarded write routes, validated with zod. The existing React app gains a router; `/admin/*` is a lazy-loaded, auth-guarded tree reusing the site's own design system. The homepage stops importing a static module and fetches instead.

**Tech Stack:** TypeScript, React 18, Vite, Express 4, Prisma 5, PostgreSQL 16, zod, express-session + connect-pg-simple, bcryptjs, multer, Vitest, Supertest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-21-admin-panel-design.md`

## Global Constraints

- Node 20. npm workspaces (`client`, `server`). Do not add a third workspace.
- All new server code is CommonJS (`server/tsconfig.json` sets `"module": "CommonJS"`).
- Prettier config is authoritative: single quotes, semicolons, trailing commas, 100 print width, LF.
- ESLint must pass with zero warnings; `@typescript-eslint/no-unused-vars` allows a leading `_`.
- Styling is CSS Modules only. No inline styles, no new UI framework. All colour, spacing, radius and motion values come from `client/src/styles/tokens.css` — never hardcode a hex.
- Every write endpoint requires an authenticated session. There are no public writes.
- URL fields accept `http:` and `https:` only.
- Uploads: 5 MB cap; `image/jpeg`, `image/png`, `image/webp`, `image/avif` only; type determined by magic bytes, never by filename or client-sent mimetype.
- Commit messages: Conventional Commits, subject and body only. **No `Co-Authored-By` trailer.**
- Test-first. Every task writes a failing test before implementation.

### Deviation from the spec

The spec names `bcrypt`. Use **`bcryptjs`** instead: `bcrypt` is a native addon requiring `node-gyp` and `build-base` in the Alpine images, and hashing speed is irrelevant for one login. Same API surface for our usage.

---

## File Structure

```
server/src/
  app.ts                    NEW  builds and exports the Express app (no listen)
  index.ts                  MOD  imports app, calls listen
  config/env.ts             MOD  ADMIN_PASSWORD_HASH, SESSION_SECRET
  middleware/requireAuth.ts NEW  session guard
  middleware/validate.ts    NEW  zod body parser -> 400 { error, fields }
  lib/slug.ts               NEW  slugify + collision suffixing
  lib/imageType.ts          NEW  magic-byte sniffing
  lib/url.ts                NEW  http/https protocol allowlist
  schemas/                  NEW  one zod schema module per resource
  routes/auth.ts            NEW  login, logout, me
  routes/records.ts         NEW  read + CRUD
  routes/wishlist.ts        NEW
  routes/setup.ts           NEW
  routes/faq.ts             NEW
  routes/stats.ts           NEW  computed
  routes/settings.ts        NEW
  routes/uploads.ts         NEW
server/prisma/seed.ts       NEW  handoff content
server/scripts/hashPassword.ts NEW
server/tests/                  NEW

client/src/
  main.tsx                  MOD  RouterProvider
  routes.tsx                NEW  route tree, lazy admin
  api/client.ts             MOD  typed fetchers
  hooks/useResource.ts      NEW  fetch + loading/error state
  pages/HomePage.tsx        MOD  fetches
  sections/*.tsx            MOD  take data as props
  admin/                    NEW  layout, login, guard, screens
  admin/components/         NEW  DataTable, ConfirmDialog, ImageField
```

---

## Phase 1 — Foundation

### Task 1: Test infrastructure

**Files:**

- Create: `server/vitest.config.ts`, `server/tests/setup.ts`, `server/tests/helpers/db.ts`, `client/vitest.config.ts`, `client/tests/setup.ts`
- Modify: `server/package.json`, `client/package.json`, `package.json`, `.github/workflows/ci.yml`, `.env.example`
- Create: `server/src/app.ts`; Modify: `server/src/index.ts`
- Test: `server/tests/health.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `server/src/app.ts` exporting `export const app: Express` — every later server test imports this and wraps it in `supertest(app)`. `server/tests/helpers/db.ts` exporting `resetDb(): Promise<void>` and `prisma` (a client bound to the test database).

- [ ] **Step 1: Split the app from the listener**

`server/src/index.ts` currently builds the app and calls `listen` in one file, so Supertest cannot import it without opening a port. Create `server/src/app.ts` holding everything except `listen`:

```ts
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { healthRouter } from './routes/health';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use('/api', healthRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
```

Replace `server/src/index.ts` entirely with:

```ts
import { app } from './app';
import { env } from './config/env';

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});
```

The `morgan` guard matters: without it every test run prints a request log line per assertion.

- [ ] **Step 2: Install test dependencies**

```bash
npm install -D -w server vitest supertest @types/supertest
npm install -D -w client vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 3: Configure Vitest on the server**

Create `server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Route tests share one Postgres database; parallel files would race on
    // truncation between tests.
    fileParallelism: false,
  },
});
```

Create `server/tests/setup.ts`:

```ts
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret';
// bcryptjs hash of "test-password", cost 12.
process.env.ADMIN_PASSWORD_HASH = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyUFVvMHqPGYCu';
```

The `DATABASE_URL` for tests comes from the environment (Step 5), not from this file, so the same setup works locally and in CI.

- [ ] **Step 4: Add the database test helper**

Create `server/tests/helpers/db.ts`:

```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * Truncate every content table between tests. RESTART IDENTITY keeps
 * autoincrement ids predictable so assertions on `id` stay stable.
 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Record", "WishlistItem", "SetupItem", "FaqItem", "SiteSetting" RESTART IDENTITY CASCADE',
  );
}
```

This references tables created in Task 2. Until then only `Record` exists, so run this task's test before adding the truncate list, or land Task 2 first and come back. Simplest order: complete Steps 1-3 and 5-9 now, add `helpers/db.ts` at the start of Task 2.

- [ ] **Step 5: Point tests at a separate database**

Add to `.env.example` (and your own `.env`):

```
# --- Test database (used by `npm test -w server`) ---
# Same Postgres instance, separate database, so tests never truncate dev data.
DATABASE_URL_TEST=postgresql://vinyl_lib:vinyl_lib_dev_password@localhost:5432/vinyl_lib_test?schema=public
```

Add scripts to `server/package.json`:

```json
"test": "dotenv -e ../.env -v DATABASE_URL=$DATABASE_URL_TEST -- vitest run",
"test:watch": "vitest",
"test:db:setup": "dotenv -e ../.env -v DATABASE_URL=$DATABASE_URL_TEST -- prisma migrate deploy"
```

`dotenv-cli` shells out awkwardly across platforms. Prefer a tiny wrapper instead — create `server/tests/globalSetup.ts`:

```ts
export default function globalSetup(): void {
  if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST is not set — see .env.example');
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
```

Register it in `server/vitest.config.ts` as `globalSetup: ['./tests/globalSetup.ts']`, and simplify the scripts to:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Configure Vitest on the client**

Create `client/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: true, // CSS Modules must resolve, or every component import throws
  },
});
```

Create `client/tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Add `"test": "vitest run"` and `"test:watch": "vitest"` to `client/package.json`.

- [ ] **Step 7: Add the root test script**

In root `package.json` scripts:

```json
"test": "npm run test -w client && npm run test -w server"
```

- [ ] **Step 8: Write the first test**

Create `server/tests/health.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

describe('GET /api/health', () => {
  it('reports ok when the database is reachable', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', db: 'connected' });
  });

  it('404s an unknown route with the method and path', async () => {
    const response = await request(app).get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Not found: GET /api/nope');
  });
});
```

- [ ] **Step 9: Run the tests**

```bash
createdb vinyl_lib_test  # or: docker compose exec db createdb -U vinyl_lib vinyl_lib_test
npm run test:db:setup -w server
npm test -w server
```

Expected: both tests PASS. If `health` fails on the database, the test database has not been migrated — rerun `test:db:setup`.

- [ ] **Step 10: Add the CI test step**

In `.github/workflows/ci.yml`, add a service and a step. Insert after `runs-on: ubuntu-latest`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_USER: vinyl_lib
      POSTGRES_PASSWORD: vinyl_lib_dev_password
      POSTGRES_DB: vinyl_lib_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 5s
      --health-timeout 5s
      --health-retries 10
```

And between the Lint and Build steps:

```yaml
- name: Migrate test database
  run: npm run test:db:setup -w server
  env:
    DATABASE_URL_TEST: postgresql://vinyl_lib:vinyl_lib_dev_password@localhost:5432/vinyl_lib_test?schema=public

- name: Test
  run: npm test
  env:
    DATABASE_URL_TEST: postgresql://vinyl_lib:vinyl_lib_dev_password@localhost:5432/vinyl_lib_test?schema=public
```

- [ ] **Step 11: Commit**

```bash
git add server client package.json .github .env.example
git commit -m "test: add Vitest, Supertest and RTL infrastructure

Splits the Express app from the listener so Supertest can import it
without binding a port, and adds a CI job step backed by a Postgres
service container. Server tests run against a separate database so they
never truncate development data."
```

---

### Task 2: Schema and migration

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_admin_content/migration.sql` (generated)
- Create: `server/tests/helpers/db.ts` (deferred from Task 1 Step 4)
- Test: `server/tests/schema.test.ts`

**Interfaces:**

- Consumes: `prisma` from `tests/helpers/db.ts`.
- Produces: Prisma models `Record`, `WishlistItem`, `SetupItem`, `FaqItem`, `SiteSetting` with the exact field names used by every later task. Generated types `Record`, `WishlistItem`, `SetupItem`, `FaqItem`, `SiteSetting` importable from `@prisma/client`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb } from './helpers/db';

beforeEach(resetDb);

describe('Record model', () => {
  it('stores the full field set and defaults featured to false', async () => {
    const record = await prisma.record.create({
      data: {
        slug: 'bitches-brew',
        title: 'Bitches Brew',
        artist: 'Miles Davis',
        year: 1970,
        format: '2×LP',
        genre: 'Jazz',
        label: 'Columbia',
        note: 'First pressing, gatefold intact',
        url: 'https://www.discogs.com/release/1481',
        addedAt: new Date('2026-08-18T00:00:00Z'),
      },
    });

    expect(record.featured).toBe(false);
    expect(record.position).toBe(0);
    expect(record.coverUrl).toBeNull();
    expect(record.label).toBe('Columbia');
  });

  it('rejects a duplicate slug', async () => {
    const base = {
      title: 'Blue Train',
      artist: 'John Coltrane',
      year: 1958,
      format: 'LP',
      genre: 'Jazz',
    };
    await prisma.record.create({ data: { ...base, slug: 'blue-train' } });

    await expect(prisma.record.create({ data: { ...base, slug: 'blue-train' } })).rejects.toThrow();
  });
});

describe('SiteSetting model', () => {
  it('is keyed by string', async () => {
    await prisma.siteSetting.create({ data: { key: 'collectingSince', value: '2009' } });
    const setting = await prisma.siteSetting.findUnique({ where: { key: 'collectingSince' } });

    expect(setting?.value).toBe('2009');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- schema
```

Expected: FAIL — `prisma.siteSetting` is undefined and `Record` has no `slug`.

- [ ] **Step 3: Replace the schema**

Replace the `model Record` block in `server/prisma/schema.prisma` and append the rest:

```prisma
model Record {
  id        Int      @id @default(autoincrement())
  slug      String   @unique
  title     String
  artist    String
  year      Int
  format    String
  genre     String
  label     String?
  note      String?
  url       String?
  coverUrl  String?
  featured  Boolean  @default(false)
  position  Int      @default(0)
  addedAt   DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([addedAt])
  @@index([featured, position])
}

model WishlistItem {
  id        Int      @id @default(autoincrement())
  title     String
  artist    String
  pressing  String
  url       String?
  position  Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model SetupItem {
  id        Int      @id @default(autoincrement())
  icon      String
  label     String
  value     String
  position  Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model FaqItem {
  id            Int      @id @default(autoincrement())
  question      String
  answer        String
  position      Int      @default(0)
  openByDefault Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model SiteSetting {
  key   String @id
  value String
}
```

- [ ] **Step 4: Create the helper deferred from Task 1**

Create `server/tests/helpers/db.ts` with the content given in Task 1 Step 4.

- [ ] **Step 5: Generate the migration**

```bash
cd server && npx prisma migrate dev --name admin_content
```

The existing `Record` table has no rows and no readers, so accept the destructive change when prompted.

- [ ] **Step 6: Migrate the test database and run tests**

```bash
npm run test:db:setup -w server
npm test -w server -- schema
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/prisma server/tests
git commit -m "feat: model records, wishlist, setup, FAQ and settings

Replaces the four-field Record stub with the full field set the homepage
renders, plus label (feeds the top-label stat) and url (the card click
target). Adds the three content models and a key/value settings table.

year becomes required: the card spec line renders '1970 · 2×LP · JAZZ',
and a null prints 'null' into that string."
```

---

### Task 3: Seed script

**Files:**

- Create: `server/prisma/seed.ts`
- Modify: `server/package.json`
- Test: `server/tests/seed.test.ts`

**Interfaces:**

- Consumes: Prisma models from Task 2.
- Produces: `export async function seed(client: PrismaClient): Promise<void>` — Task 5's stats tests import this to populate a known fixture.

- [ ] **Step 1: Write the failing test**

Create `server/tests/seed.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { prisma, resetDb } from './helpers/db';

beforeEach(resetDb);

describe('seed', () => {
  it('loads the handoff content', async () => {
    await seed(prisma);

    expect(await prisma.record.count()).toBe(14);
    expect(await prisma.record.count({ where: { featured: true } })).toBe(8);
    expect(await prisma.wishlistItem.count()).toBe(6);
    expect(await prisma.setupItem.count()).toBe(5);
    expect(await prisma.faqItem.count()).toBe(4);

    const setting = await prisma.siteSetting.findUnique({ where: { key: 'collectingSince' } });
    expect(setting?.value).toBe('2009');
  });

  it('opens exactly the first FAQ item by default', async () => {
    await seed(prisma);
    const open = await prisma.faqItem.findMany({ where: { openByDefault: true } });

    expect(open).toHaveLength(1);
    expect(open[0].question).toBe('Do you sell records?');
  });

  it('is idempotent', async () => {
    await seed(prisma);
    await seed(prisma);

    expect(await prisma.record.count()).toBe(14);
  });
});
```

**Note the count: 14, not 20.** The handoff lists 8 featured and 6 recent, and the two sets are disjoint albums, so the table holds 14 rows. `Kind of Blue` appears only in the recent list.

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- seed
```

Expected: FAIL — cannot resolve `../prisma/seed`.

- [ ] **Step 3: Write the seed**

Create `server/prisma/seed.ts`. Transcribe the content from `client/src/data/collection.ts`, adding `label`, `featured` and `position`. Use `upsert` keyed on `slug` for records so reruns are idempotent, and `deleteMany` + `createMany` for the three ordered lists.

```ts
import { PrismaClient } from '@prisma/client';

const records = [
  {
    slug: 'bitches-brew',
    title: 'Bitches Brew',
    artist: 'Miles Davis',
    year: 1970,
    format: '2×LP',
    genre: 'Jazz',
    label: 'Columbia',
    note: 'First pressing, gatefold intact',
    featured: true,
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
    label: 'Apollo',
    note: 'The record that started the electronic shelf',
    featured: true,
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
    label: 'Melodiya',
    note: 'Found at a flea market in Chernivtsi',
    featured: true,
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
    label: 'Impulse!',
    note: 'Never lent out. Ever.',
    featured: true,
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
    label: 'Sire',
    note: 'Second copy — the first wore out',
    featured: true,
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
    label: 'Blue Note',
    note: 'Blue Note reissue, 180g',
    featured: true,
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
    label: 'EastWest',
    note: 'Best late-night side in the house',
    featured: true,
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
    label: "Mo' Wax",
    note: 'A record made of records',
    featured: true,
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
    label: 'Circa',
    featured: false,
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
    label: 'Columbia',
    featured: false,
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
    label: 'Polydor',
    featured: false,
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
    label: 'Melodiya',
    featured: false,
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
    label: 'Polydor',
    featured: false,
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
    label: 'Source',
    featured: false,
    position: 0,
    addedAt: new Date('2026-07-29'),
  },
];

const wishlist = [
  { title: 'Fly or Die', artist: 'jaimie branch', pressing: 'any pressing', position: 0 },
  {
    title: 'Journey in Satchidananda',
    artist: 'Alice Coltrane',
    pressing: '1971 original',
    position: 1,
  },
  { title: 'Karma', artist: 'Pharoah Sanders', pressing: 'Impulse! gatefold', position: 2 },
  { title: 'Chornobryvtsi', artist: 'Smerichka', pressing: 'Melodiya, any', position: 3 },
  {
    title: 'Artificial Intelligence',
    artist: 'Various · Warp',
    pressing: '1992 first press',
    position: 4,
  },
  { title: 'Solaris OST', artist: 'Eduard Artemyev', pressing: 'any reissue', position: 5 },
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

const faq = [
  {
    question: 'Do you sell records?',
    answer:
      "Rarely, and only duplicates. This isn't a shop — but if a record here matters to you, write and we'll find a way.",
    position: 0,
    openByDefault: true,
  },
  {
    question: 'Do you trade?',
    answer:
      'Gladly. Anything from the wishlist gets my full attention, and I keep a shelf of trade-ready duplicates in the listening room.',
    position: 1,
    openByDefault: false,
  },
  {
    question: 'Vinyl care tips?',
    answer:
      'Inner sleeves of paper are the enemy — swap them for anti-static. Store vertically, never stacked, away from radiators. A carbon brush before every side does more than any expensive gadget.',
    position: 2,
    openByDefault: false,
  },
  {
    question: 'Can I visit and listen?',
    answer:
      "Yes — the listening room fits three people comfortably. Write a week ahead and bring something I don't have.",
    position: 3,
    openByDefault: false,
  },
];

export async function seed(client: PrismaClient): Promise<void> {
  for (const record of records) {
    await client.record.upsert({
      where: { slug: record.slug },
      create: record,
      update: record,
    });
  }

  await client.wishlistItem.deleteMany();
  await client.wishlistItem.createMany({ data: wishlist });

  await client.setupItem.deleteMany();
  await client.setupItem.createMany({ data: setup });

  await client.faqItem.deleteMany();
  await client.faqItem.createMany({ data: faq });

  await client.siteSetting.upsert({
    where: { key: 'collectingSince' },
    create: { key: 'collectingSince', value: '2009' },
    update: {},
  });
}

if (require.main === module) {
  const client = new PrismaClient();
  seed(client)
    .then(() => console.log('Seeded.'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => client.$disconnect());
}
```

Labels are real for these releases; the `addedAt` dates for featured records are backdated so the "recently added" query returns the six intended albums.

- [ ] **Step 4: Register the seed command**

In `server/package.json`, add alongside `"prisma"`:

```json
"prisma": {
  "schema": "prisma/schema.prisma",
  "seed": "ts-node --transpile-only prisma/seed.ts"
}
```

and a script: `"prisma:seed": "prisma db seed"`. Install `ts-node` if it is not already a direct dependency: `npm install -D -w server ts-node`.

- [ ] **Step 5: Run the tests**

```bash
npm test -w server -- seed
```

Expected: PASS, all three.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat: seed the handoff content

Loads the 8 featured records, 6 recent additions, 6 wishlist items, 5
setup rows and 4 FAQ entries transcribed from the design handoff, plus
collectingSince. Idempotent: records upsert on slug, ordered lists are
replaced wholesale."
```

---

## Phase 2 — Public read API and homepage migration

### Task 4: Record read endpoints

**Files:**

- Create: `server/src/routes/records.ts`, `server/src/lib/query.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/routes/records.read.test.ts`

**Interfaces:**

- Consumes: Prisma models (Task 2), `seed` (Task 3).
- Produces: `recordsRouter` mounted at `/api`. `parseLimit(raw: unknown, fallback: number): number` from `lib/query.ts`, reused by Task 6.

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/records.read.test.ts`:

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { seed } from '../../prisma/seed';
import { prisma, resetDb } from '../helpers/db';

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
});

describe('GET /api/records', () => {
  it('returns featured records in position order', async () => {
    const response = await request(app).get('/api/records?featured=true&limit=8');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(8);
    expect(response.body[0].title).toBe('Bitches Brew');
    expect(response.body[7].title).toBe('Endtroducing.....');
  });

  it('returns the most recently added first when sorted by addedAt', async () => {
    const response = await request(app).get('/api/records?sort=addedAt&limit=6');

    expect(response.body).toHaveLength(6);
    expect(response.body[0].title).toBe('Mezzanine');
    expect(response.body[5].title).toBe('Moon Safari');
  });

  it('flags only the newest record as new', async () => {
    const response = await request(app).get('/api/records?sort=addedAt&limit=6');

    expect(response.body[0].isNew).toBe(true);
    expect(response.body.slice(1).every((r: { isNew: boolean }) => r.isNew === false)).toBe(true);
  });

  it('clamps limit to 100 so a crafted query cannot dump the table', async () => {
    const response = await request(app).get('/api/records?limit=100000');

    expect(response.status).toBe(200);
    expect(response.body.length).toBeLessThanOrEqual(100);
  });

  it('ignores a non-numeric limit and falls back to the default', async () => {
    const response = await request(app).get('/api/records?limit=abc');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(14);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- records.read
```

Expected: FAIL — 404, the route is not mounted.

- [ ] **Step 3: Write the limit parser**

Create `server/src/lib/query.ts`:

```ts
const MAX_LIMIT = 100;

/**
 * Clamp a client-supplied limit into [1, 100]. Anything unparseable falls
 * back rather than erroring — a bad query string should not 500 a public page.
 */
export function parseLimit(raw: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, MAX_LIMIT);
}
```

- [ ] **Step 4: Write the route**

Create `server/src/routes/records.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { parseLimit } from '../lib/query';

export const recordsRouter = Router();

const DEFAULT_LIMIT = 100;

recordsRouter.get('/records', async (req: Request, res: Response) => {
  const limit = parseLimit(req.query.limit, DEFAULT_LIMIT);
  const featuredOnly = req.query.featured === 'true';
  const byAddedAt = req.query.sort === 'addedAt';

  const records = await prisma.record.findMany({
    where: featuredOnly ? { featured: true } : undefined,
    orderBy: byAddedAt ? [{ addedAt: 'desc' }] : [{ position: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  // The "New" badge is derived, never stored: exactly one record carries it,
  // the most recently added in the whole table.
  const newest = await prisma.record.findFirst({ orderBy: { addedAt: 'desc' } });

  res.json(records.map((record) => ({ ...record, isNew: record.id === newest?.id })));
});
```

- [ ] **Step 5: Mount it**

In `server/src/app.ts`, add the import and mount above the 404 handler:

```ts
import { recordsRouter } from './routes/records';
// ...
app.use('/api', recordsRouter);
```

- [ ] **Step 6: Run the tests**

```bash
npm test -w server -- records.read
```

Expected: all five PASS.

- [ ] **Step 7: Commit**

```bash
git add server
git commit -m "feat: serve records with featured and recency queries

limit is clamped to 100 server-side and a bad value falls back rather than
erroring, so a crafted query cannot dump the table or 500 a public page.
The New badge is derived per request from the newest addedAt rather than
stored on the row."
```

---

### Task 5: Computed stats endpoint

**Files:**

- Create: `server/src/routes/stats.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/routes/stats.test.ts`

**Interfaces:**

- Consumes: Prisma models, `seed`.
- Produces: `statsRouter`; response shape `{ totalRecords: number, topGenre: { name: string, count: number } | null, topLabel: { name: string, count: number } | null, collectingSince: string | null, addedLast30Days: number }`. Task 7 consumes this exact shape.

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/stats.test.ts`:

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { seed } from '../../prisma/seed';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('GET /api/stats', () => {
  it('computes counts from the records table', async () => {
    await seed(prisma);
    const response = await request(app).get('/api/stats');

    expect(response.status).toBe(200);
    expect(response.body.totalRecords).toBe(14);
    // Jazz: Bitches Brew, A Love Supreme, Blue Train, Kind of Blue.
    expect(response.body.topGenre).toEqual({ name: 'Jazz', count: 4 });
  });

  it('reads collectingSince from settings rather than deriving it', async () => {
    await seed(prisma);
    const response = await request(app).get('/api/stats');

    // Every seeded addedAt is 2025 or later; a derived MIN would never be 2009.
    expect(response.body.collectingSince).toBe('2009');
  });

  it('ignores records with no label when picking the top label', async () => {
    await prisma.record.createMany({
      data: [
        { slug: 'a', title: 'A', artist: 'X', year: 1990, format: 'LP', genre: 'Rock' },
        { slug: 'b', title: 'B', artist: 'X', year: 1991, format: 'LP', genre: 'Rock' },
        {
          slug: 'c',
          title: 'C',
          artist: 'X',
          year: 1992,
          format: 'LP',
          genre: 'Rock',
          label: 'Blue Note',
        },
      ],
    });

    const response = await request(app).get('/api/stats');

    expect(response.body.topLabel).toEqual({ name: 'Blue Note', count: 1 });
  });

  it('returns nulls rather than crashing on an empty collection', async () => {
    const response = await request(app).get('/api/stats');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalRecords: 0,
      topGenre: null,
      topLabel: null,
      collectingSince: null,
      addedLast30Days: 0,
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- stats
```

Expected: FAIL — 404.

- [ ] **Step 3: Write the route**

Create `server/src/routes/stats.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';

export const statsRouter = Router();

interface TopValue {
  name: string;
  count: number;
}

async function topBy(field: 'genre' | 'label'): Promise<TopValue | null> {
  const grouped = await prisma.record.groupBy({
    by: [field],
    where: { [field]: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { [field]: 'desc' } },
    take: 1,
  });

  const top = grouped[0];
  if (!top) {
    return null;
  }

  const name = top[field];
  return name ? { name, count: top._count._all } : null;
}

statsRouter.get('/stats', async (_req: Request, res: Response) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalRecords, topGenre, topLabel, collectingSince, addedLast30Days] = await Promise.all([
    prisma.record.count(),
    topBy('genre'),
    topBy('label'),
    prisma.siteSetting.findUnique({ where: { key: 'collectingSince' } }),
    prisma.record.count({ where: { addedAt: { gte: thirtyDaysAgo } } }),
  ]);

  res.json({
    totalRecords,
    topGenre,
    topLabel,
    collectingSince: collectingSince?.value ?? null,
    addedLast30Days,
  });
});
```

- [ ] **Step 4: Mount it**

Add to `server/src/app.ts` above the 404 handler: `app.use('/api', statsRouter);`

- [ ] **Step 5: Run the tests**

```bash
npm test -w server -- stats
```

Expected: all four PASS.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat: compute homepage stats from the records table

Total, top genre and top label are grouped per request so they cannot
drift from the data. Collecting since is read from settings instead:
MIN(addedAt) is when a row was entered, not when the collection started,
and would render 2026 against seeded data.

Returns nulls on an empty collection rather than crashing."
```

---

### Task 6: Wishlist, setup and FAQ read endpoints

**Files:**

- Create: `server/src/routes/wishlist.ts`, `server/src/routes/setup.ts`, `server/src/routes/faq.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/routes/content.read.test.ts`

**Interfaces:**

- Consumes: Prisma models, `seed`.
- Produces: `wishlistRouter`, `setupRouter`, `faqRouter`, each serving `GET /api/<resource>` ordered by `position ASC, id ASC`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/content.read.test.ts`:

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { seed } from '../../prisma/seed';
import { prisma, resetDb } from '../helpers/db';

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
});

describe.each([
  ['/api/wishlist', 6, 'Fly or Die', 'title'],
  ['/api/setup', 5, 'Turntable', 'label'],
  ['/api/faq', 4, 'Do you sell records?', 'question'],
])('GET %s', (path, expectedLength, firstValue, field) => {
  it('returns every item in position order', async () => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(expectedLength);
    expect(response.body[0][field]).toBe(firstValue);
  });
});

describe('position ordering', () => {
  it('falls back to id when positions tie', async () => {
    await prisma.wishlistItem.deleteMany();
    await prisma.wishlistItem.createMany({
      data: [
        { title: 'First', artist: 'A', pressing: 'any', position: 0 },
        { title: 'Second', artist: 'B', pressing: 'any', position: 0 },
      ],
    });

    const response = await request(app).get('/api/wishlist');

    expect(response.body.map((i: { title: string }) => i.title)).toEqual(['First', 'Second']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- content.read
```

Expected: FAIL — 404 on all three.

- [ ] **Step 3: Write the three routes**

Each follows the same shape. `server/src/routes/wishlist.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';

export const wishlistRouter = Router();

wishlistRouter.get('/wishlist', async (_req: Request, res: Response) => {
  const items = await prisma.wishlistItem.findMany({
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  res.json(items);
});
```

`server/src/routes/setup.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';

export const setupRouter = Router();

setupRouter.get('/setup', async (_req: Request, res: Response) => {
  const items = await prisma.setupItem.findMany({
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  res.json(items);
});
```

`server/src/routes/faq.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';

export const faqRouter = Router();

faqRouter.get('/faq', async (_req: Request, res: Response) => {
  const items = await prisma.faqItem.findMany({
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  res.json(items);
});
```

- [ ] **Step 4: Mount all three**

In `server/src/app.ts`, above the 404 handler:

```ts
app.use('/api', wishlistRouter);
app.use('/api', setupRouter);
app.use('/api', faqRouter);
```

- [ ] **Step 5: Run the tests**

```bash
npm test -w server -- content.read
```

Expected: all four PASS.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat: serve wishlist, setup and FAQ content

All three order by position then id, so items with an equal position fall
back to insertion order rather than an arbitrary one."
```

---

### Task 7: Homepage reads from the API

**Files:**

- Create: `client/src/hooks/useResource.ts`, `client/src/types/api.ts`
- Modify: `client/src/api/client.ts`, `client/src/pages/HomePage.tsx`, all seven files in `client/src/sections/`, `client/src/components/AlbumCard.tsx`
- Delete: `client/src/data/collection.ts`
- Test: `client/tests/AlbumCard.test.tsx`, `client/tests/useResource.test.tsx`

**Interfaces:**

- Consumes: every public endpoint from Tasks 4-6.
- Produces: `useResource<T>(fetcher: () => Promise<T>): { data: T | null; error: string | null; loading: boolean }`. Sections take their data as props; `HomePage` owns the fetching.

- [ ] **Step 1: Write the failing AlbumCard test**

Create `client/tests/AlbumCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlbumCard } from '../src/components/AlbumCard';
import type { VinylRecord } from '../src/types/collection';

const record: VinylRecord = {
  id: '1',
  slug: 'bitches-brew',
  title: 'Bitches Brew',
  artist: 'Miles Davis',
  year: 1970,
  format: '2×LP',
  genre: 'Jazz',
};

describe('AlbumCard', () => {
  it('renders a safe external anchor when the record has a url', () => {
    render(<AlbumCard record={{ ...record, url: 'https://www.discogs.com/release/1481' }} />);

    const link = screen.getByRole('link', { name: /Bitches Brew by Miles Davis/i });
    expect(link).toHaveAttribute('href', 'https://www.discogs.com/release/1481');
    expect(link).toHaveAttribute('target', '_blank');
    // Without noopener the opened page can navigate this tab via window.opener.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders no link at all when the record has no url', () => {
    render(<AlbumCard record={record} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Bitches Brew')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w client -- AlbumCard
```

Expected: FAIL — `AlbumCard` currently takes `href` and renders an internal link.

- [ ] **Step 3: Change AlbumCard to use the record's url**

In `client/src/components/AlbumCard.tsx`, drop the `href` prop and read `record.url`. Update `CardShell` so the anchor branch emits the external attributes:

```tsx
if (href) {
  return (
    <a className={classes} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {children}
    </a>
  );
}
```

and in `AlbumCard`, pass `href={record.url}` instead of the prop. Add `url?: string` to `VinylRecord` in `client/src/types/collection.ts` and delete the now-unused `coverUrl` comment about placeholders staying accurate.

- [ ] **Step 4: Run the AlbumCard test**

```bash
npm test -w client -- AlbumCard
```

Expected: both PASS.

- [ ] **Step 5: Write the failing useResource test**

Create `client/tests/useResource.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useResource } from '../src/hooks/useResource';

describe('useResource', () => {
  it('starts loading, then exposes data', async () => {
    const fetcher = vi.fn().mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() => useResource(fetcher));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ id: 1 }]);
    expect(result.current.error).toBeNull();
  });

  it('exposes a message when the fetch rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useResource(fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.data).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

```bash
npm test -w client -- useResource
```

Expected: FAIL — module not found.

- [ ] **Step 7: Write the hook**

Create `client/src/hooks/useResource.ts`:

```ts
import { useEffect, useState } from 'react';

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetch once on mount. The `cancelled` flag stops a late response from
 * setting state after unmount, which in StrictMode's double-invoke would
 * otherwise apply the first render's response over the second's.
 */
export function useResource<T>(fetcher: () => Promise<T>): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    fetcher()
      .then((data) => {
        if (!cancelled) {
          setState({ data, error: null, loading: false });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error: error instanceof Error ? error.message : 'Unknown error',
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
```

- [ ] **Step 8: Add the typed fetchers**

Extend `client/src/api/client.ts`:

```ts
import type {
  CollectionStat,
  FaqItem,
  SetupItem,
  VinylRecord,
  WishlistItem,
} from '../types/collection';

export interface Stats {
  totalRecords: number;
  topGenre: { name: string; count: number } | null;
  topLabel: { name: string; count: number } | null;
  collectingSince: string | null;
  addedLast30Days: number;
}

export const getFeaturedRecords = (): Promise<VinylRecord[]> =>
  request<VinylRecord[]>('/records?featured=true&limit=8');

export const getRecentRecords = (): Promise<VinylRecord[]> =>
  request<VinylRecord[]>('/records?sort=addedAt&limit=6');

export const getStats = (): Promise<Stats> => request<Stats>('/stats');
export const getWishlist = (): Promise<WishlistItem[]> => request<WishlistItem[]>('/wishlist');
export const getSetup = (): Promise<SetupItem[]> => request<SetupItem[]>('/setup');
export const getFaq = (): Promise<FaqItem[]> => request<FaqItem[]>('/faq');
```

- [ ] **Step 9: Convert the sections to take props**

Each section currently imports from `data/collection`. Change each to accept its data as props and render three states. Example for `QuickStats.tsx` — apply the same pattern to the others:

```tsx
import type { Stats } from '../api/client';
import { StatCard } from '../components/StatCard';
import type { CollectionStat } from '../types/collection';
import styles from './QuickStats.module.css';

/** Builds the four cards from computed figures. */
function toCards(stats: Stats): CollectionStat[] {
  return [
    { id: 'total', icon: 'disc', value: String(stats.totalRecords), label: 'Total records' },
    {
      id: 'genre',
      icon: 'bars',
      value: stats.topGenre?.name ?? '—',
      label: stats.topGenre ? `Top genre · ${stats.topGenre.count} records` : 'Top genre',
    },
    {
      id: 'label',
      icon: 'square',
      value: stats.topLabel?.name ?? '—',
      label: stats.topLabel ? `Top label · ${stats.topLabel.count} records` : 'Top label',
    },
    {
      id: 'since',
      icon: 'sleeve',
      value: stats.collectingSince ?? '—',
      label: 'Collecting since',
    },
  ];
}

export function QuickStats({ stats }: { stats: Stats | null }): JSX.Element {
  const cards = stats ? toCards(stats) : [];

  return (
    <section className={styles.section} aria-label="Collection at a glance">
      <ul className={styles.grid}>
        {(cards.length > 0 ? cards : Array.from({ length: 4 }, (_, i) => null)).map((card, i) => (
          <li key={card?.id ?? i}>
            <StatCard stat={card ?? { id: String(i), icon: 'disc', value: '', label: '' }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

The loading branch renders four empty cards at full size, so the grid holds its height and nothing shifts when the numbers arrive.

- [ ] **Step 10: Wire HomePage**

```tsx
export function HomePage({ showSetup = true, showWishlist = true }: HomePageProps): JSX.Element {
  const featured = useResource(getFeaturedRecords);
  const recent = useResource(getRecentRecords);
  const stats = useResource(getStats);
  const wishlist = useResource(getWishlist);
  const setup = useResource(getSetup);
  const faq = useResource(getFaq);

  return (
    <>
      <NavBar />
      <main>
        <Hero stats={stats.data} />
        <QuickStats stats={stats.data} />
        <CollectionHighlights
          records={featured.data ?? []}
          total={stats.data?.totalRecords ?? 0}
          error={featured.error}
        />
        <RecentlyAdded
          records={recent.data ?? []}
          total={stats.data?.totalRecords ?? 0}
          windowLabel={stats.data ? `Last 30 days · ${stats.data.addedLast30Days} records` : ''}
          error={recent.error}
        />
        {showSetup && <AudioSetup items={setup.data ?? []} error={setup.error} />}
        {showWishlist && <Wishlist items={wishlist.data ?? []} error={wishlist.error} />}
        <Contact faqItems={faq.data ?? []} />
      </main>
      <Footer />
    </>
  );
}
```

Each section renders its heading plus a muted line in `--color-text-muted` when `error` is set, rather than collapsing.

- [ ] **Step 11: Delete the static module**

```bash
git rm client/src/data/collection.ts
```

Move `GENRE_FILTERS` and `DECADE_FILTERS` into `client/src/sections/CollectionHighlights.tsx`, which is their only consumer.

- [ ] **Step 12: Run everything**

```bash
npm test -w client && npm run lint -w client && npm run build -w client
```

Expected: all PASS.

- [ ] **Step 13: Verify in the browser**

Start the stack, seed, and confirm the page renders with real numbers.

```bash
docker compose up --build -d
docker compose exec server npx prisma migrate deploy
docker compose exec server npm run prisma:seed
```

Open `http://localhost:5173`. Expect `14 / Jazz · 4 records / Blue Note · 1 record / 2009` on the stat cards and `8 of 14 shown` on the counter. **These are lower than the mockup's 324/64/21 by design** — see spec §8.

- [ ] **Step 14: Commit**

```bash
git add client
git commit -m "feat: render the homepage from the API

Sections take their data as props; HomePage owns fetching through
useResource. The striped placeholders already sized to the design double
as the loading state, so nothing shifts when data lands, and a failed
fetch leaves the section heading in place with a muted message.

Album cards now link to record.url as an external target with
rel=noopener noreferrer, replacing the /records/:slug links that 404ed.

Deletes data/collection.ts rather than leaving a stale second copy."
```

---

## Phase 3 — Authentication

### Task 8: Environment and password hashing

**Files:**

- Modify: `server/src/config/env.ts`, `.env.example`, `server/package.json`
- Create: `server/scripts/hashPassword.ts`
- Test: `server/tests/config/env.test.ts`

**Interfaces:**

- Produces: `env.ADMIN_PASSWORD_HASH: string`, `env.SESSION_SECRET: string`. Task 9 consumes both.

- [ ] **Step 1: Write the failing test**

Create `server/tests/config/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePort } from '../../src/config/env';

describe('parsePort', () => {
  it('accepts a numeric string', () => {
    expect(parsePort('4000')).toBe(4000);
  });

  it('falls back on an empty string', () => {
    // Compose substitutes "" for an unset variable; Number("") is 0, not NaN,
    // so a naive parse silently binds to a random port.
    expect(parsePort('')).toBe(4000);
  });

  it('falls back on undefined', () => {
    expect(parsePort(undefined)).toBe(4000);
  });

  it('throws on a non-numeric value', () => {
    expect(() => parsePort('abc')).toThrow(/Invalid PORT/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- env
```

Expected: FAIL — `parsePort` is not exported.

- [ ] **Step 3: Rewrite env.ts**

Replace `server/src/config/env.ts`:

```ts
interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  SESSION_SECRET: string;
  ADMIN_PASSWORD_HASH: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Compose substitutes an empty string for an unset variable, and Number('')
 * is 0 rather than NaN — so an unset SERVER_PORT would silently bind the
 * server to a random ephemeral port. Treat empty as absent.
 */
export function parsePort(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return 4000;
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid PORT environment variable: ${raw}`);
  }
  return parsed;
}

export const env: Env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parsePort(process.env.PORT),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_SECRET: required('SESSION_SECRET'),
  ADMIN_PASSWORD_HASH: required('ADMIN_PASSWORD_HASH'),
};
```

This also closes the empty-`PORT` finding from the earlier branch review.

- [ ] **Step 4: Write the hashing script**

```bash
npm install -w server bcryptjs
npm install -D -w server @types/bcryptjs
```

Create `server/scripts/hashPassword.ts`:

```ts
import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run admin:hash -- 'your password'");
  process.exit(1);
}

if (password.length < 12) {
  console.error('Use at least 12 characters — this is the only credential on the site.');
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 12));
```

Add to `server/package.json`: `"admin:hash": "ts-node --transpile-only scripts/hashPassword.ts"`.

- [ ] **Step 5: Document the variables**

Append to `.env.example`:

```
# --- Admin ---
# Generate with: npm run admin:hash -w server -- 'your password'
ADMIN_PASSWORD_HASH=
# Any long random string: openssl rand -base64 32
SESSION_SECRET=
```

- [ ] **Step 6: Run the tests**

```bash
npm test -w server -- env
```

Expected: all four PASS.

- [ ] **Step 7: Commit**

```bash
git add server .env.example
git commit -m "feat: require admin credentials in env config

Adds ADMIN_PASSWORD_HASH and SESSION_SECRET, with a script that prints a
bcrypt hash to paste in. Also fixes PORT parsing: Compose substitutes an
empty string for an unset variable and Number('') is 0, not NaN, so the
old guard never fired and the server bound a random port."
```

---

### Task 9: Session, login and the auth guard

**Files:**

- Create: `server/src/routes/auth.ts`, `server/src/middleware/requireAuth.ts`, `server/src/types/session.d.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/routes/auth.test.ts`, `server/tests/helpers/auth.ts`

**Interfaces:**

- Consumes: `env` (Task 8).
- Produces: `requireAuth: RequestHandler` — every write route in Tasks 11-13 mounts it. `server/tests/helpers/auth.ts` exporting `loginAgent(): Promise<SuperAgentTest>`, used by every write test.

- [ ] **Step 1: Install**

```bash
npm install -w server express-session connect-pg-simple express-rate-limit
npm install -D -w server @types/express-session @types/connect-pg-simple
```

- [ ] **Step 2: Write the failing test**

Create `server/tests/routes/auth.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app';

const PASSWORD = 'test-password';

describe('POST /api/auth/login', () => {
  it('sets an httpOnly session cookie on the right password', async () => {
    const response = await request(app).post('/api/auth/login').send({ password: PASSWORD });

    expect(response.status).toBe(204);
    const cookie = response.headers['set-cookie'][0];
    // httpOnly is what stops an XSS payload from reading the session.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('401s on the wrong password without revealing why', async () => {
    const response = await request(app).post('/api/auth/login').send({ password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('400s when no password is sent', async () => {
    const response = await request(app).post('/api/auth/login').send({});

    expect(response.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('reports false before login', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.body).toEqual({ authenticated: false });
  });

  it('reports true with a session cookie', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ password: PASSWORD });

    const response = await agent.get('/api/auth/me');

    expect(response.body).toEqual({ authenticated: true });
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ password: PASSWORD });

    await agent.post('/api/auth/logout').expect(204);
    const response = await agent.get('/api/auth/me');

    expect(response.body).toEqual({ authenticated: false });
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npm test -w server -- auth
```

Expected: FAIL — 404 on every route.

- [ ] **Step 4: Declare the session shape**

Create `server/src/types/session.d.ts`:

```ts
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    isAdmin?: boolean;
  }
}
```

- [ ] **Step 5: Add session middleware**

In `server/src/app.ts`, after `express.json()`:

```ts
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

const PgStore = connectPgSimple(session);

app.set('trust proxy', 1); // nginx terminates TLS; without this Secure cookies never set

app.use(
  session({
    name: 'sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new PgStore({
      conString: env.DATABASE_URL,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);
```

`connect-pg-simple` creates its own `session` table, so this needs no Prisma migration.

- [ ] **Step 6: Write the routes**

Create `server/src/routes/auth.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

export const authRouter = Router();

// One password guards everything, so throttle guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

authRouter.post('/auth/login', loginLimiter, async (req: Request, res: Response) => {
  const password: unknown = req.body?.password;

  if (typeof password !== 'string' || password.length === 0) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }

  const valid = await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
  if (!valid) {
    // Deliberately identical for every failure — no hint about closeness.
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  req.session.isAdmin = true;
  res.status(204).end();
});

authRouter.post('/auth/logout', (req: Request, res: Response) => {
  req.session.destroy(() => res.status(204).end());
});

authRouter.get('/auth/me', (req: Request, res: Response) => {
  res.json({ authenticated: req.session.isAdmin === true });
});
```

- [ ] **Step 7: Write the guard**

Create `server/src/middleware/requireAuth.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.isAdmin === true) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required' });
}
```

- [ ] **Step 8: Add the test login helper**

Create `server/tests/helpers/auth.ts`:

```ts
import request from 'supertest';
import { app } from '../../src/app';

/** A Supertest agent that carries an authenticated session cookie. */
export async function loginAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ password: 'test-password' }).expect(204);
  return agent;
}
```

- [ ] **Step 9: Mount and run**

Add `app.use('/api', authRouter);` to `server/src/app.ts`, then:

```bash
npm test -w server -- auth
```

Expected: all six PASS. If the cookie assertions fail, confirm `NODE_ENV=test` in `tests/setup.ts` — `secure: true` prevents the cookie being set over Supertest's plain HTTP.

- [ ] **Step 10: Commit**

```bash
git add server
git commit -m "feat: add session login with a single admin password

Sessions live in Postgres via connect-pg-simple so logout genuinely
revokes; a stateless token would stay valid until expiry. The cookie is
httpOnly, SameSite=Strict and Secure in production. SameSite=Strict on a
same-origin deployment is the CSRF mitigation, so no token exchange.

Login is rate-limited to 10 attempts per 15 minutes and returns an
identical message for every failure."
```

---

## Phase 4 — Write API

### Task 10: Validation middleware and shared libs

**Files:**

- Create: `server/src/middleware/validate.ts`, `server/src/lib/url.ts`, `server/src/lib/slug.ts`
- Test: `server/tests/lib/url.test.ts`, `server/tests/lib/slug.test.ts`

**Interfaces:**

- Produces: `validate(schema: ZodSchema): RequestHandler` attaching the parsed body to `res.locals.body`. `safeUrl: z.ZodType<string>` — a zod schema rejecting non-http(s). `slugify(title: string): string` and `uniqueSlug(base: string, exists: (s: string) => Promise<boolean>): Promise<string>`.

- [ ] **Step 1: Write the failing url test**

Create `server/tests/lib/url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { safeUrl } from '../../src/lib/url';

describe('safeUrl', () => {
  it.each(['https://discogs.com/release/1', 'http://example.com'])('accepts %s', (value) => {
    expect(safeUrl.parse(value)).toBe(value);
  });

  it.each([
    // A naive `new URL()` check passes all of these; each is a stored-XSS
    // vector once rendered into an href the collector clicks.
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
  ])('rejects %s', (value) => {
    expect(() => safeUrl.parse(value)).toThrow();
  });

  it('rejects a string that is not a url at all', () => {
    expect(() => safeUrl.parse('not a url')).toThrow();
  });
});
```

- [ ] **Step 2: Write the failing slug test**

Create `server/tests/lib/slug.test.ts`:

```ts
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
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('falls back when a title has no slug-able characters', () => {
    expect(slugify('!!!')).toBe('untitled');
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
```

- [ ] **Step 3: Run both to confirm they fail**

```bash
npm test -w server -- lib/
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Install zod and write url.ts**

```bash
npm install -w server zod
```

Create `server/src/lib/url.ts`:

```ts
import { z } from 'zod';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * A URL the collector pastes ends up in an href the visitor clicks, so the
 * protocol allowlist matters: `new URL('javascript:alert(1)')` parses fine.
 */
export const safeUrl = z.string().refine(
  (value) => {
    try {
      return ALLOWED_PROTOCOLS.has(new URL(value).protocol);
    } catch {
      return false;
    }
  },
  { message: 'Must be an http or https URL' },
);
```

- [ ] **Step 5: Write slug.ts**

Create `server/src/lib/slug.ts`:

```ts
/**
 * NFKD then stripping combining marks turns "Café" into "cafe" rather than
 * dropping the accented character entirely.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'untitled';
}

export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(base))) {
    return base;
  }

  let suffix = 2;
  while (await exists(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
```

- [ ] **Step 6: Write the validation middleware**

Create `server/src/middleware/validate.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Parses the body against a schema and hands the admin forms a field-keyed
 * error object they can render inline, rather than one opaque string.
 */
export function validate(
  schema: ZodSchema,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
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
```

- [ ] **Step 7: Run the tests**

```bash
npm test -w server -- lib/
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add server
git commit -m "feat: add zod validation, slug and URL-safety helpers

safeUrl allowlists http and https by protocol: new URL() happily parses
javascript: and data: URLs, and a pasted one becomes stored XSS on a link
the visitor clicks.

validate() returns a field-keyed error object so admin forms can render
messages inline instead of one opaque string."
```

---

### Task 11: Record CRUD

**Files:**

- Create: `server/src/schemas/record.ts`
- Modify: `server/src/routes/records.ts`
- Test: `server/tests/routes/records.write.test.ts`

**Interfaces:**

- Consumes: `requireAuth`, `validate`, `safeUrl`, `slugify`, `uniqueSlug`, `loginAgent`.
- Produces: `recordCreateSchema`, `recordUpdateSchema` (`= recordCreateSchema.partial()`).

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/records.write.test.ts`:

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loginAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

const valid = {
  title: 'Bitches Brew',
  artist: 'Miles Davis',
  year: 1970,
  format: '2×LP',
  genre: 'Jazz',
};

describe('write access', () => {
  it.each([
    ['post', '/api/records'],
    ['patch', '/api/records/1'],
    ['delete', '/api/records/1'],
  ])('%s %s requires a session', async (method, path) => {
    const response = await (request(app) as never)[method](path).send(valid);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Authentication required' });
  });
});

describe('POST /api/records', () => {
  it('creates a record and derives the slug', async () => {
    const agent = await loginAgent();
    const response = await agent.post('/api/records').send(valid);

    expect(response.status).toBe(201);
    expect(response.body.slug).toBe('bitches-brew');
    expect(response.body.featured).toBe(false);
  });

  it('suffixes a colliding slug rather than failing', async () => {
    const agent = await loginAgent();
    await agent.post('/api/records').send(valid).expect(201);

    const response = await agent.post('/api/records').send(valid);

    expect(response.status).toBe(201);
    expect(response.body.slug).toBe('bitches-brew-2');
  });

  it('reports missing fields by name', async () => {
    const agent = await loginAgent();
    const response = await agent.post('/api/records').send({ title: 'Only a title' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(Object.keys(response.body.fields)).toEqual(
      expect.arrayContaining(['artist', 'year', 'format', 'genre']),
    );
  });

  it('rejects a javascript: url', async () => {
    const agent = await loginAgent();
    const response = await agent
      .post('/api/records')
      .send({ ...valid, url: 'javascript:alert(1)' });

    expect(response.status).toBe(400);
    expect(response.body.fields.url).toMatch(/http/i);
  });
});

describe('PATCH /api/records/:id', () => {
  it('applies a partial update', async () => {
    const agent = await loginAgent();
    const created = await agent.post('/api/records').send(valid);

    const response = await agent
      .patch(`/api/records/${created.body.id}`)
      .send({ note: 'Gatefold intact', featured: true });

    expect(response.status).toBe(200);
    expect(response.body.note).toBe('Gatefold intact');
    expect(response.body.featured).toBe(true);
    expect(response.body.title).toBe('Bitches Brew');
  });

  it('404s an unknown id', async () => {
    const agent = await loginAgent();
    const response = await agent.patch('/api/records/9999').send({ note: 'x' });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/records/:id', () => {
  it('removes the record', async () => {
    const agent = await loginAgent();
    const created = await agent.post('/api/records').send(valid);

    await agent.delete(`/api/records/${created.body.id}`).expect(204);

    expect(await prisma.record.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- records.write
```

Expected: FAIL — 404 on every write.

- [ ] **Step 3: Write the schema**

Create `server/src/schemas/record.ts`:

```ts
import { z } from 'zod';
import { safeUrl } from '../lib/url';

export const recordCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  artist: z.string().trim().min(1, 'Artist is required'),
  year: z.number().int().min(1880).max(2100),
  format: z.string().trim().min(1, 'Format is required'),
  genre: z.string().trim().min(1, 'Genre is required'),
  slug: z.string().trim().min(1).optional(),
  label: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
  url: safeUrl.nullish(),
  coverUrl: safeUrl.or(z.string().startsWith('/uploads/')).nullish(),
  featured: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  addedAt: z.coerce.date().optional(),
});

// Partial derives from the same object, so create and update can never drift.
export const recordUpdateSchema = recordCreateSchema.partial();
```

`coverUrl` accepts either an external URL or an app-relative upload path.

- [ ] **Step 4: Add the write routes**

Append to `server/src/routes/records.ts`:

```ts
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { recordCreateSchema, recordUpdateSchema } from '../schemas/record';
import { slugify, uniqueSlug } from '../lib/slug';

recordsRouter.post(
  '/records',
  requireAuth,
  validate(recordCreateSchema),
  async (_req: Request, res: Response) => {
    const body = res.locals.body as z.infer<typeof recordCreateSchema>;

    const slug = await uniqueSlug(
      body.slug ?? slugify(body.title),
      async (candidate) => (await prisma.record.count({ where: { slug: candidate } })) > 0,
    );

    const created = await prisma.record.create({ data: { ...body, slug } });
    res.status(201).json(created);
  },
);

recordsRouter.patch(
  '/records/:id',
  requireAuth,
  validate(recordUpdateSchema),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = await prisma.record.findUnique({ where: { id } });

    if (!existing) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    const updated = await prisma.record.update({
      where: { id },
      data: res.locals.body,
    });
    res.json(updated);
  },
);

recordsRouter.delete('/records/:id', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await prisma.record.findUnique({ where: { id } });

  if (!existing) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  await prisma.record.delete({ where: { id } });
  res.status(204).end();
});
```

- [ ] **Step 5: Run the tests**

```bash
npm test -w server -- records.write
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat: add record create, update and delete

Every write is behind requireAuth and zod validation. Slugs derive from
the title and get a numeric suffix on collision, so two pressings of the
same album both save instead of the second 500ing on a unique violation.

The url field rejects anything outside http and https."
```

---

### Task 12: Wishlist, setup, FAQ and settings writes

**Files:**

- Create: `server/src/schemas/content.ts`, `server/src/routes/settings.ts`
- Modify: `server/src/routes/wishlist.ts`, `setup.ts`, `faq.ts`, `server/src/app.ts`
- Test: `server/tests/routes/content.write.test.ts`

**Interfaces:**

- Produces: `wishlistCreateSchema`, `setupCreateSchema`, `faqCreateSchema` and their `.partial()` counterparts; `settingsRouter`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/content.write.test.ts`:

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loginAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

describe.each([
  ['/api/wishlist', { title: 'Karma', artist: 'Pharoah Sanders', pressing: 'Impulse! gatefold' }],
  ['/api/setup', { icon: 'turntable', label: 'Turntable', value: 'Technics SL-1200 MK2' }],
  ['/api/faq', { question: 'Do you trade?', answer: 'Gladly.' }],
])('%s writes', (path, valid) => {
  it('rejects an unauthenticated create', async () => {
    const response = await request(app).post(path).send(valid);
    expect(response.status).toBe(401);
  });

  it('creates, updates and deletes', async () => {
    const agent = await loginAgent();

    const created = await agent.post(path).send(valid);
    expect(created.status).toBe(201);

    const updated = await agent.patch(`${path}/${created.body.id}`).send({ position: 3 });
    expect(updated.status).toBe(200);
    expect(updated.body.position).toBe(3);

    await agent.delete(`${path}/${created.body.id}`).expect(204);
  });
});

describe('setup icon validation', () => {
  it('rejects an icon with no matching component', async () => {
    const agent = await loginAgent();
    const response = await agent
      .post('/api/setup')
      .send({ icon: 'gramophone', label: 'X', value: 'Y' });

    expect(response.status).toBe(400);
    expect(response.body.fields.icon).toBeDefined();
  });
});

describe('PATCH /api/settings', () => {
  it('upserts a setting', async () => {
    const agent = await loginAgent();

    const response = await agent.patch('/api/settings').send({ collectingSince: '2009' });

    expect(response.status).toBe(200);
    const stored = await prisma.siteSetting.findUnique({ where: { key: 'collectingSince' } });
    expect(stored?.value).toBe('2009');
  });

  it('rejects an unknown key rather than storing junk', async () => {
    const agent = await loginAgent();
    const response = await agent.patch('/api/settings').send({ nonsense: 'x' });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- content.write
```

Expected: FAIL.

- [ ] **Step 3: Write the schemas**

Create `server/src/schemas/content.ts`:

```ts
import { z } from 'zod';
import { safeUrl } from '../lib/url';

// Must match the keys of setupIcons in client/src/components/ui/icons.tsx.
export const SETUP_ICONS = ['turntable', 'cartridge', 'amplifier', 'speakers', 'cable'] as const;

export const wishlistCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  artist: z.string().trim().min(1, 'Artist is required'),
  pressing: z.string().trim().min(1, 'Pressing is required'),
  url: safeUrl.nullish(),
  position: z.number().int().min(0).optional(),
});
export const wishlistUpdateSchema = wishlistCreateSchema.partial();

export const setupCreateSchema = z.object({
  icon: z.enum(SETUP_ICONS, { message: 'Not an available icon' }),
  label: z.string().trim().min(1, 'Label is required'),
  value: z.string().trim().min(1, 'Value is required'),
  position: z.number().int().min(0).optional(),
});
export const setupUpdateSchema = setupCreateSchema.partial();

export const faqCreateSchema = z.object({
  question: z.string().trim().min(1, 'Question is required'),
  answer: z.string().trim().min(1, 'Answer is required'),
  position: z.number().int().min(0).optional(),
  openByDefault: z.boolean().optional(),
});
export const faqUpdateSchema = faqCreateSchema.partial();

export const settingsSchema = z
  .object({
    collectingSince: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Use a four-digit year'),
  })
  .partial()
  .strict(); // .strict() is what makes an unknown key a 400 rather than a silent no-op
```

- [ ] **Step 4: Add writes to the three content routers**

Append the same three handlers to each of `wishlist.ts`, `setup.ts` and `faq.ts`, substituting the model and schema. For `wishlist.ts`:

```ts
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { wishlistCreateSchema, wishlistUpdateSchema } from '../schemas/content';

wishlistRouter.post(
  '/wishlist',
  requireAuth,
  validate(wishlistCreateSchema),
  async (_req: Request, res: Response) => {
    const created = await prisma.wishlistItem.create({ data: res.locals.body });
    res.status(201).json(created);
  },
);

wishlistRouter.patch(
  '/wishlist/:id',
  requireAuth,
  validate(wishlistUpdateSchema),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!(await prisma.wishlistItem.findUnique({ where: { id } }))) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.json(await prisma.wishlistItem.update({ where: { id }, data: res.locals.body }));
  },
);

wishlistRouter.delete('/wishlist/:id', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!(await prisma.wishlistItem.findUnique({ where: { id } }))) {
    res.status(404).json({ error: 'Item not found' });
    return;
  }
  await prisma.wishlistItem.delete({ where: { id } });
  res.status(204).end();
});
```

Repeat verbatim for `setup.ts` (model `setupItem`, schemas `setupCreateSchema`/`setupUpdateSchema`, path `/setup`) and `faq.ts` (model `faqItem`, schemas `faqCreateSchema`/`faqUpdateSchema`, path `/faq`).

- [ ] **Step 5: Write the settings route**

Create `server/src/routes/settings.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { settingsSchema } from '../schemas/content';

export const settingsRouter = Router();

settingsRouter.patch(
  '/settings',
  requireAuth,
  validate(settingsSchema),
  async (_req: Request, res: Response) => {
    const body = res.locals.body as Record<string, string>;

    for (const [key, value] of Object.entries(body)) {
      await prisma.siteSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }

    res.json(await prisma.siteSetting.findMany());
  },
);
```

Mount it in `server/src/app.ts`.

- [ ] **Step 6: Run the tests**

```bash
npm test -w server -- content.write
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server
git commit -m "feat: add wishlist, setup, FAQ and settings writes

Setup icons are validated against the five components that actually exist
in icons.tsx, so a typo cannot save a row that renders nothing. The
settings schema is strict, making an unknown key a 400 rather than a
silent no-op."
```

---

### Task 13: Cover uploads

**Files:**

- Create: `server/src/lib/imageType.ts`, `server/src/routes/uploads.ts`
- Modify: `server/src/app.ts`, `docker-compose.yml`, `docker-compose.prod.yml`, `.dockerignore`, `client/vite.config.ts`, `client/nginx.conf.template`
- Test: `server/tests/lib/imageType.test.ts`, `server/tests/routes/uploads.test.ts`

**Interfaces:**

- Produces: `sniffImageType(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'avif' | null`; `POST /api/uploads` returning `{ url: string }`.

- [ ] **Step 1: Write the failing sniff test**

Create `server/tests/lib/imageType.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sniffImageType } from '../../src/lib/imageType';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypavif')]);

describe('sniffImageType', () => {
  it.each([
    [jpeg, 'jpg'],
    [png, 'png'],
    [webp, 'webp'],
    [avif, 'avif'],
  ])('identifies %#', (buffer, expected) => {
    expect(sniffImageType(buffer)).toBe(expected);
  });

  it('rejects an SVG, which can carry script', () => {
    expect(
      sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')),
    ).toBeNull();
  });

  it('rejects a payload whose extension lies about its content', () => {
    // A PHP payload named cover.jpg — the reason we sniff instead of trusting
    // the filename or the client-supplied mimetype.
    expect(sniffImageType(Buffer.from('<?php system($_GET["c"]); ?>'))).toBeNull();
  });

  it('rejects a buffer too short to identify', () => {
    expect(sniffImageType(Buffer.from([0xff]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- imageType
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the sniffer**

Create `server/src/lib/imageType.ts`:

```ts
export type ImageType = 'jpg' | 'png' | 'webp' | 'avif';

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

/**
 * Identify an image by its magic bytes. multer's `file.mimetype` is supplied
 * by the client and the filename extension is attacker-controlled, so neither
 * can gate what gets written to disk.
 */
export function sniffImageType(buffer: Buffer): ImageType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return 'jpg';
  }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'webp';
  }
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)) {
    return 'avif';
  }
  return null;
}
```

- [ ] **Step 4: Write the failing upload test**

Create `server/tests/routes/uploads.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loginAgent } from '../helpers/auth';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

describe('POST /api/uploads', () => {
  it('requires a session', async () => {
    const response = await request(app).post('/api/uploads').attach('file', png, 'cover.png');
    expect(response.status).toBe(401);
  });

  it('stores a png and returns its url', async () => {
    const agent = await loginAgent();
    const response = await agent.post('/api/uploads').attach('file', png, 'cover.png');

    expect(response.status).toBe(201);
    expect(response.body.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
  });

  it('rejects a payload whose extension lies', async () => {
    const agent = await loginAgent();
    const response = await agent
      .post('/api/uploads')
      .attach('file', Buffer.from('<?php system($_GET["c"]); ?>'), 'cover.png');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/image/i);
  });

  it('rejects a file over the cap', async () => {
    const agent = await loginAgent();
    const oversized = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]);

    const response = await agent.post('/api/uploads').attach('file', oversized, 'big.png');

    expect(response.status).toBe(413);
  });

  it('400s when no file is attached', async () => {
    const agent = await loginAgent();
    const response = await agent.post('/api/uploads');

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 5: Write the upload route**

```bash
npm install -w server multer
npm install -D -w server @types/multer
```

Create `server/src/routes/uploads.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth';
import { sniffImageType } from '../lib/imageType';

export const uploadsRouter = Router();

export const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const MAX_BYTES = 5 * 1024 * 1024;

// memoryStorage so nothing touches disk until the bytes have been sniffed.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

uploadsRouter.post(
  '/uploads',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const type = sniffImageType(req.file.buffer);
    if (!type) {
      res.status(400).json({ error: 'Not a supported image (jpeg, png, webp or avif)' });
      return;
    }

    // Generated name: the client filename never reaches a path.
    const filename = `${randomUUID()}.${type}`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, filename), req.file.buffer);

    res.status(201).json({ url: `/uploads/${filename}` });
  },
);

// multer throws outside the normal error chain; translate its size error to 413.
uploadsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is larger than 5 MB' });
    return;
  }
  next(err);
});
```

- [ ] **Step 6: Serve the directory and mount**

In `server/src/app.ts`:

```ts
import express from 'express';
import { UPLOAD_DIR, uploadsRouter } from './routes/uploads';

app.use('/uploads', express.static(UPLOAD_DIR, { index: false, dotfiles: 'deny' }));
app.use('/api', uploadsRouter);
```

- [ ] **Step 7: Add the volume and the proxy rules**

`docker-compose.yml` — add to the `server` service and the top-level `volumes`:

```yaml
server:
  volumes:
    - uploads:/app/server/uploads

volumes:
  db-data:
  uploads:
```

`client/vite.config.ts` — `/uploads` is not under `/api`, so it needs its own proxy key:

```ts
proxy: {
  '/api': { target: `http://server:${serverPort}`, changeOrigin: true },
  '/uploads': { target: `http://server:${serverPort}`, changeOrigin: true },
},
```

`client/nginx.conf.template` — add a second location block:

```
location /uploads/ {
    proxy_pass http://server:${SERVER_PORT}/uploads/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}
```

Add `**/uploads` to `.dockerignore` so local uploads never enter a build context.

- [ ] **Step 8: Run the tests**

```bash
npm test -w server -- uploads imageType
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add server client docker-compose.yml .dockerignore
git commit -m "feat: accept cover image uploads

Files are buffered in memory and identified by magic bytes before anything
is written: multer's mimetype is client-supplied and the filename extension
is attacker-controlled, so neither can gate what lands on disk. Stored
names are generated UUIDs, so the client filename never reaches a path.

5 MB cap, jpeg/png/webp/avif only. SVG is excluded deliberately: it can
carry script. Files live on a named volume, proxied in both environments."
```

---

## Phase 5 — Admin UI

### Task 14: Router and auth guard

**Files:**

- Create: `client/src/routes.tsx`, `client/src/admin/RequireAuth.tsx`, `client/src/admin/AdminLayout.tsx`, `client/src/admin/AdminLayout.module.css`
- Modify: `client/src/main.tsx`, `client/src/api/client.ts`
- Test: `client/tests/RequireAuth.test.tsx`

**Interfaces:**

- Consumes: `GET /api/auth/me`.
- Produces: the route tree; `RequireAuth` wrapping every admin screen.

- [ ] **Step 1: Install**

```bash
npm install -w client react-router-dom
```

- [ ] **Step 2: Write the failing test**

Create `client/tests/RequireAuth.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../src/admin/RequireAuth';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/login" element={<p>Login screen</p>} />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <p>Secret dashboard</p>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('RequireAuth', () => {
  it('shows the children when authenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
    );

    renderAt('/admin');

    expect(await screen.findByText('Secret dashboard')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false }), { status: 200 }),
    );

    renderAt('/admin');

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(screen.queryByText('Secret dashboard')).toBeNull();
  });

  it('never flashes protected content while the check is pending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    renderAt('/admin');

    await waitFor(() => expect(screen.queryByText('Secret dashboard')).toBeNull());
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npm test -w client -- RequireAuth
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write RequireAuth**

Create `client/src/admin/RequireAuth.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getAuthStatus } from '../api/client';
import { useResource } from '../hooks/useResource';

export function RequireAuth({ children }: { children: ReactNode }): JSX.Element | null {
  const location = useLocation();
  const { data, loading } = useResource(getAuthStatus);

  // Render nothing while pending: showing the shell first would flash
  // protected chrome to an unauthenticated visitor.
  if (loading) {
    return null;
  }

  if (!data?.authenticated) {
    // `state.from` lets the login screen return the user where they aimed.
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
```

Add to `client/src/api/client.ts`:

```ts
export const getAuthStatus = (): Promise<{ authenticated: boolean }> =>
  request<{ authenticated: boolean }>('/auth/me');

export const login = (password: string): Promise<void> =>
  request<void>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) });

export const logout = (): Promise<void> => request<void>('/auth/logout', { method: 'POST' });
```

- [ ] **Step 5: Build the route tree**

Create `client/src/routes.tsx`:

```tsx
import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { RequireAuth } from './admin/RequireAuth';

// Lazy so a visitor to the public homepage never downloads the admin bundle.
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const LoginPage = lazy(() => import('./admin/LoginPage'));
const DashboardPage = lazy(() => import('./admin/DashboardPage'));
const RecordsListPage = lazy(() => import('./admin/records/RecordsListPage'));
const RecordFormPage = lazy(() => import('./admin/records/RecordFormPage'));
const WishlistPage = lazy(() => import('./admin/WishlistPage'));
const SetupPage = lazy(() => import('./admin/SetupPage'));
const FaqPage = lazy(() => import('./admin/FaqPage'));
const SettingsPage = lazy(() => import('./admin/SettingsPage'));

const suspend = (node: JSX.Element): JSX.Element => <Suspense fallback={null}>{node}</Suspense>;

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/admin/login', element: suspend(<LoginPage />) },
  {
    path: '/admin',
    element: suspend(
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>,
    ),
    children: [
      { index: true, element: suspend(<DashboardPage />) },
      { path: 'records', element: suspend(<RecordsListPage />) },
      { path: 'records/new', element: suspend(<RecordFormPage />) },
      { path: 'records/:id', element: suspend(<RecordFormPage />) },
      { path: 'wishlist', element: suspend(<WishlistPage />) },
      { path: 'setup', element: suspend(<SetupPage />) },
      { path: 'faq', element: suspend(<FaqPage />) },
      { path: 'settings', element: suspend(<SettingsPage />) },
    ],
  },
]);
```

Update `client/src/main.tsx` to render `<RouterProvider router={router} />`, and delete `client/src/App.tsx` (its only job was rendering `HomePage`).

- [ ] **Step 6: Write AdminLayout**

Create `client/src/admin/AdminLayout.tsx` — a sidebar of `NavLink`s to each screen, a logout button calling `logout()` then navigating to `/admin/login`, and an `<Outlet />`. Style it with a CSS Module using only `tokens.css` variables. Export default.

- [ ] **Step 7: Run the tests and build**

```bash
npm test -w client -- RequireAuth && npm run build -w client
```

Expected: PASS. Confirm the build output lists separate admin chunks.

- [ ] **Step 8: Commit**

```bash
git add client
git commit -m "feat: add routing with a lazy, guarded admin tree

RequireAuth renders nothing while the session check is pending rather than
showing the shell, so protected chrome never flashes to an unauthenticated
visitor, and it records the attempted path so login can return there.

Admin screens are React.lazy so the public bundle is unchanged."
```

---

### Task 15: Login screen

**Files:**

- Create: `client/src/admin/LoginPage.tsx`, `client/src/admin/LoginPage.module.css`
- Test: `client/tests/LoginPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/tests/LoginPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../src/admin/LoginPage';

afterEach(() => vi.restoreAllMocks());

describe('LoginPage', () => {
  it('shows an error when the password is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 }),
    );

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect password/i);
  });

  it('does not submit an empty password', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w client -- LoginPage
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `client/src/admin/LoginPage.tsx`: a centred card reusing `Field` (with `type="password"` added to `Field`'s allowed types) and `Button`. On submit, guard the empty case client-side, call `login(password)`, and on success `navigate(location.state?.from ?? '/admin', { replace: true })`. On failure set a form-level error rendered with `role="alert"` reading "Incorrect password." Export default.

Add `'password'` to the `type` union in `client/src/components/ui/Field.tsx`.

- [ ] **Step 4: Run and commit**

```bash
npm test -w client -- LoginPage
```

```bash
git add client
git commit -m "feat: add the admin login screen

Reuses Field and Button so the admin reads as part of the same product.
Returns the user to the path they originally aimed at after signing in."
```

---

### Task 16: Shared admin components

**Files:**

- Create: `client/src/admin/components/DataTable.tsx` + module, `ConfirmDialog.tsx` + module, `ImageField.tsx` + module
- Test: `client/tests/ConfirmDialog.test.tsx`, `client/tests/ImageField.test.tsx`

**Interfaces:**

- Produces:
  - `DataTable<T>({ columns, rows, actions }: { columns: Column<T>[]; rows: T[]; actions?: (row: T) => ReactNode })` where `Column<T> = { key: string; header: string; render: (row: T) => ReactNode }`
  - `ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel })`
  - `ImageField({ value, onChange, label })` — `value: string | null`, `onChange(next: string | null)`

- [ ] **Step 1: Write the failing ConfirmDialog test**

Create `client/tests/ConfirmDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/admin/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete"
        message="Sure?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('only fires onConfirm when the confirm button is pressed', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Delete record"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('closes on Escape', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Write the failing ImageField test**

Create `client/tests/ImageField.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageField } from '../src/admin/components/ImageField';

describe('ImageField', () => {
  it('reports a pasted url', async () => {
    const onChange = vi.fn();
    render(<ImageField label="Cover" value={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: /url/i }));
    await userEvent.type(screen.getByLabelText(/image url/i), 'https://example.com/a.jpg');

    expect(onChange).toHaveBeenLastCalledWith('https://example.com/a.jpg');
  });

  it('clears the value', async () => {
    const onChange = vi.fn();
    render(<ImageField label="Cover" value="https://example.com/a.jpg" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

```bash
npm test -w client -- ConfirmDialog ImageField
```

- [ ] **Step 4: Implement the three components**

`ConfirmDialog` — returns `null` when `open` is false; otherwise a `role="dialog" aria-modal="true"` overlay. On mount, focus the cancel button and add a `keydown` listener calling `onCancel` on Escape; remove it on unmount. Deletes are irreversible, so cancel is the default focus, not confirm.

`DataTable` — a `<table>` rendering `columns` as `<th scope="col">` and each row through `column.render`. An optional trailing actions cell.

`ImageField` — two radios ("Upload" / "URL") in a `role="radiogroup"`. URL mode is a text input calling `onChange` on change. Upload mode is a file input that POSTs to `/api/uploads` as `FormData` and calls `onChange(result.url)`. Both modes show a thumbnail of the current `value` with an `onError` that hides it, and a "Remove" button calling `onChange(null)`.

Add to `client/src/api/client.ts`:

```ts
export async function uploadCover(file: File): Promise<{ url: string }> {
  const body = new FormData();
  body.append('file', file);

  // No Content-Type header: the browser must set the multipart boundary.
  const response = await fetch('/api/uploads', { method: 'POST', body });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(problem.error ?? 'Upload failed');
  }
  return response.json();
}
```

This bypasses `request()` deliberately — that helper always sets a JSON `Content-Type`, which would break the multipart boundary.

- [ ] **Step 5: Run and commit**

```bash
npm test -w client -- ConfirmDialog ImageField
```

```bash
git add client
git commit -m "feat: add DataTable, ConfirmDialog and ImageField

ConfirmDialog focuses Cancel rather than Confirm and closes on Escape:
deletes are irreversible and should not be one stray keystroke away.

uploadCover deliberately bypasses the shared request helper, which always
sets a JSON Content-Type and would break the multipart boundary."
```

---

### Task 17: Records list and form

**Files:**

- Create: `client/src/admin/records/RecordsListPage.tsx`, `RecordFormPage.tsx`, and modules
- Modify: `client/src/api/client.ts`
- Test: `client/tests/RecordFormPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/tests/RecordFormPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecordFormPage from '../src/admin/records/RecordFormPage';

afterEach(() => vi.restoreAllMocks());

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/admin/records/new']}>
      <RecordFormPage />
    </MemoryRouter>,
  );
}

describe('RecordFormPage', () => {
  it('renders server field errors against the right inputs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Validation failed',
          fields: { url: 'Must be an http or https URL' },
        }),
        { status: 400 },
      ),
    );

    renderNew();

    await userEvent.type(screen.getByLabelText(/^title$/i), 'Bitches Brew');
    await userEvent.type(screen.getByLabelText(/^artist$/i), 'Miles Davis');
    await userEvent.type(screen.getByLabelText(/^year$/i), '1970');
    await userEvent.type(screen.getByLabelText(/^format$/i), '2×LP');
    await userEvent.type(screen.getByLabelText(/^genre$/i), 'Jazz');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('Must be an http or https URL')).toBeInTheDocument();
  });

  it('sends year as a number, not a string', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));

    renderNew();

    await userEvent.type(screen.getByLabelText(/^title$/i), 'Blue Train');
    await userEvent.type(screen.getByLabelText(/^artist$/i), 'John Coltrane');
    await userEvent.type(screen.getByLabelText(/^year$/i), '1958');
    await userEvent.type(screen.getByLabelText(/^format$/i), 'LP');
    await userEvent.type(screen.getByLabelText(/^genre$/i), 'Jazz');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    // The zod schema is z.number(), so a string "1958" would 400.
    expect(body.year).toBe(1958);
    expect(typeof body.year).toBe('number');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w client -- RecordFormPage
```

- [ ] **Step 3: Implement the form**

`RecordFormPage` reads `useParams().id`; when present it fetches the record and pre-fills, otherwise it starts empty. Fields, all built from `Field` except cover and the two booleans:

| Field                                           | Control                                           |
| ----------------------------------------------- | ------------------------------------------------- |
| title, artist, format, genre, label, note, slug | text                                              |
| year, position                                  | text, `inputMode="numeric"`, `Number()` on submit |
| url                                             | text                                              |
| coverUrl                                        | `ImageField`                                      |
| addedAt                                         | `type="date"`                                     |
| featured                                        | checkbox                                          |

On submit, POST or PATCH; on a 400 read `fields` and pass each message into the matching `Field`'s `error` prop; on success navigate to `/admin/records`.

Add the CRUD fetchers to `client/src/api/client.ts`:

```ts
export const getRecord = (id: number): Promise<VinylRecord> =>
  request<VinylRecord>(`/records/${id}`);

export const createRecord = (data: unknown): Promise<VinylRecord> =>
  request<VinylRecord>('/records', { method: 'POST', body: JSON.stringify(data) });

export const updateRecord = (id: number, data: unknown): Promise<VinylRecord> =>
  request<VinylRecord>(`/records/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteRecord = (id: number): Promise<void> =>
  request<void>(`/records/${id}`, { method: 'DELETE' });
```

`request()` currently throws a plain `Error` on a non-OK response, which discards the `fields` object. Extend it to throw an `ApiError` carrying `status` and `fields`:

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

Add `GET /api/records/:id` to `server/src/routes/records.ts` — the form needs it and only the list endpoint exists so far.

- [ ] **Step 4: Implement the list**

`RecordsListPage` renders a `DataTable` of cover thumbnail, title, artist, year, genre, featured and position, with Edit and Delete actions. Delete opens `ConfirmDialog` naming the record. Above the table: a text filter over title and artist, a featured-only toggle, and a "New record" button.

- [ ] **Step 5: Run and commit**

```bash
npm test -w client -- RecordFormPage && npm run lint -w client
```

```bash
git add client server
git commit -m "feat: add the admin records list and form

Field errors from the API land on the matching input rather than in one
banner. Year and position are converted to numbers before submit: the zod
schema is z.number() and a string would be rejected.

Adds GET /api/records/:id, which the edit form needs."
```

---

### Task 18: Wishlist, setup, FAQ and settings screens

**Files:**

- Create: `client/src/admin/WishlistPage.tsx`, `SetupPage.tsx`, `FaqPage.tsx`, `SettingsPage.tsx`, `DashboardPage.tsx`, and modules
- Modify: `client/src/api/client.ts`
- Test: `client/tests/WishlistPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/tests/WishlistPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WishlistPage from '../src/admin/WishlistPage';

const items = [
  { id: 1, title: 'Karma', artist: 'Pharoah Sanders', pressing: 'Impulse! gatefold', position: 0 },
];

afterEach(() => vi.restoreAllMocks());

describe('WishlistPage', () => {
  it('lists items and deletes only after confirmation', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(items), { status: 200 }));

    render(<WishlistPage />);
    expect(await screen.findByText('Karma')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    const callsBefore = fetchSpy.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(fetchSpy.mock.calls).toHaveLength(callsBefore);

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/wishlist/1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w client -- WishlistPage
```

- [ ] **Step 3: Implement the four screens**

All three list screens share one shape: fetch on mount into `useState`, render a `DataTable`, edit inline via a row that swaps to `Field` inputs, create via a form at the bottom, delete via `ConfirmDialog`. After any successful mutation, refetch rather than patching local state — these lists are short and a refetch cannot drift.

- `WishlistPage` — title, artist, pressing, url, position.
- `SetupPage` — icon (a `<select>` over the five valid values), label, value, position.
- `FaqPage` — question, answer (textarea), position, openByDefault (checkbox).
- `SettingsPage` — a single `collectingSince` field with a four-digit-year hint, PATCHing `/api/settings`.
- `DashboardPage` — row counts from `/api/stats` plus links to each screen.

Add the matching fetchers to `client/src/api/client.ts`, following the record CRUD naming (`getWishlist`, `createWishlistItem`, `updateWishlistItem`, `deleteWishlistItem`, and the same pattern for setup and faq).

- [ ] **Step 4: Run everything and commit**

```bash
npm test && npm run lint && npm run build
```

```bash
git add client
git commit -m "feat: add wishlist, setup, FAQ and settings screens

Each list refetches after a mutation rather than patching local state:
the lists are short and a refetch cannot drift from the server.

Setup icons are a select over the five values the schema accepts, so an
invalid icon cannot be typed."
```

---

## Phase 6 — Hardening

### Task 19: Close the security findings

**Files:**

- Modify: `server/src/app.ts`, `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.prod.yml`, `README.md`
- Test: `server/tests/security.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/tests/security.test.ts`:

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

describe('CORS', () => {
  it('does not hand a wildcard origin to an arbitrary site', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    // The site and its API are same-origin behind both proxies, so no
    // cross-origin caller should ever be granted access.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('security headers', () => {
  it('still sets helmet defaults', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- security
```

Expected: FAIL — `app.use(cors())` reflects every origin.

- [ ] **Step 3: Remove the wildcard CORS**

In `server/src/app.ts`, delete the `cors` import and `app.use(cors())`. Both the Vite dev server and nginx proxy `/api`, so browser traffic is same-origin and CORS headers serve no purpose. Remove `cors` and `@types/cors` from `server/package.json`.

- [ ] **Step 4: Stop publishing internal ports in production**

In `docker-compose.yml`, delete the `ports` block from `db` and from `server`. Add both to `docker-compose.override.yml` (development only):

```yaml
db:
  ports:
    - '${POSTGRES_PORT}:5432'

server:
  ports:
    - '${SERVER_PORT}:${SERVER_PORT}'
```

In production, nginx is the only published surface. This closes the finding that `npm run prod` bound Postgres to `0.0.0.0:5432` with the password from `.env.example`.

- [ ] **Step 5: Run the full suite**

```bash
npm test && npm run lint && npm run build
```

- [ ] **Step 6: Verify the production compose still works**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
docker compose exec server npx prisma migrate deploy
docker compose exec server npm run prisma:seed
curl -s -o /dev/null -w '%{http_code}' http://localhost:${CLIENT_PORT}/api/health
docker compose exec db pg_isready   # reachable inside the network
nc -z localhost 5432 && echo 'STILL EXPOSED — fix step 4' || echo 'not published: correct'
```

- [ ] **Step 7: Document the admin in the README**

Add a section covering: generating a password hash, the two new `.env` keys, `prisma migrate deploy` plus `prisma db seed` on first boot, and the `/admin` URL.

- [ ] **Step 8: Commit**

```bash
git add server docker-compose.yml docker-compose.override.yml docker-compose.prod.yml README.md
git commit -m "fix: close CORS and exposed-port findings

Removes wildcard CORS: both proxies make the API same-origin, so the
header only ever granted access to sites that should not have it.

Moves the Postgres and API port mappings to the dev-only override. In
production nginx is the single published surface; previously npm run prod
bound Postgres to the host with the password from .env.example."
```

---

## Self-Review

**Spec coverage:** §3.1 Task 2 · §3.2 Tasks 2, 17, 18 · §3.3 Task 2 · §3.4 Task 5 · §3.5 Task 4 · §4.1 Tasks 4-6 · §4.2 Tasks 11-12 · §4.3 Tasks 11, 7 · §4.4 Task 13 · §5.1-5.3 Task 9 · §5.2 Task 8 · §5.4 Tasks 13, 19 · §6 Tasks 14-18 · §7 Task 7 · §8 Task 3 · §9 Task 1 and throughout · §10 Tasks 1, 13, 19 · §11 spread across the tasks that need each package. No gaps.

**Known cross-task dependency:** Task 1 Step 4 creates `tests/helpers/db.ts` referencing tables that Task 2 introduces. Task 1 Step 4 says so and defers the file to Task 2 Step 4. Execute Task 1 Steps 1-3 and 5-11, then Task 2.

**Type consistency:** `resetDb`/`prisma` (Task 1) used identically in Tasks 2-13. `seed(client)` (Task 3) used in Tasks 4-6. `loginAgent()` (Task 9) used in Tasks 11-13. `parseLimit` (Task 4) reused in Task 6. `safeUrl` (Task 10) used in Tasks 11-12. `useResource` (Task 7) reused in Task 14. `Stats` shape identical in Tasks 5, 7, 18. `SETUP_ICONS` (Task 12) matches `setupIcons` in `icons.tsx`.
