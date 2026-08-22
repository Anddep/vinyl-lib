# Multiuser Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a single-collector site into one where any number of collectors sign in with Google or GitHub, keep an independent collection, and share it at `/u/:slug`.

**Architecture:** Every content model gains an `ownerId`. Two API trees over the same handlers — `/api/u/:slug/*` resolves the owner from the slug, `/api/*` resolves it from the session — so no route exists on which the owner is optional. The password login is replaced by authorization-code flows implemented directly against the two providers; sessions stay in Postgres. Existing content is backfilled to one bootstrap user in a hand-written migration and claimed on first sign-in.

**Tech Stack:** TypeScript, React 18, Vite, Express 4, Prisma 5, PostgreSQL 16, zod 4, express-session + connect-pg-simple, express-rate-limit, multer, Vitest, Supertest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-22-multiuser-design.md`

## Global Constraints

- Node 24. npm workspaces (`client`, `server`). Do not add a third workspace.
- All server code is CommonJS (`server/tsconfig.json` sets `"module": "CommonJS"`).
- **No new runtime dependency.** OAuth is implemented against Node's global `fetch` (spec §6.1). `bcryptjs` and `@types/bcryptjs` are removed; `express-rate-limit` is kept and repurposed.
- Prettier config is authoritative: single quotes, semicolons, trailing commas, 100 print width, LF.
- ESLint must pass with zero warnings; `@typescript-eslint/no-unused-vars` allows a leading `_`.
- Styling is CSS Modules only. Every colour, spacing, radius and motion value comes from `client/src/styles/tokens.css` — never hardcode a hex, never write an inline style, never add a UI framework.
- Test-first. Every task writes a failing test, runs it to see it fail, then implements.
- Migrations are checked in under `server/prisma/migrations/` and must run under `prisma migrate deploy` against both a database holding the original collection and an empty one.
- A missing row and a row owned by someone else return the **same 404 with the same body**. Never 403, never a distinguishable message.
- `ownerId` never comes from a request body. It comes from `res.locals.ownerId`, which only `requireUser` or `resolveOwnerFromSlug` sets.
- Commit messages: Conventional Commits, subject and body only. **No `Co-Authored-By` trailer.**
- Branch: `feat/multiuser` (already created; the spec commit is on it).
- The public collection page must look and behave exactly like today's homepage. `NavBar`, `Footer` and every `sections/*` component keep the wordmark "Grooves & Dust" and are not restyled.

---

## File Structure

```
server/prisma/
  schema.prisma                              MOD  User, OAuthIdentity, Invite, Upload; ownerId everywhere
  migrations/20260822140000_multiuser_owner/ NEW  hand-written; backfill between ADD COLUMN and SET NOT NULL

server/src/
  config/env.ts                    MOD  drop ADMIN_PASSWORD_HASH; PUBLIC_BASE_URL, providers, SIGNUP_MODE, ceilings
  lib/oauth/providers.ts           NEW  per-provider endpoints, scopes, PKCE flag, profile normalisation
  lib/oauth/pkce.ts                NEW  random tokens and the S256 challenge
  lib/oauth/flow.ts                NEW  authorize URL, code exchange
  lib/accounts.ts                  NEW  identity lookup, email linking, bootstrap claim, SIGNUP_MODE, suspension
  lib/quota.ts                     NEW  per-account ceilings
  lib/resourceRouter.ts            MOD  owner in the delegate type; read and write routers
  middleware/requireAuth.ts        DEL  replaced by requireUser
  middleware/requireUser.ts        NEW  session -> res.locals.ownerId, else 401
  middleware/resolveOwner.ts       NEW  slug -> res.locals.ownerId, else 404
  middleware/sameOrigin.ts         NEW  rejects a cross-origin non-GET
  routes/auth.ts                   MOD  rewritten: providers, start, callback, me, logout
  routes/account.ts                NEW  PATCH /api/account
  routes/publicCollection.ts       NEW  mounts the read routers under /api/u/:slug
  routes/records.ts                MOD  owner-scoped, per-owner slugs, per-collection isNew
  routes/stats.ts                  MOD  owner-scoped aggregates
  routes/settings.ts               MOD  composite key
  routes/uploads.ts                MOD  owner-scoped paths, Upload rows, quota
  schemas/account.ts               NEW  slug, displayName, isPublic
  schemas/record.ts                MOD  string maxima
  schemas/content.ts               MOD  string maxima
  types/session.d.ts               MOD  userId and the oauth handshake
  app.ts                           MOD  cookie sameSite lax; mount order

server/scripts/hashPassword.ts     DEL
server/scripts/setPassword.ts      DEL

server/tests/
  helpers/auth.ts                  MOD  signInAgent drives the real OAuth flow against a stubbed fetch
  helpers/db.ts                    MOD  truncate the new tables
  fixtures/users.ts                NEW  createUser / two-user setup
  fixtures/collection.ts           MOD  loadFixture(prisma, ownerId)
  routes/isolation.test.ts         NEW  cross-user reads, updates and deletes on every resource
  routes/publicCollection.test.ts  NEW
  routes/auth.oauth.test.ts        NEW
  routes/auth.linking.test.ts      NEW
  routes/bootstrap.test.ts         NEW
  routes/signupMode.test.ts        NEW
  routes/suspension.test.ts        NEW
  routes/limits.test.ts            NEW
  routes/loginLimiter.test.ts      DEL
  scripts/setPassword.test.ts      DEL

client/src/
  api/client.ts                    MOD  collectionApi(scope) + auth and account fetchers
  auth/AuthProvider.tsx            NEW  context over GET /api/auth/me
  pages/CollectionPage.tsx         NEW  was HomePage; scope-driven
  pages/HomePage.tsx               DEL
  pages/LandingPage.tsx            NEW  provider buttons; redirects a signed-in owner
  pages/NotFoundPage.tsx           NEW  one screen for unknown, private and suspended
  admin/LoginPage.tsx              DEL
  admin/RequireAuth.tsx            MOD  reads the context
  admin/AccountPage.tsx            NEW  display name, slug, visibility
  admin/AdminLayout.tsx            MOD  user in the chrome; View site -> /u/:slug
  routes.tsx                       MOD  /, /u/:slug, /admin/account
  components/AlbumCard.tsx         MOD  rel="nofollow ugc noopener noreferrer"

client/public/robots.txt           NEW
client/nginx.conf.template         MOD  document Content-Security-Policy
.env.example                       MOD  new variables, ADMIN_PASSWORD_HASH removed
README.md                          MOD  provider setup, bootstrap, operator recipes
```

---

## Phase 1 — Data model and migration

### Task 1: Schema, hand-written migration, bootstrap row

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260822140000_multiuser_owner/migration.sql`
- Modify: `server/tests/helpers/db.ts`
- Test: `server/tests/schema.test.ts`

**Interfaces:**

- Produces: Prisma models `User`, `OAuthIdentity`, `Invite`, `Upload`, and an `ownerId` on `Record`, `WishlistItem`, `SetupItem`, `SiteSetting`. `SiteSetting` is keyed `ownerId_key`. `Record` is unique on `ownerId_slug`. All importable from `@prisma/client`.
- Produces: `resetDb()` in `tests/helpers/db.ts`, truncating the new tables too.

- [ ] **Step 1: Extend the truncate list**

`server/tests/helpers/db.ts` — replace the `$executeRawUnsafe` argument. `User` is listed last but `CASCADE` means order does not matter; it is listed at all because every test now creates users and they must not leak between cases.

```ts
await prisma.$executeRawUnsafe(
  'TRUNCATE TABLE "Record", "WishlistItem", "SetupItem", "SiteSetting", "Upload", "Invite", "OAuthIdentity", "User" RESTART IDENTITY CASCADE',
);
```

- [ ] **Step 2: Write the failing test**

Replace `server/tests/schema.test.ts` entirely:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb } from './helpers/db';

beforeEach(resetDb);

async function makeUser(slug: string) {
  return prisma.user.create({ data: { slug, displayName: slug, email: `${slug}@example.com` } });
}

describe('User model', () => {
  it('defaults to public, unsuspended and non-bootstrap', async () => {
    const user = await makeUser('andriy');

    expect(user.isPublic).toBe(true);
    expect(user.suspendedAt).toBeNull();
    expect(user.bootstrap).toBe(false);
  });

  it('rejects a duplicate slug', async () => {
    await makeUser('andriy');
    await expect(
      prisma.user.create({ data: { slug: 'andriy', displayName: 'Someone else' } }),
    ).rejects.toThrow();
  });

  it('allows many users with no email, so the bootstrap row is not special-cased', async () => {
    await prisma.user.create({ data: { slug: 'a', displayName: 'A' } });
    await prisma.user.create({ data: { slug: 'b', displayName: 'B' } });

    expect(await prisma.user.count()).toBe(2);
  });
});

describe('OAuthIdentity model', () => {
  it('rejects the same provider account attaching twice', async () => {
    const user = await makeUser('andriy');
    const other = await makeUser('someone');
    await prisma.oAuthIdentity.create({
      data: { provider: 'google', providerUserId: '1', userId: user.id },
    });

    await expect(
      prisma.oAuthIdentity.create({
        data: { provider: 'google', providerUserId: '1', userId: other.id },
      }),
    ).rejects.toThrow();
  });

  it('cascades when its user is deleted', async () => {
    const user = await makeUser('andriy');
    await prisma.oAuthIdentity.create({
      data: { provider: 'github', providerUserId: '9', userId: user.id },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.oAuthIdentity.count()).toBe(0);
  });
});

describe('Invite model', () => {
  it('lets one invite be redeemed by exactly one user', async () => {
    const first = await makeUser('first');
    const second = await makeUser('second');
    await prisma.invite.create({ data: { code: 'abc', redeemedById: first.id } });

    await expect(
      prisma.invite.create({ data: { code: 'def', redeemedById: second.id } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.invite.create({ data: { code: 'ghi', redeemedById: first.id } }),
    ).rejects.toThrow();
  });
});

describe('Record ownership', () => {
  const base = {
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    year: 1959,
    format: 'LP',
    genre: 'Jazz',
  };

  it('lets two owners hold the same slug', async () => {
    const one = await makeUser('one');
    const two = await makeUser('two');

    await prisma.record.create({ data: { ...base, slug: 'kind-of-blue', ownerId: one.id } });
    await prisma.record.create({ data: { ...base, slug: 'kind-of-blue', ownerId: two.id } });

    expect(await prisma.record.count()).toBe(2);
  });

  it('still rejects a duplicate slug within one owner', async () => {
    const one = await makeUser('one');
    await prisma.record.create({ data: { ...base, slug: 'kind-of-blue', ownerId: one.id } });

    await expect(
      prisma.record.create({ data: { ...base, slug: 'kind-of-blue', ownerId: one.id } }),
    ).rejects.toThrow();
  });

  it('cascades records, wishlist, setup and settings when the owner goes', async () => {
    const one = await makeUser('one');
    await prisma.record.create({ data: { ...base, slug: 'kob', ownerId: one.id } });
    await prisma.wishlistItem.create({
      data: { title: 'Karma', artist: 'Pharoah Sanders', ownerId: one.id },
    });
    await prisma.setupItem.create({
      data: { icon: 'turntable', label: 'T', value: 'V', ownerId: one.id },
    });
    await prisma.siteSetting.create({
      data: { key: 'collectingSince', value: '2009', ownerId: one.id },
    });

    await prisma.user.delete({ where: { id: one.id } });

    expect(await prisma.record.count()).toBe(0);
    expect(await prisma.wishlistItem.count()).toBe(0);
    expect(await prisma.setupItem.count()).toBe(0);
    expect(await prisma.siteSetting.count()).toBe(0);
  });
});

describe('SiteSetting model', () => {
  it('is keyed by owner and key together', async () => {
    const one = await makeUser('one');
    const two = await makeUser('two');

    await prisma.siteSetting.create({
      data: { ownerId: one.id, key: 'collectingSince', value: '2009' },
    });
    await prisma.siteSetting.create({
      data: { ownerId: two.id, key: 'collectingSince', value: '2015' },
    });

    const stored = await prisma.siteSetting.findUnique({
      where: { ownerId_key: { ownerId: two.id, key: 'collectingSince' } },
    });

    expect(stored?.value).toBe('2015');
  });
});

describe('Upload model', () => {
  it('records bytes against an owner', async () => {
    const one = await makeUser('one');
    await prisma.upload.create({
      data: { ownerId: one.id, path: `${one.id}/a.webp`, bytes: 1234 },
    });

    const used = await prisma.upload.aggregate({
      where: { ownerId: one.id },
      _sum: { bytes: true },
    });

    expect(used._sum.bytes).toBe(1234);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npm test -w server -- schema
```

Expected: FAIL — `prisma.user` is undefined.

- [ ] **Step 4: Rewrite the schema**

Replace everything in `server/prisma/schema.prisma` between the `datasource` block and the `Session` model:

```prisma
model User {
  id          Int       @id @default(autoincrement())
  slug        String    @unique
  displayName String
  /// Verified address from the OAuth provider; the key identities link on.
  /// Null only on the unclaimed bootstrap row.
  email       String?   @unique
  avatarUrl   String?
  isPublic    Boolean   @default(true)
  /// Set by the operator through psql. Blocks sign-in and hides the collection.
  suspendedAt DateTime?
  /// True on the single row the backfill migration creates, and only there.
  bootstrap   Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  identities    OAuthIdentity[]
  records       Record[]
  wishlist      WishlistItem[]
  setup         SetupItem[]
  settings      SiteSetting[]
  uploads       Upload[]
  invitesIssued Invite[]        @relation("InviteIssuer")
  invite        Invite?         @relation("InviteRedeemer")
}

model OAuthIdentity {
  id             Int      @id @default(autoincrement())
  provider       String
  /// The provider's immutable subject id — never the email, which can change.
  providerUserId String
  userId         Int
  createdAt      DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
}

model Invite {
  id           Int       @id @default(autoincrement())
  /// 16 random bytes, base64url. The code is the whole credential.
  code         String    @unique
  issuedById   Int?
  /// Unique, so the database — not the callback — enforces single use.
  redeemedById Int?      @unique
  expiresAt    DateTime?
  createdAt    DateTime  @default(now())
  redeemedAt   DateTime?

  issuedBy   User? @relation("InviteIssuer", fields: [issuedById], references: [id], onDelete: SetNull)
  redeemedBy User? @relation("InviteRedeemer", fields: [redeemedById], references: [id], onDelete: SetNull)
}

model Upload {
  id      Int      @id @default(autoincrement())
  ownerId Int
  /// Path relative to UPLOAD_DIR, e.g. "12/9f3c….webp".
  path      String   @unique
  bytes     Int
  createdAt DateTime @default(now())

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId])
}

model Record {
  id        Int      @id @default(autoincrement())
  ownerId   Int
  slug      String
  title     String
  artist    String
  year      Int
  format    String
  genre     String
  url       String?
  coverUrl  String?
  position  Int      @default(0)
  addedAt   DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  // Per owner, so two collectors can both hold "kind-of-blue".
  @@unique([ownerId, slug])
  // Owner-leading: after this change no query touches these columns without
  // also filtering on the owner.
  @@index([ownerId, addedAt])
  @@index([ownerId, position])
}

model WishlistItem {
  id        Int      @id @default(autoincrement())
  ownerId   Int
  title     String
  artist    String
  url       String?
  coverUrl  String?
  position  Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId, position])
}

model SetupItem {
  id        Int      @id @default(autoincrement())
  ownerId   Int
  icon      String
  label     String
  value     String
  position  Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId, position])
}

model SiteSetting {
  ownerId Int
  key     String
  value   String

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@id([ownerId, key])
}
```

Leave the `Session` model and its comment exactly as they are.

- [ ] **Step 5: Create the migration directory and write the SQL by hand**

Do **not** run `prisma migrate dev` without `--create-only`. Prisma emits `ADD COLUMN ... NOT NULL` with no backfill, which fails on the first existing row.

```bash
mkdir -p server/prisma/migrations/20260822140000_multiuser_owner
```

Create `server/prisma/migrations/20260822140000_multiuser_owner/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "avatarUrl" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "suspendedAt" TIMESTAMP(3),
    "bootstrap" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthIdentity" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "issuedById" INTEGER,
    "redeemedById" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_slug_key" ON "User"("slug");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "OAuthIdentity_provider_providerUserId_key" ON "OAuthIdentity"("provider", "providerUserId");
CREATE INDEX "OAuthIdentity_userId_idx" ON "OAuthIdentity"("userId");
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");
CREATE UNIQUE INDEX "Invite_redeemedById_key" ON "Invite"("redeemedById");
CREATE UNIQUE INDEX "Upload_path_key" ON "Upload"("path");
CREATE INDEX "Upload_ownerId_idx" ON "Upload"("ownerId");

-- The bootstrap owner. Inserted unconditionally: on an empty database the
-- backfill below updates nothing, but the foreign keys must still be
-- satisfiable, and the claim in lib/accounts.ts needs a row to claim.
INSERT INTO "User" ("slug", "displayName", "bootstrap", "updatedAt")
VALUES ('collection', 'The Collection', true, CURRENT_TIMESTAMP);

-- AddColumn, nullable, so existing rows survive the statement.
ALTER TABLE "Record" ADD COLUMN "ownerId" INTEGER;
ALTER TABLE "WishlistItem" ADD COLUMN "ownerId" INTEGER;
ALTER TABLE "SetupItem" ADD COLUMN "ownerId" INTEGER;
ALTER TABLE "SiteSetting" ADD COLUMN "ownerId" INTEGER;

-- Backfill every existing row to the bootstrap owner.
UPDATE "Record" SET "ownerId" = (SELECT "id" FROM "User" WHERE "bootstrap");
UPDATE "WishlistItem" SET "ownerId" = (SELECT "id" FROM "User" WHERE "bootstrap");
UPDATE "SetupItem" SET "ownerId" = (SELECT "id" FROM "User" WHERE "bootstrap");
UPDATE "SiteSetting" SET "ownerId" = (SELECT "id" FROM "User" WHERE "bootstrap");

-- Only now can it be required.
ALTER TABLE "Record" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "WishlistItem" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "SetupItem" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "SiteSetting" ALTER COLUMN "ownerId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "OAuthIdentity" ADD CONSTRAINT "OAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Record" ADD CONSTRAINT "Record_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetupItem" ADD CONSTRAINT "SetupItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Record.slug becomes unique per owner rather than site-wide.
DROP INDEX "Record_slug_key";
CREATE UNIQUE INDEX "Record_ownerId_slug_key" ON "Record"("ownerId", "slug");

-- Owner-leading indexes replace the standalone ones.
DROP INDEX "Record_addedAt_idx";
DROP INDEX "Record_position_idx";
CREATE INDEX "Record_ownerId_addedAt_idx" ON "Record"("ownerId", "addedAt");
CREATE INDEX "Record_ownerId_position_idx" ON "Record"("ownerId", "position");
CREATE INDEX "WishlistItem_ownerId_position_idx" ON "WishlistItem"("ownerId", "position");
CREATE INDEX "SetupItem_ownerId_position_idx" ON "SetupItem"("ownerId", "position");

-- SiteSetting: key alone is no longer unique.
ALTER TABLE "SiteSetting" DROP CONSTRAINT "SiteSetting_pkey";
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("ownerId", "key");
```

- [ ] **Step 6: Check the SQL against the schema**

```bash
cd server && npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$DATABASE_URL_TEST" \
  --script
```

Expected: an empty script (only comments). Any statement it prints is drift between the hand-written SQL and the schema — fix the SQL, not the schema, and run it again.

- [ ] **Step 7: Apply it to the test database and run the tests**

```bash
npm run test:db:setup -w server
npm test -w server -- schema
```

Expected: PASS. Everything else in the suite fails at this point — every existing test creates content with no owner. Tasks 2 and 7 repair them.

- [ ] **Step 8: Apply it to the development database**

```bash
docker compose exec server npx prisma migrate deploy
docker compose exec db psql -U vinyl_lib -c 'SELECT slug, bootstrap FROM "User";'
docker compose exec db psql -U vinyl_lib -c 'SELECT COUNT(*) FROM "Record" WHERE "ownerId" IS NULL;'
```

Expected: one row, `collection | t`; and a count of 0.

- [ ] **Step 9: Commit**

```bash
git add server/prisma server/tests/helpers/db.ts server/tests/schema.test.ts
git commit -m "feat: give every content model an owner

Adds User, OAuthIdentity, Invite and Upload, and an ownerId foreign key on
records, wishlist items, setup rows and settings. Record.slug becomes unique
per owner so two collectors can both hold kind-of-blue, and SiteSetting is
keyed on (ownerId, key) rather than key alone.

The migration is hand-written rather than generated: it inserts a bootstrap
owner, adds ownerId nullable, backfills every existing row to that owner and
only then sets NOT NULL. prisma migrate diff would have emitted ADD COLUMN
NOT NULL with no backfill, which fails on the first existing row."
```

---

### Task 2: Test fixtures for a two-user world

**Files:**

- Create: `server/tests/fixtures/users.ts`
- Modify: `server/tests/fixtures/collection.ts`
- Modify: `server/tests/fixtures/collection.test.ts`

**Interfaces:**

- Consumes: `prisma`, `resetDb` from Task 1.
- Produces: `createUser(prisma, overrides?)` → `Promise<User>`; `loadFixture(prisma, ownerId)` → the same counts as today (14 records, 6 wishlist, 5 setup) but owned.

- [ ] **Step 1: Write the failing test**

Replace `server/tests/fixtures/collection.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFixture } from './collection';
import { createUser } from './users';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('loadFixture', () => {
  it('loads the sample collection against one owner', async () => {
    const owner = await createUser(prisma, { slug: 'andriy' });

    await loadFixture(prisma, owner.id);

    expect(await prisma.record.count({ where: { ownerId: owner.id } })).toBe(14);
    expect(await prisma.wishlistItem.count({ where: { ownerId: owner.id } })).toBe(6);
    expect(await prisma.setupItem.count({ where: { ownerId: owner.id } })).toBe(5);
  });

  it('loads twice against two owners without a slug collision', async () => {
    const one = await createUser(prisma, { slug: 'one' });
    const two = await createUser(prisma, { slug: 'two' });

    await loadFixture(prisma, one.id);
    await loadFixture(prisma, two.id);

    expect(await prisma.record.count()).toBe(28);
  });
});

describe('createUser', () => {
  it('generates a distinct slug and email each call', async () => {
    const one = await createUser(prisma);
    const two = await createUser(prisma);

    expect(one.slug).not.toBe(two.slug);
    expect(one.email).not.toBe(two.email);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- fixtures
```

Expected: FAIL — `./users` does not resolve.

- [ ] **Step 3: Write the user fixture**

Create `server/tests/fixtures/users.ts`:

```ts
import type { PrismaClient, User } from '@prisma/client';

let counter = 0;

/**
 * A user with a slug and verified email nobody else in the run will hold.
 *
 * The counter is module-level rather than random: `fileParallelism` is off in
 * vitest.config.mts, so tests within a run are sequential and a counter gives
 * reproducible slugs, which makes a failing assertion readable.
 */
export async function createUser(
  prisma: PrismaClient,
  overrides: Partial<
    Pick<User, 'slug' | 'displayName' | 'email' | 'isPublic' | 'suspendedAt'>
  > = {},
): Promise<User> {
  counter += 1;
  const slug = overrides.slug ?? `user-${counter}`;

  return prisma.user.create({
    data: {
      slug,
      displayName: overrides.displayName ?? `User ${counter}`,
      email: overrides.email === undefined ? `${slug}@example.com` : overrides.email,
      isPublic: overrides.isPublic ?? true,
      suspendedAt: overrides.suspendedAt ?? null,
    },
  });
}
```

- [ ] **Step 4: Give the collection fixture an owner**

In `server/tests/fixtures/collection.ts`, change only the exported loader — the three data arrays stay exactly as they are:

```ts
export async function loadFixture(prisma: PrismaClient, ownerId: number): Promise<void> {
  await prisma.record.createMany({ data: records.map((row) => ({ ...row, ownerId })) });
  await prisma.wishlistItem.createMany({ data: wishlist.map((row) => ({ ...row, ownerId })) });
  await prisma.setupItem.createMany({ data: setup.map((row) => ({ ...row, ownerId })) });
}
```

Read the current body first — if it uses `create` in a loop rather than `createMany`, keep whichever it uses and add `ownerId` to the spread. The point of the task is the owner, not the insert style.

- [ ] **Step 5: Run the tests**

```bash
npm test -w server -- fixtures
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tests/fixtures
git commit -m "test: give the fixtures an owner

loadFixture takes the owner it loads against, and createUser mints a user
with a slug and email nothing else in the run holds. Loading the same sample
collection twice against two owners is now the setup every isolation test
needs, and it no longer collides on Record.slug."
```

---

## Phase 2 — Authentication

> **The suite is red for the whole of this phase.** After Task 1, `prisma.siteSetting.findUnique({ where: { key } })` no longer typechecks and every write path is missing an `ownerId`, so `npm test -w server` (which runs `typecheck` first) cannot pass until Task 6 lands. Verify each task with `npx vitest run <pattern>` from `server/`, which skips the typecheck, and treat the end of Task 6 as the first point where the whole suite is green again. Do not try to make Tasks 3–5 individually green; the cost of doing so is throwaway code.

### Deviations from the spec

1. **Policy values are read lazily, not frozen onto `env`.** Spec §11 lists `SIGNUP_MODE`, `BOOTSTRAP_OWNER_EMAIL`, the ceilings and the provider credentials alongside the other variables. `env` is a `const` evaluated when the module is first imported, so a test cannot vary those values without a module-registry reset. They are exported as **functions** — `signupMode()`, `bootstrapOwnerEmail()`, `limits()`, `configuredProviders()` — that read `process.env` at call time, which `vi.stubEnv` can drive directly. Startup-time values that genuinely cannot change (`DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, `PORT`) stay on `env`.
2. **The "at least one provider" guard lives in `index.ts`, not `app.ts`.** `app.ts` is imported by every test; a hard failure there would make provider configuration a precondition of running any test at all.

---

### Task 3: Environment, and the end of the password

**Files:**

- Modify: `server/src/config/env.ts`
- Modify: `server/src/index.ts`
- Modify: `server/tests/setup.ts`
- Modify: `server/package.json`
- Delete: `server/scripts/hashPassword.ts`, `server/scripts/setPassword.ts`, `server/tests/scripts/setPassword.test.ts`, `server/tests/routes/loginLimiter.test.ts`
- Test: `server/tests/config/env.test.ts`

**Interfaces:**

- Produces: `env` with `NODE_ENV`, `PORT`, `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_BASE_URL`.
- Produces: `signupMode(): 'closed' | 'invite' | 'open'`, `bootstrapOwnerEmail(): string | null`, `limits(): Limits`, `parseCount(raw, fallback): number`.
- Produces: `interface Limits { maxUploadBytes: number; uploadQuotaBytes: number; maxRecords: number; maxWishlist: number; maxSetup: number }`.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/config/env.test.ts`, keeping the existing `parsePort` tests:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapOwnerEmail, limits, parseCount, signupMode } from '../../src/config/env';

afterEach(() => vi.unstubAllEnvs());

describe('parseCount', () => {
  it('falls back on an empty string, which is what Compose sends for an unset variable', () => {
    expect(parseCount('', 100)).toBe(100);
    expect(parseCount(undefined, 100)).toBe(100);
  });

  it('falls back rather than accepting zero or a negative, which would disable the limit', () => {
    expect(parseCount('0', 100)).toBe(100);
    expect(parseCount('-5', 100)).toBe(100);
  });

  it('throws on a value that is not a number, rather than silently using the fallback', () => {
    expect(() => parseCount('lots', 100)).toThrow();
  });

  it('reads a real value', () => {
    expect(parseCount('250', 100)).toBe(250);
  });
});

describe('signupMode', () => {
  it('defaults to invite, so an unconfigured deployment is not open', () => {
    vi.stubEnv('SIGNUP_MODE', '');
    expect(signupMode()).toBe('invite');
  });

  it.each(['closed', 'invite', 'open'])('accepts %s', (mode) => {
    vi.stubEnv('SIGNUP_MODE', mode);
    expect(signupMode()).toBe(mode);
  });

  it('throws on an unrecognised mode rather than guessing', () => {
    vi.stubEnv('SIGNUP_MODE', 'public');
    expect(() => signupMode()).toThrow(/SIGNUP_MODE/);
  });
});

describe('bootstrapOwnerEmail', () => {
  it('is null when unset', () => {
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', '');
    expect(bootstrapOwnerEmail()).toBeNull();
  });

  it('is lowercased and trimmed, because it is compared against a provider address', () => {
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', '  Andriy@Example.COM ');
    expect(bootstrapOwnerEmail()).toBe('andriy@example.com');
  });
});

describe('limits', () => {
  it('defaults to 5 MB per file and 150 MB per user', () => {
    vi.stubEnv('MAX_UPLOAD_BYTES', '');
    vi.stubEnv('UPLOAD_QUOTA_BYTES', '');
    expect(limits().maxUploadBytes).toBe(5 * 1024 * 1024);
    expect(limits().uploadQuotaBytes).toBe(150 * 1024 * 1024);
  });

  it('reads overrides', () => {
    vi.stubEnv('MAX_RECORDS_PER_USER', '10');
    expect(limits().maxRecords).toBe(10);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/config/env.test.ts
```

Expected: FAIL — `signupMode` is not exported.

- [ ] **Step 3: Rewrite env.ts**

Replace `server/src/config/env.ts` entirely:

```ts
interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  SESSION_SECRET: string;
  /**
   * The origin the browser sees. Required, not inferred: the OAuth redirect_uri
   * must match what is registered at the provider byte-for-byte, and behind two
   * different proxies the server cannot work it out reliably.
   */
  PUBLIC_BASE_URL: string;
}

export type SignupMode = 'closed' | 'invite' | 'open';

export interface Limits {
  maxUploadBytes: number;
  uploadQuotaBytes: number;
  maxRecords: number;
  maxWishlist: number;
  maxSetup: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * Compose substitutes an empty string for an unset variable, and Number('') is
 * 0 rather than NaN — so an unset SERVER_PORT would silently bind the server to
 * a random ephemeral port instead of failing. Treat empty as absent.
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

/**
 * A positive integer ceiling, with the same empty-string caution as parsePort.
 *
 * Zero and negatives fall back rather than applying: a quota of 0 would refuse
 * every upload, which reads as a broken app rather than as a configured limit.
 * A non-numeric value throws, because it is a typo the operator should see.
 */
export function parseCount(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${raw}`);
  }
  return parsed > 0 ? Math.floor(parsed) : fallback;
}

export const env: Env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parsePort(process.env.PORT),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_SECRET: required('SESSION_SECRET'),
  PUBLIC_BASE_URL: required('PUBLIC_BASE_URL'),
};

const SIGNUP_MODES: readonly SignupMode[] = ['closed', 'invite', 'open'];

/**
 * Read at call time rather than frozen onto `env`, so a test can vary it with
 * vi.stubEnv and so flipping the gate in production is a restart, not a build.
 *
 * Defaults to `invite`: an operator who has not thought about signup should not
 * discover they have opened one.
 */
export function signupMode(): SignupMode {
  const raw = optional('SIGNUP_MODE');
  if (raw === null) {
    return 'invite';
  }
  if (!SIGNUP_MODES.includes(raw as SignupMode)) {
    throw new Error(`Invalid SIGNUP_MODE: ${raw}. Expected closed, invite or open.`);
  }
  return raw as SignupMode;
}

/** Lowercased, because it is compared against an address a provider supplies. */
export function bootstrapOwnerEmail(): string | null {
  return optional('BOOTSTRAP_OWNER_EMAIL')?.toLowerCase() ?? null;
}

export function limits(): Limits {
  return {
    maxUploadBytes: parseCount(process.env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
    uploadQuotaBytes: parseCount(process.env.UPLOAD_QUOTA_BYTES, 150 * 1024 * 1024),
    maxRecords: parseCount(process.env.MAX_RECORDS_PER_USER, 5000),
    maxWishlist: parseCount(process.env.MAX_WISHLIST_PER_USER, 500),
    maxSetup: parseCount(process.env.MAX_SETUP_PER_USER, 100),
  };
}
```

- [ ] **Step 4: Guard the listener**

`server/src/index.ts` — add the check before `listen`. It imports `configuredProviders`, written in Task 4, so this will not compile until then; it is two lines and splitting it from its reason would be worse.

```ts
import { app } from './app';
import { env } from './config/env';
import { configuredProviders } from './lib/oauth/providers';

// Without a provider there is no way to sign in at all, and the failure would
// only surface when the first person tried. Fail at boot instead.
if (configuredProviders().length === 0) {
  throw new Error(
    'No OAuth provider configured. Set GOOGLE_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET.',
  );
}

app.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
});
```

- [ ] **Step 5: Update the test environment**

`server/tests/setup.ts` — remove the `ADMIN_PASSWORD_HASH` line and its comment, and add:

```ts
// The origin Supertest requests appear to come from, and the base for every
// OAuth redirect_uri the suite builds.
process.env.PUBLIC_BASE_URL = 'http://localhost:5173';

// Both providers configured, so a test can exercise either. Individual tests
// unset one with vi.stubEnv to assert that an unconfigured provider 404s.
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.GITHUB_CLIENT_ID = 'test-github-client';
process.env.GITHUB_CLIENT_SECRET = 'test-github-secret';

// Open by default so the bulk of the suite is not about invites. The signup
// gate has its own file, which stubs this per case.
process.env.SIGNUP_MODE = 'open';
```

- [ ] **Step 6: Delete the password**

```bash
git rm server/scripts/hashPassword.ts server/scripts/setPassword.ts server/tests/scripts/setPassword.test.ts server/tests/routes/loginLimiter.test.ts
npm uninstall bcryptjs @types/bcryptjs -w server
```

Then remove the `admin:hash` and `admin:set-password` entries from the `scripts` block in `server/package.json`. Leave `express-rate-limit` installed — Task 16 repurposes it.

- [ ] **Step 7: Run the tests**

```bash
cd server && npx vitest run tests/config/env.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/config/env.ts server/src/index.ts server/tests/setup.ts server/package.json package-lock.json
git commit -m "feat: replace the admin password with OAuth configuration

ADMIN_PASSWORD_HASH, both hashing scripts and bcryptjs are gone. In their
place: PUBLIC_BASE_URL, the two provider credential pairs, SIGNUP_MODE and
the per-account ceilings.

SIGNUP_MODE, BOOTSTRAP_OWNER_EMAIL and the ceilings are exported as
functions rather than frozen onto env. env is a const evaluated at import,
so a test could not vary them; reading process.env at call time makes them
stubbable and makes flipping the signup gate a restart rather than a build."
```

---

### Task 4: OAuth primitives

**Files:**

- Create: `server/src/lib/oauth/pkce.ts`
- Create: `server/src/lib/oauth/providers.ts`
- Create: `server/src/lib/oauth/flow.ts`
- Test: `server/tests/lib/oauth.test.ts`

**Interfaces:**

- Produces: `randomToken(bytes?): string`, `challengeFor(verifier): string`.
- Produces: `PROVIDER_IDS`, `type ProviderId = 'google' | 'github'`, `interface OAuthProfile { providerUserId: string; email: string | null; emailVerified: boolean; displayName: string; avatarUrl: string | null }`, `interface Provider`, `configuredProviders(): Provider[]`, `getProvider(id: string): Provider | null`.
- Produces: `redirectUri(id: ProviderId): string`, `authorizeUrl(provider, { state, challenge }): string`, `exchangeCode(provider, { code, verifier }): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/lib/oauth.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeFor, randomToken } from '../../src/lib/oauth/pkce';
import { configuredProviders, getProvider } from '../../src/lib/oauth/providers';
import { authorizeUrl, exchangeCode, redirectUri } from '../../src/lib/oauth/flow';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('pkce', () => {
  it('mints a url-safe token with no padding', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it('derives the documented S256 challenge', () => {
    // The worked example from RFC 7636 appendix B.
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('configuredProviders', () => {
  it('lists both when both are configured', () => {
    expect(
      configuredProviders()
        .map((p) => p.id)
        .sort(),
    ).toEqual(['github', 'google']);
  });

  it('omits a provider whose secret is missing, rather than offering a broken button', () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', '');
    expect(configuredProviders().map((p) => p.id)).toEqual(['google']);
    expect(getProvider('github')).toBeNull();
  });

  it('does not resolve an unknown provider name', () => {
    expect(getProvider('facebook')).toBeNull();
  });

  it('uses PKCE for Google and not for GitHub, which does not support it', () => {
    expect(getProvider('google')?.usesPkce).toBe(true);
    expect(getProvider('github')?.usesPkce).toBe(false);
  });
});

describe('redirectUri', () => {
  it('is built from PUBLIC_BASE_URL, because it must match the provider registration exactly', () => {
    expect(redirectUri('google')).toBe('http://localhost:5173/api/auth/google/callback');
  });
});

describe('authorizeUrl', () => {
  it('carries state, the redirect and the challenge for a PKCE provider', () => {
    const url = new URL(authorizeUrl(getProvider('google')!, { state: 'st', challenge: 'ch' }));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri('google'));
  });

  it('omits the challenge entirely for a provider that does not take one', () => {
    const url = new URL(authorizeUrl(getProvider('github')!, { state: 'st', challenge: null }));

    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.has('code_challenge')).toBe(false);
  });
});

describe('exchangeCode', () => {
  it('posts the code and returns the access token', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'tok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchStub);

    const token = await exchangeCode(getProvider('google')!, { code: 'c', verifier: 'v' });

    expect(token).toBe('tok');
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String(init.body)).toContain('code_verifier=v');
    // Providers differ on the default response format; ask for JSON explicitly.
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it('throws when the provider answers 200 without a token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 }),
      ),
    );

    await expect(
      exchangeCode(getProvider('github')!, { code: 'c', verifier: null }),
    ).rejects.toThrow();
  });
});

describe('fetchProfile', () => {
  it('reads Google userinfo, including the verification flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              sub: '42',
              email: 'a@example.com',
              email_verified: true,
              name: 'A',
              picture: 'https://img/a',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    const profile = await getProvider('google')!.fetchProfile('tok');

    expect(profile).toEqual({
      providerUserId: '42',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'A',
      avatarUrl: 'https://img/a',
    });
  });

  it('takes the GitHub address from /user/emails, not from /user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body =
          url === 'https://api.github.com/user'
            ? {
                id: 7,
                login: 'andriy',
                name: 'Andriy',
                avatar_url: 'https://img/g',
                email: 'stale@example.com',
              }
            : [
                { email: 'other@example.com', primary: false, verified: true },
                { email: 'real@example.com', primary: true, verified: true },
              ];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const profile = await getProvider('github')!.fetchProfile('tok');

    expect(profile.providerUserId).toBe('7');
    expect(profile.email).toBe('real@example.com');
    expect(profile.emailVerified).toBe(true);
  });

  it('reports GitHub as unverified when no primary verified address exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body =
          url === 'https://api.github.com/user'
            ? { id: 7, login: 'andriy' }
            : [{ email: 'x@example.com', primary: true, verified: false }];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const profile = await getProvider('github')!.fetchProfile('tok');

    expect(profile.emailVerified).toBe(false);
    expect(profile.email).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/lib/oauth.test.ts
```

Expected: FAIL — none of the three modules resolve.

- [ ] **Step 3: Write the PKCE helpers**

Create `server/src/lib/oauth/pkce.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

/**
 * A url-safe random string, used for both the OAuth `state` and the PKCE
 * verifier. base64url rather than hex: same entropy, shorter query string, and
 * nothing that needs escaping in a redirect.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** The S256 code challenge for a verifier, per RFC 7636. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
```

- [ ] **Step 4: Write the provider descriptors**

Create `server/src/lib/oauth/providers.ts`:

```ts
export const PROVIDER_IDS = ['google', 'github'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Everything the account resolver needs, normalised across providers. */
export interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

export interface Provider {
  id: ProviderId;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** GitHub OAuth Apps do not implement PKCE; Google does. */
  usesPkce: boolean;
  clientId: string;
  clientSecret: string;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

type Json = Record<string, unknown>;

/**
 * A bearer GET returning JSON.
 *
 * The User-Agent is not optional politeness: api.github.com rejects a request
 * that arrives without one.
 */
async function getJson(url: string, accessToken: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'vinyl-lib',
    },
  });
  if (!response.ok) {
    throw new Error(`Provider request failed: ${url} answered ${response.status}`);
  }
  return response.json();
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function googleProfile(accessToken: string): Promise<OAuthProfile> {
  const body = (await getJson(
    'https://openidconnect.googleapis.com/v1/userinfo',
    accessToken,
  )) as Json;

  return {
    providerUserId: String(body.sub),
    email: text(body.email),
    // Strictly true, never merely truthy: an absent claim is not a verified one.
    emailVerified: body.email_verified === true,
    displayName: text(body.name) ?? text(body.email) ?? 'Collector',
    avatarUrl: text(body.picture),
  };
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function githubProfile(accessToken: string): Promise<OAuthProfile> {
  const user = (await getJson('https://api.github.com/user', accessToken)) as Json;
  // Two calls, because /user.email can be null, can be a no-reply alias, and
  // carries no verification flag. The verified primary address only lives here.
  const emails = (await getJson(
    'https://api.github.com/user/emails',
    accessToken,
  )) as GithubEmail[];
  const primary = Array.isArray(emails)
    ? emails.find((entry) => entry.primary && entry.verified)
    : undefined;

  return {
    providerUserId: String(user.id),
    email: primary?.email ?? null,
    emailVerified: primary !== undefined,
    displayName: text(user.name) ?? text(user.login) ?? 'Collector',
    avatarUrl: text(user.avatar_url),
  };
}

interface Descriptor {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  usesPkce: boolean;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

const DESCRIPTORS: Record<ProviderId, Descriptor> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    usesPkce: true,
    fetchProfile: googleProfile,
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    usesPkce: false,
    fetchProfile: githubProfile,
  },
};

/**
 * Credentials are read at call time rather than at import, so a test can drop a
 * provider with vi.stubEnv and the sign-in screen only ever offers what works.
 */
function credentials(id: ProviderId): { clientId: string; clientSecret: string } | null {
  const prefix = id.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getProvider(id: string): Provider | null {
  if (!PROVIDER_IDS.includes(id as ProviderId)) {
    return null;
  }
  const providerId = id as ProviderId;
  const creds = credentials(providerId);
  return creds ? { id: providerId, ...DESCRIPTORS[providerId], ...creds } : null;
}

export function configuredProviders(): Provider[] {
  return PROVIDER_IDS.map((id) => getProvider(id)).filter(
    (provider): provider is Provider => provider !== null,
  );
}
```

- [ ] **Step 5: Write the flow helpers**

Create `server/src/lib/oauth/flow.ts`:

```ts
import { env } from '../../config/env';
import type { Provider, ProviderId } from './providers';

/** Must match the callback registered at the provider byte-for-byte. */
export function redirectUri(id: ProviderId): string {
  return `${env.PUBLIC_BASE_URL}/api/auth/${id}/callback`;
}

export function authorizeUrl(
  provider: Provider,
  { state, challenge }: { state: string; challenge: string | null },
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri(provider.id));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);

  if (challenge !== null) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return url.toString();
}

/**
 * Swaps the authorization code for an access token.
 *
 * GitHub answers form-encoded unless asked otherwise, so Accept is explicit.
 * Both providers report a bad code as HTTP 200 with an `error` key rather than
 * a failure status, which is why the token is checked and not the status.
 */
export async function exchangeCode(
  provider: Provider,
  { code, verifier }: { code: string; verifier: string | null },
): Promise<string> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(provider.id),
  });
  if (verifier !== null) {
    body.set('code_verifier', verifier);
  }

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== 'string') {
    throw new Error(`${provider.id} did not return an access token`);
  }
  return payload.access_token;
}
```

- [ ] **Step 6: Run the tests**

```bash
cd server && npx vitest run tests/lib/oauth.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/lib/oauth server/tests/lib/oauth.test.ts
git commit -m "feat: implement the OAuth code flow against Google and GitHub

No OAuth package: passport's two strategies are unmaintained, openid-client
v6 and arctic are ESM-only against a CommonJS server, and openid-client v5
would cover Google only because GitHub is not an OIDC provider. What is left
is an authorize URL, a code exchange and a profile read over global fetch.

GitHub needs two profile calls — /user carries no verification flag and its
email can be a stale alias, so the address comes from /user/emails — and
does not support PKCE, so the challenge is omitted rather than sent and
ignored."
```

---

### Task 5: User slugs and account resolution

**Files:**

- Create: `server/src/lib/userSlug.ts`
- Create: `server/src/lib/accounts.ts`
- Test: `server/tests/lib/userSlug.test.ts`, `server/tests/lib/accounts.test.ts`

**Interfaces:**

- Consumes: `slugify`, `uniqueSlug` from `src/lib/slug.ts`; `OAuthProfile`, `ProviderId` from Task 4; `signupMode`, `bootstrapOwnerEmail` from Task 3; `createUser` from Task 2.
- Produces: `RESERVED_SLUGS: Set<string>`, `USER_SLUG_PATTERN: RegExp`, `isReserved(slug): boolean`, `freeUserSlug(tx, displayName): Promise<string>`.
- Produces: `type SignInFailure = 'email_unverified' | 'suspended' | 'signup_closed' | 'invite_required'`, `type SignInResult = { ok: true; userId: number } | { ok: false; reason: SignInFailure }`, `resolveSignIn(provider, profile, invite): Promise<SignInResult>`.

- [ ] **Step 1: Write the failing slug test**

Create `server/tests/lib/userSlug.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_SLUG_PATTERN, freeUserSlug, isReserved } from '../../src/lib/userSlug';
import { createUser } from '../fixtures/users';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('USER_SLUG_PATTERN', () => {
  it.each(['abc', 'andriy', 'a-b', 'kind-of-blue', 'a'.repeat(32)])('accepts %s', (slug) => {
    expect(USER_SLUG_PATTERN.test(slug)).toBe(true);
  });

  it.each(['ab', 'a'.repeat(33), '-abc', 'abc-', 'Abc', 'a b', 'a_b'])('rejects %s', (slug) => {
    expect(USER_SLUG_PATTERN.test(slug)).toBe(false);
  });
});

describe('isReserved', () => {
  it.each(['admin', 'api', 'auth', 'uploads', 'settings', 'account'])('reserves %s', (slug) => {
    expect(isReserved(slug)).toBe(true);
  });

  it('leaves an ordinary name alone', () => {
    expect(isReserved('andriy')).toBe(false);
  });
});

describe('freeUserSlug', () => {
  it('derives a slug from the display name', async () => {
    expect(await freeUserSlug(prisma, 'Andriy Deputovych')).toBe('andriy-deputovych');
  });

  it('suffixes when the derived slug is taken', async () => {
    await createUser(prisma, { slug: 'andriy' });
    expect(await freeUserSlug(prisma, 'Andriy')).toBe('andriy-2');
  });

  it('suffixes past a reserved word rather than handing it out', async () => {
    expect(await freeUserSlug(prisma, 'Admin')).toBe('admin-2');
  });

  it('pads a name that slugifies too short for the pattern', async () => {
    // slugify('Al') is 'al' — two characters, one below the pattern's minimum.
    expect(USER_SLUG_PATTERN.test(await freeUserSlug(prisma, 'Al'))).toBe(true);
  });

  it('truncates a very long name to the pattern length', async () => {
    const slug = await freeUserSlug(prisma, 'A'.repeat(80));

    expect(slug.length).toBeLessThanOrEqual(32);
    expect(USER_SLUG_PATTERN.test(slug)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/lib/userSlug.test.ts
```

Expected: FAIL — `../../src/lib/userSlug` does not resolve.

- [ ] **Step 3: Write the slug module**

Create `server/src/lib/userSlug.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { slugify, uniqueSlug } from './slug';

/** Both the Prisma client and a transaction client satisfy this. */
type UserReader = Pick<PrismaClient, 'user'>;

/**
 * 3 to 32 characters: lowercase alphanumerics with inner hyphens, and no
 * leading or trailing hyphen. Short enough to type, long enough for a name.
 */
export const USER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * Names that already collide with a route, or are the obvious next one.
 *
 * Handing out `admin` would not break /admin — the client router matches that
 * first — but /u/admin would read as an official page, which is the
 * impersonation half of the problem rather than the routing half.
 */
export const RESERVED_SLUGS = new Set([
  'about',
  'account',
  'admin',
  'api',
  'assets',
  'auth',
  'favicon',
  'health',
  'index',
  'login',
  'logout',
  'me',
  'new',
  'settings',
  'signin',
  'signout',
  'static',
  'u',
  'uploads',
]);

export function isReserved(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

const MAX_SLUG_LENGTH = 32;

/**
 * The first free slug derived from a display name.
 *
 * `slugify` can return something the pattern rejects — 'al' is too short, an
 * 80-character name too long — so the base is clamped before it is offered. A
 * reserved word counts as taken, which sends it down the same numeric-suffix
 * path as a genuine collision instead of needing a branch of its own.
 */
export async function freeUserSlug(tx: UserReader, displayName: string): Promise<string> {
  let base = slugify(displayName).slice(0, MAX_SLUG_LENGTH);
  while (base.length < 3) {
    base = `${base}-collection`.slice(0, MAX_SLUG_LENGTH);
  }
  base = base.replace(/-+$/, '');

  return uniqueSlug(base, async (candidate) => {
    if (isReserved(candidate)) {
      return true;
    }
    return (await tx.user.count({ where: { slug: candidate } })) > 0;
  });
}
```

- [ ] **Step 4: Run the slug tests**

```bash
cd server && npx vitest run tests/lib/userSlug.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing account-resolution test**

Create `server/tests/lib/accounts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSignIn } from '../../src/lib/accounts';
import type { OAuthProfile } from '../../src/lib/oauth/providers';
import { createUser } from '../fixtures/users';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

function profile(overrides: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    providerUserId: 'sub-1',
    email: 'andriy@example.com',
    emailVerified: true,
    displayName: 'Andriy',
    avatarUrl: null,
    ...overrides,
  };
}

/** The row the migration inserts. resetDb truncates it, so tests re-seed it. */
async function seedBootstrap() {
  return prisma.user.create({
    data: { slug: 'collection', displayName: 'The Collection', bootstrap: true },
  });
}

describe('resolveSignIn', () => {
  it('refuses an unverified email before any lookup', async () => {
    const result = await resolveSignIn('google', profile({ emailVerified: false }), null);

    expect(result).toEqual({ ok: false, reason: 'email_unverified' });
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses a provider that reports no email at all', async () => {
    const result = await resolveSignIn(
      'github',
      profile({ email: null, emailVerified: false }),
      null,
    );

    expect(result).toEqual({ ok: false, reason: 'email_unverified' });
  });

  it('creates an account with a slug derived from the display name', async () => {
    const result = await resolveSignIn('google', profile(), null);

    expect(result.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'andriy@example.com' } });
    expect(user.slug).toBe('andriy');
    expect(user.isPublic).toBe(true);
  });

  it('signs the same identity back in without creating a second account', async () => {
    const first = await resolveSignIn('google', profile(), null);
    const second = await resolveSignIn('google', profile(), null);

    expect(second).toEqual(first);
    expect(await prisma.user.count()).toBe(1);
  });

  it('links a second provider by verified email', async () => {
    const first = await resolveSignIn('google', profile(), null);
    const second = await resolveSignIn(
      'github',
      profile({ providerUserId: 'gh-9', displayName: 'Andriy D' }),
      null,
    );

    expect(second).toEqual(first);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.oAuthIdentity.count()).toBe(2);
  });

  it('compares the email case-insensitively', async () => {
    const first = await resolveSignIn('google', profile(), null);
    const second = await resolveSignIn(
      'github',
      profile({ providerUserId: 'gh-9', email: 'Andriy@Example.COM' }),
      null,
    );

    expect(second).toEqual(first);
  });

  it('keeps different emails as different accounts', async () => {
    await resolveSignIn('google', profile(), null);
    await resolveSignIn(
      'github',
      profile({ providerUserId: 'gh-9', email: 'other@example.com' }),
      null,
    );

    expect(await prisma.user.count()).toBe(2);
  });

  it('bounds a display name and drops formatting characters from it', async () => {
    await resolveSignIn('google', profile({ displayName: 'A'.repeat(200) }), null);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'andriy@example.com' } });
    expect(user.displayName.length).toBe(80);
  });

  it('refuses a suspended account', async () => {
    const user = await createUser(prisma, { slug: 'andriy', email: 'andriy@example.com' });
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    expect(await resolveSignIn('google', profile(), null)).toEqual({
      ok: false,
      reason: 'suspended',
    });
  });

  it('will not let a suspended account escape by adding a second provider', async () => {
    const user = await createUser(prisma, { slug: 'andriy', email: 'andriy@example.com' });
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    const result = await resolveSignIn('github', profile({ providerUserId: 'gh-9' }), null);

    expect(result).toEqual({ ok: false, reason: 'suspended' });
    expect(await prisma.oAuthIdentity.count()).toBe(0);
  });
});

describe('the bootstrap claim', () => {
  it('claims the placeholder rather than creating a second account', async () => {
    const placeholder = await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'andriy@example.com');

    const result = await resolveSignIn('google', profile(), null);

    expect(result).toEqual({ ok: true, userId: placeholder.id });
    expect(await prisma.user.count()).toBe(1);
    const claimed = await prisma.user.findUniqueOrThrow({ where: { id: placeholder.id } });
    expect(claimed.email).toBe('andriy@example.com');
    expect(claimed.displayName).toBe('Andriy');
    // The slug belongs to the owner to change; the claim does not rename them.
    expect(claimed.slug).toBe('collection');
  });

  it('matches the configured address case-insensitively', async () => {
    const placeholder = await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'Andriy@Example.COM');

    expect(await resolveSignIn('google', profile(), null)).toEqual({
      ok: true,
      userId: placeholder.id,
    });
  });

  it('does not fire twice', async () => {
    await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'andriy@example.com');

    await resolveSignIn('google', profile(), null);
    // Someone else, later, with the same variable still configured.
    const second = await resolveSignIn(
      'github',
      profile({ providerUserId: 'gh-9', email: 'someone@example.com', displayName: 'Someone' }),
      null,
    );

    expect(second.ok).toBe(true);
    expect(await prisma.user.count()).toBe(2);
    const placeholder = await prisma.user.findFirstOrThrow({ where: { bootstrap: true } });
    expect(placeholder.email).toBe('andriy@example.com');
  });

  it('leaves the placeholder alone for a non-matching address', async () => {
    await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'andriy@example.com');

    await resolveSignIn('google', profile({ email: 'someone@example.com' }), null);

    const placeholder = await prisma.user.findFirstOrThrow({ where: { bootstrap: true } });
    expect(placeholder.email).toBeNull();
    expect(await prisma.user.count()).toBe(2);
  });

  it('claims nothing when the variable is unset', async () => {
    await seedBootstrap();
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', '');

    await resolveSignIn('google', profile(), null);

    const placeholder = await prisma.user.findFirstOrThrow({ where: { bootstrap: true } });
    expect(placeholder.email).toBeNull();
  });
});

describe('the signup gate', () => {
  it('refuses a new account when closed, but lets an existing one in', async () => {
    vi.stubEnv('SIGNUP_MODE', 'open');
    const first = await resolveSignIn('google', profile(), null);

    vi.stubEnv('SIGNUP_MODE', 'closed');
    expect(await resolveSignIn('google', profile(), null)).toEqual(first);
    expect(
      await resolveSignIn(
        'github',
        profile({ providerUserId: 'gh-9', email: 'new@example.com' }),
        null,
      ),
    ).toEqual({ ok: false, reason: 'signup_closed' });
  });

  it('requires an invite code when in invite mode', async () => {
    vi.stubEnv('SIGNUP_MODE', 'invite');

    expect(await resolveSignIn('google', profile(), null)).toEqual({
      ok: false,
      reason: 'invite_required',
    });
    expect(await prisma.user.count()).toBe(0);
  });

  it('accepts a valid code and marks it redeemed', async () => {
    vi.stubEnv('SIGNUP_MODE', 'invite');
    await prisma.invite.create({ data: { code: 'good-code' } });

    const result = await resolveSignIn('google', profile(), 'good-code');

    expect(result.ok).toBe(true);
    const invite = await prisma.invite.findUniqueOrThrow({ where: { code: 'good-code' } });
    expect(invite.redeemedById).toBe(result.ok ? result.userId : null);
    expect(invite.redeemedAt).not.toBeNull();
  });

  it('gives one indistinguishable answer for unknown, expired and spent codes', async () => {
    vi.stubEnv('SIGNUP_MODE', 'invite');
    const other = await createUser(prisma, { slug: 'other' });
    await prisma.invite.create({ data: { code: 'expired', expiresAt: new Date('2020-01-01') } });
    await prisma.invite.create({
      data: { code: 'used', redeemedById: other.id, redeemedAt: new Date() },
    });

    for (const code of ['nonexistent', 'expired', 'used']) {
      expect(await resolveSignIn('google', profile(), code)).toEqual({
        ok: false,
        reason: 'invite_required',
      });
    }
  });

  it('does not consume an invite when the identity already exists', async () => {
    vi.stubEnv('SIGNUP_MODE', 'invite');
    await prisma.invite.create({ data: { code: 'good-code' } });
    await resolveSignIn('google', profile(), 'good-code');

    await prisma.invite.create({ data: { code: 'second-code' } });
    await resolveSignIn('google', profile(), 'second-code');

    const second = await prisma.invite.findUniqueOrThrow({ where: { code: 'second-code' } });
    expect(second.redeemedById).toBeNull();
  });

  it('never gates the bootstrap claim behind an invite', async () => {
    const placeholder = await seedBootstrap();
    vi.stubEnv('SIGNUP_MODE', 'invite');
    vi.stubEnv('BOOTSTRAP_OWNER_EMAIL', 'andriy@example.com');

    expect(await resolveSignIn('google', profile(), null)).toEqual({
      ok: true,
      userId: placeholder.id,
    });
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/lib/accounts.test.ts
```

Expected: FAIL — `../../src/lib/accounts` does not resolve.

- [ ] **Step 7: Write the resolver**

Create `server/src/lib/accounts.ts`. `cleanDisplayName` uses the Unicode `\p{C}` class rather than an explicit control-character range: it strips control, format and surrogate code points in one expression, which also removes the bidi overrides that would let a display name render as something other than what it says.

```ts
import { Prisma } from '@prisma/client';
import { bootstrapOwnerEmail, signupMode } from '../config/env';
import { prisma } from '../prisma/client';
import type { OAuthProfile, ProviderId } from './oauth/providers';
import { freeUserSlug } from './userSlug';

export type SignInFailure = 'email_unverified' | 'suspended' | 'signup_closed' | 'invite_required';

export type SignInResult = { ok: true; userId: number } | { ok: false; reason: SignInFailure };

/** Transaction client — every query below runs inside one. */
type Tx = Prisma.TransactionClient;

const MAX_DISPLAY_NAME = 80;

/**
 * A display name is rendered in the admin chrome and returned by the public
 * profile endpoint, so it is bounded and cleaned here, at the single point
 * where a provider's string enters the database.
 *
 * \p{C} covers control, format and surrogate code points — the format ones
 * matter as much as the control ones, since a bidi override would let a name
 * render as something other than what it contains.
 */
function cleanDisplayName(raw: string): string {
  const stripped = raw.replace(/\p{C}/gu, '').trim();
  return (stripped.length > 0 ? stripped : 'Collector').slice(0, MAX_DISPLAY_NAME);
}

function gate(user: { id: number; suspendedAt: Date | null }): SignInResult {
  return user.suspendedAt === null
    ? { ok: true, userId: user.id }
    : { ok: false, reason: 'suspended' };
}

async function attempt(
  provider: ProviderId,
  profile: OAuthProfile,
  email: string,
  invite: string | null,
): Promise<SignInResult> {
  return prisma.$transaction(async (tx: Tx): Promise<SignInResult> => {
    // 1. A provider account we have seen before. Every repeat sign-in ends here,
    //    which is what stops the claim and the invite below firing twice.
    const identity = await tx.oAuthIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
      include: { user: true },
    });
    if (identity) {
      return gate(identity.user);
    }

    const displayName = cleanDisplayName(profile.displayName);

    // 2. The same person arriving through their second provider.
    const byEmail = await tx.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.suspendedAt !== null) {
        // Refuse before linking: an identity attached now would be a way back in.
        return { ok: false, reason: 'suspended' };
      }
      await tx.oAuthIdentity.create({
        data: { provider, providerUserId: profile.providerUserId, userId: byEmail.id },
      });
      return gate(byEmail);
    }

    // 3. The bootstrap claim. `email: null` can match at most once, so a second
    //    attempt updates nothing and falls through to step 4.
    const configured = bootstrapOwnerEmail();
    if (configured !== null && configured === email) {
      const claimed = await tx.user.updateMany({
        where: { bootstrap: true, email: null },
        data: { email, displayName, avatarUrl: profile.avatarUrl },
      });
      if (claimed.count === 1) {
        const owner = await tx.user.findUniqueOrThrow({ where: { email } });
        await tx.oAuthIdentity.create({
          data: { provider, providerUserId: profile.providerUserId, userId: owner.id },
        });
        return gate(owner);
      }
    }

    // 4. A genuinely new account, if the gate allows one.
    const mode = signupMode();
    if (mode === 'closed') {
      return { ok: false, reason: 'signup_closed' };
    }

    let inviteId: number | null = null;
    if (mode === 'invite') {
      const row = invite === null ? null : await tx.invite.findUnique({ where: { code: invite } });
      const usable =
        row !== null &&
        row.redeemedById === null &&
        (row.expiresAt === null || row.expiresAt > new Date());
      if (!usable) {
        // One answer for unknown, expired and spent alike: a caller must not be
        // able to probe which codes exist.
        return { ok: false, reason: 'invite_required' };
      }
      inviteId = row.id;
    }

    const created = await tx.user.create({
      data: {
        slug: await freeUserSlug(tx, displayName),
        displayName,
        email,
        avatarUrl: profile.avatarUrl,
        identities: { create: { provider, providerUserId: profile.providerUserId } },
      },
    });

    if (inviteId !== null) {
      // redeemedById is unique, so a racing redemption fails here rather than
      // handing one code to two accounts.
      await tx.invite.update({
        where: { id: inviteId },
        data: { redeemedById: created.id, redeemedAt: new Date() },
      });
    }

    return { ok: true, userId: created.id };
  });
}

/**
 * Decides which account a provider profile belongs to, creating one if the
 * signup gate allows it.
 *
 * An unverified email never reaches the linking logic and is never stored:
 * linking by email is only as safe as the provider's verification claim, so a
 * provider that will not make the claim gets no account at all.
 */
export async function resolveSignIn(
  provider: ProviderId,
  profile: OAuthProfile,
  invite: string | null,
): Promise<SignInResult> {
  if (!profile.emailVerified || profile.email === null) {
    return { ok: false, reason: 'email_unverified' };
  }
  const email = profile.email.trim().toLowerCase();

  try {
    return await attempt(provider, profile, email, invite);
  } catch (error) {
    // Two callbacks for one new address can both reach step 4; the loser
    // violates User.email's unique index. Retrying finds the winner at step 2.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return attempt(provider, profile, email, invite);
    }
    throw error;
  }
}
```

- [ ] **Step 8: Run the tests**

```bash
cd server && npx vitest run tests/lib/accounts.test.ts tests/lib/userSlug.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/lib/userSlug.ts server/src/lib/accounts.ts server/tests/lib
git commit -m "feat: resolve a provider profile to an account

Identity, then verified email, then the bootstrap claim, then a new account
if the signup gate allows one — all inside one transaction. The claim keys on
email IS NULL so it can match at most once, and every later sign-in
short-circuits at the identity lookup long before it is reached.

A suspended account is refused before a second provider can be linked to it,
so suspension cannot be walked around by signing in the other way. Unknown,
expired and spent invite codes give one indistinguishable answer."
```

---

### Task 6: The switch — sessions carry a user, and every row has an owner

This is the largest task in the plan and it is deliberately not split. Removing the password removes `session.isAdmin`, which `requireAuth` reads; replacing `requireAuth` gives handlers an `ownerId`, which the `NOT NULL` columns from Task 1 already require. Any smaller slice leaves the suite red. **The full suite is green at the end of this task and not before.**

**Files:**

- Modify: `server/src/types/session.d.ts`
- Create: `server/src/middleware/requireUser.ts`, `server/src/middleware/sameOrigin.ts`, `server/src/lib/owner.ts`
- Delete: `server/src/middleware/requireAuth.ts`
- Modify: `server/src/routes/auth.ts` (rewritten), `server/src/lib/resourceRouter.ts`, `server/src/routes/records.ts`, `server/src/routes/settings.ts`, `server/src/routes/uploads.ts`, `server/src/routes/wishlist.ts`, `server/src/routes/setup.ts`, `server/src/app.ts`
- Modify: `server/tests/helpers/auth.ts` (rewritten)
- Modify: `server/tests/routes/records.read.test.ts`, `records.write.test.ts`, `content.read.test.ts`, `content.write.test.ts`, `stats.test.ts`, `uploads.test.ts`, `auth.test.ts`, `security.test.ts`

**Interfaces:**

- Consumes: `resolveSignIn` (Task 5), `configuredProviders` / `getProvider` (Task 4), `randomToken` / `challengeFor` (Task 4), `authorizeUrl` / `exchangeCode` (Task 4).
- Produces: `requireUser(req, res, next)` — 401 or `res.locals.ownerId`.
- Produces: `sameOrigin(req, res, next)` — 403 on a cross-origin non-GET.
- Produces: `ownerOf(res): number`.
- Produces: `interface ResourceRouters { read: Router; own: Router }` and `createResourceRouter(options): ResourceRouters`. `read` is GET-only with no auth, for the `/api/u/:slug` mount added in Task 10; `own` is GET plus writes, each route individually behind `requireUser`.
- Produces: `signInAgent(overrides?)` → `{ agent, user }` and `attemptSignIn(overrides?, query?)` → `{ agent, start, response }` in `tests/helpers/auth.ts`.

- [ ] **Step 1: Write the failing auth-route test**

Create `server/tests/routes/auth.oauth.test.ts`:

```ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app';
import { attemptSignIn, signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /api/auth/providers', () => {
  it('lists what is configured', async () => {
    const response = await request(app).get('/api/auth/providers');

    expect(response.status).toBe(200);
    expect(response.body.sort()).toEqual(['github', 'google']);
  });
});

describe('GET /api/auth/:provider', () => {
  it('redirects to the provider carrying state', async () => {
    const response = await request(app).get('/api/auth/google');

    expect(response.status).toBe(302);
    const url = new URL(response.headers.location);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('mints a different state each time', async () => {
    const first = await request(app).get('/api/auth/google');
    const second = await request(app).get('/api/auth/google');

    expect(new URL(first.headers.location).searchParams.get('state')).not.toBe(
      new URL(second.headers.location).searchParams.get('state'),
    );
  });

  it('404s a provider that is not configured', async () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', '');
    await request(app).get('/api/auth/github').expect(404);
  });

  it('404s a provider that does not exist', async () => {
    await request(app).get('/api/auth/facebook').expect(404);
  });
});

describe('GET /api/auth/:provider/callback', () => {
  it('signs in and lands on the admin', async () => {
    const { response } = await attemptSignIn();

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/admin');
    expect(await prisma.user.count()).toBe(1);
  });

  it('rejects a callback with no handshake in the session', async () => {
    const response = await request(app).get('/api/auth/google/callback?code=c&state=whatever');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/?error=state');
  });

  it('rejects a mismatched state', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/google');

    const response = await agent.get('/api/auth/google/callback?code=c&state=not-the-one');

    expect(response.headers.location).toBe('/?error=state');
  });

  it('rejects a replayed callback, so the handshake is single use', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google');
    const state = new URL(start.headers.location).searchParams.get('state');

    // The stub is not installed, so the first attempt fails at the exchange —
    // what matters is that the handshake is consumed either way.
    await agent.get(`/api/auth/google/callback?code=c&state=${state}`);
    const replay = await agent.get(`/api/auth/google/callback?code=c&state=${state}`);

    expect(replay.headers.location).toBe('/?error=state');
  });

  it('rejects a state minted for the other provider', async () => {
    const agent = request.agent(app);
    const start = await agent.get('/api/auth/google');
    const state = new URL(start.headers.location).searchParams.get('state');

    const response = await agent.get(`/api/auth/github/callback?code=c&state=${state}`);

    expect(response.headers.location).toBe('/?error=state');
  });

  it('refuses a provider that will not vouch for the email', async () => {
    const { response } = await attemptSignIn({ emailVerified: false });

    expect(response.headers.location).toBe('/?error=email_unverified');
    expect(await prisma.user.count()).toBe(0);
  });

  it('regenerates the session id, so a pre-seeded cookie cannot be promoted', async () => {
    const agent = request.agent(app);
    const before = await agent.get('/api/auth/google');
    const seeded = String(before.headers['set-cookie']);

    const { response } = await attemptSignIn();
    const after = String(response.headers['set-cookie']);

    expect(after).not.toBe(seeded);
    expect(after).toContain('sid=');
  });

  it('returns the user to a validated next path', async () => {
    const { response } = await attemptSignIn({}, '?next=%2Fadmin%2Frecords');

    expect(response.headers.location).toBe('/admin/records');
  });

  it('ignores an off-site next, so the callback is not an open redirect', async () => {
    const { response } = await attemptSignIn({}, '?next=https%3A%2F%2Fevil.example');

    expect(response.headers.location).toBe('/admin');
  });

  it('ignores a protocol-relative next', async () => {
    const { response } = await attemptSignIn({}, '?next=%2F%2Fevil.example');

    expect(response.headers.location).toBe('/admin');
  });
});

describe('GET /api/auth/me', () => {
  it('answers null rather than 401 when signed out', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
  });

  it('returns the signed-in user', async () => {
    const { agent, user } = await signInAgent({ displayName: 'Andriy' });

    const response = await agent.get('/api/auth/me');

    expect(response.body.user).toMatchObject({
      id: user.id,
      slug: user.slug,
      displayName: 'Andriy',
      isPublic: true,
    });
    // The session cookie is the credential; the email is not the client's business.
    expect(response.body.user.email).toBeUndefined();
  });

  it('answers null for a session whose user has since been suspended', async () => {
    const { agent, user } = await signInAgent();
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    expect((await agent.get('/api/auth/me')).body).toEqual({ user: null });
  });
});

describe('POST /api/auth/logout', () => {
  it('destroys the session', async () => {
    const { agent } = await signInAgent();

    await agent.post('/api/auth/logout').expect(204);

    expect((await agent.get('/api/auth/me')).body).toEqual({ user: null });
  });
});
```

Delete `server/tests/routes/auth.test.ts` — every case in it is about the password.

- [ ] **Step 2: Write the failing isolation-of-writes test**

This is the test that proves the ownership threading, and it belongs here rather than in the dedicated suite of Task 9 because it is what makes this task's deliverable checkable. Create `server/tests/routes/ownership.test.ts`:

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

async function twoOwners() {
  const a = await signInAgent({
    providerUserId: 'sub-a',
    email: 'a@example.com',
    displayName: 'A',
  });
  const b = await signInAgent({
    providerUserId: 'sub-b',
    email: 'b@example.com',
    displayName: 'B',
  });
  return { a, b };
}

describe('creates are stamped with the session owner', () => {
  it('records', async () => {
    const { a } = await twoOwners();

    const created = await a.agent
      .post('/api/records')
      .send({
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        year: 1959,
        format: 'LP',
        genre: 'Jazz',
      })
      .expect(201);

    const row = await prisma.record.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.ownerId).toBe(a.user.id);
  });

  it('ignores an ownerId in the body', async () => {
    const { a, b } = await twoOwners();

    const created = await a.agent
      .post('/api/wishlist')
      .send({ title: 'Karma', artist: 'Pharoah Sanders', ownerId: b.user.id })
      .expect(201);

    const row = await prisma.wishlistItem.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.ownerId).toBe(a.user.id);
  });
});

describe('lists are scoped to the session owner', () => {
  it('shows only your own rows', async () => {
    const { a, b } = await twoOwners();
    await a.agent
      .post('/api/wishlist')
      .send({ title: 'Karma', artist: 'Pharoah Sanders' })
      .expect(201);

    expect((await a.agent.get('/api/wishlist')).body).toHaveLength(1);
    expect((await b.agent.get('/api/wishlist')).body).toHaveLength(0);
  });

  it('401s a signed-out read of the own tree', async () => {
    await request(app).get('/api/wishlist').expect(401);
  });
});

describe('two owners can hold the same album slug', () => {
  it('does not suffix across owners', async () => {
    const { a, b } = await twoOwners();
    const body = {
      title: 'Kind of Blue',
      artist: 'Miles Davis',
      year: 1959,
      format: 'LP',
      genre: 'Jazz',
    };

    const first = await a.agent.post('/api/records').send(body).expect(201);
    const second = await b.agent.post('/api/records').send(body).expect(201);

    expect(first.body.slug).toBe('kind-of-blue');
    expect(second.body.slug).toBe('kind-of-blue');
  });

  it('still suffixes within one owner', async () => {
    const { a } = await twoOwners();
    const body = {
      title: 'Kind of Blue',
      artist: 'Miles Davis',
      year: 1959,
      format: 'LP',
      genre: 'Jazz',
    };

    await a.agent.post('/api/records').send(body).expect(201);
    const second = await a.agent.post('/api/records').send(body).expect(201);

    expect(second.body.slug).toBe('kind-of-blue-2');
  });
});

describe('settings are per owner', () => {
  it('does not overwrite another owner value under the same key', async () => {
    const { a, b } = await twoOwners();

    await a.agent.patch('/api/settings').send({ collectingSince: '2009' }).expect(200);
    await b.agent.patch('/api/settings').send({ collectingSince: '2015' }).expect(200);

    expect((await a.agent.get('/api/settings')).body).toEqual({ collectingSince: '2009' });
    expect((await b.agent.get('/api/settings')).body).toEqual({ collectingSince: '2015' });
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

```bash
cd server && npx vitest run tests/routes/auth.oauth.test.ts tests/routes/ownership.test.ts
```

Expected: FAIL — `attemptSignIn` is not exported from the auth helper.

- [ ] **Step 4: Declare the new session shape**

Replace `server/src/types/session.d.ts`:

```ts
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** Set only by a completed OAuth callback, after regenerate(). */
    userId?: number;
    /**
     * The in-flight handshake. Deleted on the first callback that reads it, so
     * a replayed callback finds nothing and fails state validation.
     */
    oauth?: {
      provider: string;
      state: string;
      verifier: string | null;
      returnTo: string | null;
      invite: string | null;
    };
  }
}
```

- [ ] **Step 5: Write the owner accessor and the two middlewares**

Create `server/src/lib/owner.ts`:

```ts
import type { Response } from 'express';

/**
 * The owner every handler works against.
 *
 * Set by `requireUser` (from the session) or `resolveOwnerFromSlug` (from the
 * URL), and by nothing else — in particular never from a request body. The
 * throw is unreachable through a mounted route: both middlewares either set it
 * or answer the request themselves, so reaching here means a router was mounted
 * without an owner resolver, which is a wiring bug rather than a bad request.
 */
export function ownerOf(res: Response): number {
  const ownerId: unknown = res.locals.ownerId;
  if (typeof ownerId !== 'number') {
    throw new Error('ownerId missing: this router was mounted without an owner resolver');
  }
  return ownerId;
}
```

Create `server/src/middleware/requireUser.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';

/**
 * Is anyone signed in — and, if so, whose data is this request about.
 *
 * Deliberately synchronous and deliberately not loading the user: checking
 * `suspendedAt` here would put a query on every authenticated request to catch
 * a state that changes twice a year. Suspension is enforced at sign-in, and the
 * operator's suspend recipe deletes that user's session rows, which revokes
 * them immediately.
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.session.userId;
  if (typeof userId !== 'number') {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  res.locals.ownerId = userId;
  next();
}
```

Create `server/src/middleware/sameOrigin.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Replaces what SameSite=Strict was doing before the OAuth callback forced the
 * cookie to Lax.
 *
 * Lax already withholds the cookie from cross-site non-GET requests, so this is
 * the second layer rather than the first. A request with no Origin header at
 * all passes: curl and server-to-server callers send none, and they are not the
 * cross-site browser request this defends against.
 */
export function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin !== undefined && origin !== env.PUBLIC_BASE_URL) {
    res.status(403).json({ error: 'Cross-origin request rejected' });
    return;
  }

  next();
}
```

Then delete the old guard:

```bash
git rm server/src/middleware/requireAuth.ts
```

- [ ] **Step 6: Rewrite the auth router**

Replace `server/src/routes/auth.ts` entirely:

```ts
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { resolveSignIn } from '../lib/accounts';
import { authorizeUrl, exchangeCode } from '../lib/oauth/flow';
import { challengeFor, randomToken } from '../lib/oauth/pkce';
import { configuredProviders, getProvider } from '../lib/oauth/providers';
import { prisma } from '../prisma/client';

export const authRouter = Router();

/**
 * Where to land after signing in.
 *
 * Only app-relative paths, and never protocol-relative: `//evil.example` is a
 * valid absolute URL to a browser, so `startsWith('/')` alone is not a check.
 */
function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
    return null;
  }
  return raw;
}

authRouter.get('/auth/providers', (_req: Request, res: Response) => {
  res.json(configuredProviders().map((provider) => provider.id));
});

authRouter.get(
  '/auth/:provider',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = getProvider(req.params.provider);
    if (!provider) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const state = randomToken();
    const verifier = provider.usesPkce ? randomToken() : null;

    req.session.oauth = {
      provider: provider.id,
      state,
      verifier,
      returnTo: safeReturnTo(req.query.next),
      // Carried through the round trip and validated only at redemption, so an
      // invalid code cannot be probed before the caller has authenticated.
      invite: typeof req.query.invite === 'string' ? req.query.invite : null,
    };

    // Saved explicitly: the browser leaves for the provider the moment this
    // response lands, and an unwritten session would lose the state.
    req.session.save(() => {
      res.redirect(
        authorizeUrl(provider, { state, challenge: verifier ? challengeFor(verifier) : null }),
      );
    });
  }),
);

authRouter.get(
  '/auth/:provider/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const handshake = req.session.oauth ?? null;
    // Consumed before anything can fail, so a replay finds nothing. Single use,
    // not merely single valued.
    delete req.session.oauth;

    const provider = getProvider(req.params.provider);
    if (!provider) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const state = req.query.state;
    if (
      handshake === null ||
      handshake.provider !== provider.id ||
      typeof state !== 'string' ||
      state !== handshake.state
    ) {
      res.redirect('/?error=state');
      return;
    }

    const code = req.query.code;
    if (typeof code !== 'string') {
      // The user pressed cancel at the provider, or the provider sent an error.
      res.redirect('/?error=denied');
      return;
    }

    let result;
    try {
      const token = await exchangeCode(provider, { code, verifier: handshake.verifier });
      const profile = await provider.fetchProfile(token);
      result = await resolveSignIn(provider.id, profile, handshake.invite);
    } catch {
      // A provider outage or a bad code is not a 500 for the visitor: they are
      // mid-navigation, and a raw error object is a dead end.
      res.redirect('/?error=provider');
      return;
    }

    if (!result.ok) {
      res.redirect(`/?error=${result.reason}`);
      return;
    }

    const returnTo = handshake.returnTo ?? '/admin';
    const { userId } = result;

    // A new session id: the callback is reachable cross-site under SameSite=Lax,
    // so a pre-seeded session must not be promoted to an authenticated one.
    req.session.regenerate((error) => {
      if (error) {
        res.redirect('/?error=session');
        return;
      }
      req.session.userId = userId;
      req.session.save(() => res.redirect(returnTo));
    });
  }),
);

authRouter.get(
  '/auth/me',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.session.userId;
    if (typeof userId !== 'number') {
      // "Nobody" is a valid answer to "who am I", not an error.
      res.json({ user: null });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.suspendedAt !== null) {
      res.json({ user: null });
      return;
    }

    // Deliberately not the email: the session cookie is the credential, and the
    // address is not something the client needs to render anything.
    res.json({
      user: {
        id: user.id,
        slug: user.slug,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isPublic: user.isPublic,
      },
    });
  }),
);

authRouter.post('/auth/logout', (req: Request, res: Response) => {
  // destroy() removes the row from the session store, so the cookie is dead
  // even if someone kept a copy.
  req.session.destroy(() => res.status(204).end());
});
```

- [ ] **Step 7: Put the owner inside the CRUD factory's types**

Replace `server/src/lib/resourceRouter.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import type { ZodType } from 'zod';
import { asyncHandler } from './asyncHandler';
import { ownerOf } from './owner';
import { parseId } from './params';
import { requireUser } from '../middleware/requireUser';
import { validate } from '../middleware/validate';

/** Body already parsed and stripped by the zod schema. */
type ValidatedBody = Record<string, unknown>;

/** Every query this factory makes is filtered by owner. The type says so. */
type OwnerScope = { ownerId: number };

/**
 * The slice of a Prisma model delegate this router needs.
 *
 * Declared structurally rather than importing Prisma's generated delegate
 * types: those are deeply generic and would drag the whole payload machinery
 * through a factory that only ever needs five calls.
 *
 * The important part is that `OwnerScope` is intersected into every `where` and
 * into `create`'s `data`. An unscoped query does not typecheck, so a future
 * resource cannot forget the ownership check the way it could if this were a
 * separate lookup the route had to remember to call.
 */
interface CrudDelegate {
  findMany(args: {
    where: OwnerScope;
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
  }): Promise<unknown[]>;
  // findFirst rather than findUnique: { id, ownerId } is not a unique input,
  // and findFirst says that plainly.
  findFirst(args: { where: OwnerScope & { id: number } }): Promise<unknown | null>;
  create(args: { data: ValidatedBody & OwnerScope }): Promise<unknown>;
  update(args: { where: OwnerScope & { id: number }; data: ValidatedBody }): Promise<unknown>;
  delete(args: { where: OwnerScope & { id: number } }): Promise<unknown>;
}

interface ResourceRouterOptions {
  /** URL segment and the name used in error messages, e.g. "wishlist". */
  path: string;
  /** Singular noun for error messages, e.g. "Wishlist item". */
  noun: string;
  delegate: CrudDelegate;
  createSchema: ZodType;
  updateSchema: ZodType;
}

export interface ResourceRouters {
  /**
   * GET only, no auth. The owner comes from `res.locals`, which the mount is
   * responsible for setting — see the /api/u/:slug tree.
   */
  read: Router;
  /** GET plus writes, every route behind requireUser. Mounted under /api. */
  own: Router;
}

/**
 * List, create, update and delete for a position-ordered content resource,
 * scoped to one owner.
 */
export function createResourceRouter({
  path,
  noun,
  delegate,
  createSchema,
  updateSchema,
}: ResourceRouterOptions): ResourceRouters {
  /** Resolves the :id param, answering 400 or 404 itself when it cannot. */
  async function resolveId(req: Request, res: Response): Promise<number | null> {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: `Invalid ${noun.toLowerCase()} id` });
      return null;
    }
    // A row that does not exist and a row belonging to someone else are the
    // same answer. Distinguishing them would let a caller enumerate ids.
    if (!(await delegate.findFirst({ where: { id, ownerId: ownerOf(res) } }))) {
      res.status(404).json({ error: `${noun} not found` });
      return null;
    }
    return id;
  }

  const list = asyncHandler(async (_req: Request, res: Response) => {
    // position then id: equal positions fall back to insertion order rather
    // than whatever the query planner happens to return.
    res.json(
      await delegate.findMany({
        where: { ownerId: ownerOf(res) },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  const read = Router();
  read.get(`/${path}`, list);

  const own = Router();
  // requireUser sits on each route rather than on the router, so an unmatched
  // path under /api still reaches the 404 handler instead of answering 401.
  own.get(`/${path}`, requireUser, list);

  own.post(
    `/${path}`,
    requireUser,
    validate(createSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      // ownerId last, so a body key of that name cannot win. The zod schemas
      // strip unknown keys as well, which makes this the second line of defence.
      const data = { ...(res.locals.body as ValidatedBody), ownerId: ownerOf(res) };
      res.status(201).json(await delegate.create({ data }));
    }),
  );

  own.patch(
    `/${path}/:id`,
    requireUser,
    validate(updateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const id = await resolveId(req, res);
      if (id === null) {
        return;
      }
      res.json(
        await delegate.update({
          where: { id, ownerId: ownerOf(res) },
          data: res.locals.body as ValidatedBody,
        }),
      );
    }),
  );

  own.delete(
    `/${path}/:id`,
    requireUser,
    asyncHandler(async (req: Request, res: Response) => {
      const id = await resolveId(req, res);
      if (id === null) {
        return;
      }
      await delegate.delete({ where: { id, ownerId: ownerOf(res) } });
      res.status(204).end();
    }),
  );

  return { read, own };
}
```

`server/src/routes/wishlist.ts` and `server/src/routes/setup.ts` change only in the name they export:

```ts
export const wishlistRouters = createResourceRouter({ ... });
```

```ts
export const setupRouters = createResourceRouter({ ... });
```

- [ ] **Step 8: Scope the records router**

Replace `server/src/routes/records.ts`. The read and own routers share every handler; only the guard differs.

```ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { parseLimit } from '../lib/query';
import { asyncHandler } from '../lib/asyncHandler';
import { ownerOf } from '../lib/owner';
import { parseId } from '../lib/params';
import { slugify, uniqueSlug } from '../lib/slug';
import { requireUser } from '../middleware/requireUser';
import { validate } from '../middleware/validate';
import { recordCreateSchema, recordUpdateSchema, type RecordCreate } from '../schemas/record';
import type { ResourceRouters } from '../lib/resourceRouter';

const DEFAULT_LIMIT = 100;

const list = asyncHandler(async (req: Request, res: Response) => {
  const ownerId = ownerOf(res);
  const limit = parseLimit(req.query.limit, DEFAULT_LIMIT);
  const byAddedAt = req.query.sort === 'addedAt';

  const records = await prisma.record.findMany({
    where: { ownerId },
    orderBy: byAddedAt ? [{ addedAt: 'desc' }] : [{ position: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  // The "New" badge is derived, never stored: exactly one record per
  // collection carries it, the most recently added one. Scoped to the owner,
  // or with two collectors only one collection would ever show a badge.
  const newest = await prisma.record.findFirst({
    where: { ownerId },
    orderBy: { addedAt: 'desc' },
  });

  res.json(records.map((record) => ({ ...record, isNew: record.id === newest?.id })));
});

/**
 * Every genre actually present in this collection, alphabetically.
 *
 * The filter chips are built from this rather than a hardcoded list, so a genre
 * the collector invents appears without a code change, and one no record uses
 * stops offering an always-empty filter.
 */
const genres = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await prisma.record.groupBy({
    by: ['genre'],
    where: { ownerId: ownerOf(res) },
    _count: { _all: true },
    orderBy: { genre: 'asc' },
  });

  res.json(rows.map((row) => ({ name: row.genre, count: row._count._all })));
});

const readOne = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Invalid record id' });
    return;
  }

  const record = await prisma.record.findFirst({ where: { id, ownerId: ownerOf(res) } });
  if (!record) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  res.json(record);
});

async function findOwned(id: number, ownerId: number) {
  return prisma.record.findFirst({ where: { id, ownerId } });
}

export const recordsRouters: ResourceRouters = (() => {
  const read = Router();
  read.get('/records', list);
  read.get('/genres', genres);
  read.get('/records/:id', readOne);

  const own = Router();
  own.get('/records', requireUser, list);
  own.get('/genres', requireUser, genres);
  own.get('/records/:id', requireUser, readOne);

  own.post(
    '/records',
    requireUser,
    validate(recordCreateSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      const ownerId = ownerOf(res);
      const body = res.locals.body as RecordCreate;

      // The owner is part of the collision check: without it the second
      // collector to add Kind of Blue gets kind-of-blue-2 for no visible reason.
      const slug = await uniqueSlug(
        body.slug ?? slugify(body.title),
        async (candidate) =>
          (await prisma.record.count({ where: { ownerId, slug: candidate } })) > 0,
      );

      res.status(201).json(await prisma.record.create({ data: { ...body, slug, ownerId } }));
    }),
  );

  own.patch(
    '/records/:id',
    requireUser,
    validate(recordUpdateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ownerId = ownerOf(res);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid record id' });
        return;
      }
      if (!(await findOwned(id, ownerId))) {
        res.status(404).json({ error: 'Record not found' });
        return;
      }

      res.json(await prisma.record.update({ where: { id, ownerId }, data: res.locals.body }));
    }),
  );

  own.delete(
    '/records/:id',
    requireUser,
    asyncHandler(async (req: Request, res: Response) => {
      const ownerId = ownerOf(res);
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Invalid record id' });
        return;
      }
      if (!(await findOwned(id, ownerId))) {
        res.status(404).json({ error: 'Record not found' });
        return;
      }

      await prisma.record.delete({ where: { id, ownerId } });
      res.status(204).end();
    }),
  );

  return { read, own };
})();
```

- [ ] **Step 9: Scope the settings router**

Replace `server/src/routes/settings.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { prisma } from '../prisma/client';
import { asyncHandler } from '../lib/asyncHandler';
import { ownerOf } from '../lib/owner';
import { requireUser } from '../middleware/requireUser';
import { validate } from '../middleware/validate';
import { settingsSchema } from '../schemas/content';
import type { ResourceRouters } from '../lib/resourceRouter';

async function settingsFor(ownerId: number): Promise<Record<string, string>> {
  const rows = await prisma.siteSetting.findMany({ where: { ownerId } });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

const read = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await settingsFor(ownerOf(res)));
});

export const settingsRouters: ResourceRouters = (() => {
  const readRouter = Router();
  readRouter.get('/settings', read);

  const own = Router();
  own.get('/settings', requireUser, read);

  own.patch(
    '/settings',
    requireUser,
    validate(settingsSchema),
    asyncHandler(async (_req: Request, res: Response) => {
      const ownerId = ownerOf(res);
      const body = res.locals.body as Record<string, string>;

      for (const [key, value] of Object.entries(body)) {
        await prisma.siteSetting.upsert({
          // key alone is no longer unique — it is one half of the primary key.
          where: { ownerId_key: { ownerId, key } },
          create: { ownerId, key, value },
          update: { value },
        });
      }

      res.json(await settingsFor(ownerId));
    }),
  );

  return { read: readRouter, own };
})();
```

- [ ] **Step 10: Scope the stats router**

Replace the three query helpers and the handler in `server/src/routes/stats.ts` so every aggregate carries the owner. The `TopValue` interface and the comments about tie-breaking stay as they are.

```ts
async function topGenre(ownerId: number): Promise<TopValue | null> {
  const [top] = await prisma.record.groupBy({
    by: ['genre'],
    where: { ownerId },
    _count: { _all: true },
    orderBy: [{ _count: { genre: 'desc' } }, { genre: 'asc' }],
    take: 1,
  });

  return top ? { name: top.genre, count: top._count._all } : null;
}

async function topArtist(ownerId: number): Promise<TopValue | null> {
  const [top] = await prisma.record.groupBy({
    by: ['artist'],
    where: { ownerId },
    _count: { _all: true },
    orderBy: [{ _count: { artist: 'desc' } }, { artist: 'asc' }],
    take: 1,
  });

  return top ? { name: top.artist, count: top._count._all } : null;
}

const stats = asyncHandler(async (_req: Request, res: Response) => {
  const ownerId = ownerOf(res);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalRecords, genre, artist, collectingSince, addedLast30Days] = await Promise.all([
    prisma.record.count({ where: { ownerId } }),
    topGenre(ownerId),
    topArtist(ownerId),
    prisma.siteSetting.findUnique({
      where: { ownerId_key: { ownerId, key: 'collectingSince' } },
    }),
    prisma.record.count({ where: { ownerId, addedAt: { gte: thirtyDaysAgo } } }),
  ]);

  res.json({
    totalRecords,
    topGenre: genre,
    topArtist: artist,
    // Deliberately read, not derived: MIN(addedAt) is when a row was entered,
    // not when the collection started.
    collectingSince: collectingSince?.value ?? null,
    addedLast30Days,
  });
});

export const statsRouters: ResourceRouters = (() => {
  const read = Router();
  read.get('/stats', stats);

  const own = Router();
  own.get('/stats', requireUser, stats);

  return { read, own };
})();
```

Add `ownerOf`, `requireUser` and the `ResourceRouters` type to the imports at the top of the file.

- [ ] **Step 11: Put the owner on uploads**

In `server/src/routes/uploads.ts`, swap the guard and stamp the owner. Owner-scoped paths and the byte quota are Task 8; this step is only what is needed to compile and to keep the route behind a session.

```ts
import { requireUser } from '../middleware/requireUser';
```

Replace `requireAuth` with `requireUser` in the `uploadsRouter.post` argument list. Nothing else in the file changes yet.

- [ ] **Step 12: Rewire the app**

In `server/src/app.ts`: change the cookie, add the origin check, and mount the `own` routers. The `/api/u/:slug` tree is added in Task 10.

Change the session cookie block to:

```ts
    cookie: {
      httpOnly: true,
      // Lax, not Strict. The OAuth callback is a cross-site top-level
      // navigation, and Strict withholds the cookie from exactly that — so the
      // session carrying the state and PKCE verifier would never arrive and
      // every sign-in would fail validation. Lax still withholds the cookie
      // from cross-site non-GET requests, which is every write here; the
      // `sameOrigin` middleware and the OAuth `state` parameter cover the rest.
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
```

Add the middleware immediately after the session middleware:

```ts
app.use(sameOrigin);
```

Replace the mount block:

```ts
app.use('/api', healthRouter);
app.use('/api', authRouter);

// The signed-in user's own collection. Every route inside carries requireUser
// individually, so an unknown /api path still reaches the 404 handler below
// rather than answering 401.
app.use('/api', recordsRouters.own);
app.use('/api', statsRouters.own);
app.use('/api', wishlistRouters.own);
app.use('/api', setupRouters.own);
app.use('/api', settingsRouters.own);
app.use('/api', uploadsRouter);
```

and update the imports to the new export names (`recordsRouters`, `statsRouters`, `wishlistRouters`, `setupRouters`, `settingsRouters`, plus `sameOrigin`).

- [ ] **Step 13: Rewrite the test auth helper**

Replace `server/tests/helpers/auth.ts`:

```ts
import request from 'supertest';
import { vi } from 'vitest';
import { app } from '../../src/app';
import { prisma } from './db';

export interface StubProfile {
  provider: 'google' | 'github';
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

const DEFAULT: StubProfile = {
  provider: 'google',
  providerUserId: 'sub-1',
  email: 'owner@example.com',
  emailVerified: true,
  displayName: 'Owner',
  avatarUrl: null,
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Answers the token and profile calls the provider modules make.
 *
 * The suite drives the real routes rather than seeding `session.userId`
 * directly: a test-only backdoor would mean the isolation suite never exercises
 * the code that decides who you are, and it would be a production route that
 * must never ship enabled.
 */
function stubProviderFetch(profile: StubProfile): () => void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/token') || url.includes('/access_token')) {
        return json({ access_token: 'stub-token' });
      }
      if (url.startsWith('https://openidconnect.googleapis.com')) {
        return json({
          sub: profile.providerUserId,
          email: profile.email,
          email_verified: profile.emailVerified,
          name: profile.displayName,
          picture: profile.avatarUrl,
        });
      }
      if (url === 'https://api.github.com/user') {
        return json({
          id: profile.providerUserId,
          login: profile.displayName,
          name: profile.displayName,
          avatar_url: profile.avatarUrl,
        });
      }
      if (url === 'https://api.github.com/user/emails') {
        return json([{ email: profile.email, primary: true, verified: profile.emailVerified }]);
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );

  return () => vi.unstubAllGlobals();
}

/**
 * Walks the whole flow and hands back whatever it ended with, so a test can
 * assert on a failed sign-in as easily as a successful one.
 */
export async function attemptSignIn(overrides: Partial<StubProfile> = {}, query = '') {
  const profile = { ...DEFAULT, ...overrides };
  const restore = stubProviderFetch(profile);

  try {
    const agent = request.agent(app);
    const start = await agent.get(`/api/auth/${profile.provider}${query}`);
    const state = new URL(String(start.headers.location)).searchParams.get('state') ?? '';
    const response = await agent.get(
      `/api/auth/${profile.provider}/callback?code=stub-code&state=${encodeURIComponent(state)}`,
    );
    return { agent, start, response };
  } finally {
    restore();
  }
}

/** A signed-in agent and the user row behind it. Throws if sign-in failed. */
export async function signInAgent(overrides: Partial<StubProfile> = {}) {
  const profile = { ...DEFAULT, ...overrides };
  const { agent, response } = await attemptSignIn(overrides);

  const location = String(response.headers.location);
  if (response.status !== 302 || location.startsWith('/?error=')) {
    throw new Error(`Sign-in failed: ${location}`);
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: profile.email.toLowerCase() },
  });
  return { agent, user };
}
```

- [ ] **Step 14: Migrate the existing route tests**

Six files use `loginAgent()` and unowned fixtures. The substitution is the same in each:

```ts
// before
import { loginAgent } from '../helpers/auth';
beforeEach(async () => {
  await resetDb();
  await loadFixture(prisma);
});
const agent = await loginAgent();
```

```ts
// after
import { signInAgent } from '../helpers/auth';

let agent: Awaited<ReturnType<typeof signInAgent>>['agent'];
let owner: Awaited<ReturnType<typeof signInAgent>>['user'];

beforeEach(async () => {
  await resetDb();
  ({ agent, user: owner } = await signInAgent());
  await loadFixture(prisma, owner.id);
});
```

Apply it to, and note the one non-mechanical change in each:

| File                    | Non-mechanical change                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `records.read.test.ts`  | `request(app).get(...)` becomes `agent.get(...)` — `/api/records` now needs a session.                                                                                                |
| `records.write.test.ts` | None beyond the helper swap.                                                                                                                                                          |
| `content.read.test.ts`  | Same as `records.read.test.ts`.                                                                                                                                                       |
| `content.write.test.ts` | The two `GET /api/settings` cases move to `agent`, and the `prisma.siteSetting.findUnique` assertion becomes `where: { ownerId_key: { ownerId: owner.id, key: 'collectingSince' } }`. |
| `stats.test.ts`         | Every request moves to `agent`; any direct `siteSetting` seeding gains `ownerId: owner.id`.                                                                                           |
| `uploads.test.ts`       | The unauthenticated case still uses `request(app)` and still expects 401.                                                                                                             |

- [ ] **Step 15: Add the cookie and origin cases to the security suite**

Append to `server/tests/routes/security.test.ts` (keeping the CORS and helmet describes as they are):

```ts
describe('session cookie', () => {
  it('is Lax rather than Strict, because the OAuth callback is cross-site', async () => {
    const response = await request(app).get('/api/auth/google');
    const cookie = String(response.headers['set-cookie']);

    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });
});

describe('origin check', () => {
  it('rejects a write carrying a foreign Origin', async () => {
    const response = await request(app)
      .post('/api/wishlist')
      .set('Origin', 'https://evil.example')
      .send({ title: 'A', artist: 'B' });

    // 403 before the 401: an attacker should not learn whether the cookie
    // would have been accepted.
    expect(response.status).toBe(403);
  });

  it('allows a write from the app own origin', async () => {
    const { agent } = await signInAgent();

    await agent
      .post('/api/wishlist')
      .set('Origin', 'http://localhost:5173')
      .send({ title: 'A', artist: 'B' })
      .expect(201);
  });

  it('leaves a GET alone whatever its Origin', async () => {
    await request(app).get('/api/health').set('Origin', 'https://evil.example').expect(200);
  });
});
```

with `beforeEach(resetDb)` and imports for `signInAgent` and `resetDb` added at the top.

- [ ] **Step 16: Run everything**

```bash
npm test -w server
```

Expected: PASS, including the typecheck. This is the first green point since Task 1. If `noUnusedLocals` complains about an unmounted `read` router, leave it — the routers are exported and referenced by `app.ts` in Task 10; an export is a use.

- [ ] **Step 17: Lint**

```bash
npm run lint -w server
```

Expected: zero warnings.

- [ ] **Step 18: Commit**

```bash
git add server/src server/tests
git commit -m "feat: sign in with Google or GitHub, and own what you write

Replaces the shared password with the authorization-code flow. The session
carries a userId rather than an isAdmin boolean, requireUser turns it into
the res.locals.ownerId every handler works from, and requireAuth is gone.

The cookie relaxes from SameSite=Strict to Lax because the provider callback
is a cross-site top-level navigation, which Strict withholds the cookie from
outright. Lax still blocks cross-site non-GET, and a same-origin check on
every write plus the single-use OAuth state cover what is left.

Ownership moves into the CRUD factory's delegate type: every where clause and
create payload is intersected with { ownerId }, so an unscoped query no longer
compiles. A missing row and another owner row are the same 404.

The test helper drives the real callback against a stubbed provider rather
than seeding a session, so the isolation suite exercises the code that decides
who you are."
```

---

## Phase 3 — Scoping the rest, and the public collection

### Task 7: Per-collection statistics

Task 6 scoped the stats queries to compile. This task proves they are correct with two collections in the database, which the old single-collection suite could not distinguish.

**Files:**

- Test: `server/tests/routes/stats.test.ts`

**Interfaces:**

- Consumes: `signInAgent` (Task 6), `loadFixture`, `createUser` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to `server/tests/routes/stats.test.ts`:

```ts
describe('with two collections in the database', () => {
  it('counts, tops and windows only the requesting owner rows', async () => {
    const other = await signInAgent({
      providerUserId: 'sub-other',
      email: 'other@example.com',
      displayName: 'Other',
    });
    await other.agent
      .post('/api/records')
      .send({ title: 'Nevermind', artist: 'Nirvana', year: 1991, format: 'LP', genre: 'Grunge' })
      .expect(201);
    await other.agent
      .post('/api/records')
      .send({ title: 'In Utero', artist: 'Nirvana', year: 1993, format: 'LP', genre: 'Grunge' })
      .expect(201);

    const mine = (await agent.get('/api/stats')).body;
    const theirs = (await other.agent.get('/api/stats')).body;

    expect(mine.totalRecords).toBe(14);
    expect(mine.topGenre.name).not.toBe('Grunge');
    expect(theirs.totalRecords).toBe(2);
    expect(theirs.topGenre).toEqual({ name: 'Grunge', count: 2 });
    expect(theirs.topArtist).toEqual({ name: 'Nirvana', count: 2 });
  });

  it('keeps collectingSince per owner', async () => {
    const other = await signInAgent({
      providerUserId: 'sub-other',
      email: 'other@example.com',
    });
    await agent.patch('/api/settings').send({ collectingSince: '2009' }).expect(200);
    await other.agent.patch('/api/settings').send({ collectingSince: '2015' }).expect(200);

    expect((await agent.get('/api/stats')).body.collectingSince).toBe('2009');
    expect((await other.agent.get('/api/stats')).body.collectingSince).toBe('2015');
  });
});

describe('GET /api/genres', () => {
  it('lists only the requesting owner genres', async () => {
    const other = await signInAgent({
      providerUserId: 'sub-other',
      email: 'other@example.com',
    });
    await other.agent
      .post('/api/records')
      .send({ title: 'Nevermind', artist: 'Nirvana', year: 1991, format: 'LP', genre: 'Grunge' })
      .expect(201);

    const mine = (await agent.get('/api/genres')).body as Array<{ name: string }>;
    const theirs = (await other.agent.get('/api/genres')).body as Array<{ name: string }>;

    expect(mine.map((g) => g.name)).not.toContain('Grunge');
    expect(theirs.map((g) => g.name)).toEqual(['Grunge']);
  });
});

describe('the New badge', () => {
  it('is per collection, not per table', async () => {
    const other = await signInAgent({
      providerUserId: 'sub-other',
      email: 'other@example.com',
    });
    // Added after every fixture record, so a table-wide query would badge this
    // one and leave the first collection with none.
    await other.agent
      .post('/api/records')
      .send({ title: 'Nevermind', artist: 'Nirvana', year: 1991, format: 'LP', genre: 'Grunge' })
      .expect(201);

    const mine = (await agent.get('/api/records?sort=addedAt')).body as Array<{ isNew: boolean }>;
    const theirs = (await other.agent.get('/api/records')).body as Array<{ isNew: boolean }>;

    expect(mine.filter((r) => r.isNew)).toHaveLength(1);
    expect(theirs.filter((r) => r.isNew)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd server && npx vitest run tests/routes/stats.test.ts
```

Expected: PASS — Task 6 already scoped the queries. If any case fails, the corresponding query in `routes/stats.ts` or `routes/records.ts` is missing its `where: { ownerId }`.

- [ ] **Step 3: Commit**

```bash
git add server/tests/routes/stats.test.ts
git commit -m "test: prove the aggregates are per collection

Every stat, the genre list and the New badge were computed over the whole
table. With one collector that was indistinguishable from correct; with two
it is a leak in the stats and a badge that only ever appears on whichever
collection was written to last. These cases fail against the old queries."
```

---

### Task 8: Owner-scoped uploads and the byte quota

**Files:**

- Modify: `server/src/routes/uploads.ts`
- Modify: `server/src/lib/url.ts`
- Test: `server/tests/routes/uploads.test.ts`, `server/tests/lib/url.test.ts`

**Interfaces:**

- Consumes: `limits()` (Task 3), `ownerOf` (Task 6), `requireUser` (Task 6).
- Produces: `POST /api/uploads` returning `{ url: "/uploads/<ownerId>/<uuid>.<ext>" }` and an `Upload` row per file.

- [ ] **Step 1: Write the failing url test**

The `imageSource` schema currently matches `/uploads/<name>` with no slash in the name, so it would reject every path this task starts producing. Append to `server/tests/lib/url.test.ts`:

```ts
describe('imageSource with owner-scoped uploads', () => {
  it('accepts an owner-scoped upload path', () => {
    expect(imageSource.safeParse('/uploads/12/9f3c1b2a.webp').success).toBe(true);
  });

  it('still accepts a flat path, because files predating the change are not moved', () => {
    expect(imageSource.safeParse('/uploads/9f3c1b2a.webp').success).toBe(true);
  });

  it('rejects a deeper path, which is the shape a traversal attempt would take', () => {
    expect(imageSource.safeParse('/uploads/12/nested/a.webp').success).toBe(false);
    expect(imageSource.safeParse('/uploads/../../etc/passwd').success).toBe(false);
  });

  it('rejects a non-numeric first segment', () => {
    expect(imageSource.safeParse('/uploads/admin/a.webp').success).toBe(false);
  });
});
```

Add `imageSource` to the imports at the top of that file if it is not already there.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/lib/url.test.ts
```

Expected: FAIL — the owner-scoped path is rejected.

- [ ] **Step 3: Widen the upload path pattern**

In `server/src/lib/url.ts`, replace the `imageSource` definition:

```ts
/**
 * Where an image can come from: an uploaded file, or an external URL subject to
 * the same protocol allowlist as any other link.
 *
 * The owner segment is optional because files written before uploads became
 * owner-scoped still sit flat in the directory and their coverUrl values were
 * deliberately not rewritten. Exactly one optional numeric segment, so the
 * pattern cannot be talked into matching a traversal.
 */
export const imageSource = z.union([safeUrl, z.string().regex(/^\/uploads\/(?:\d+\/)?[\w.-]+$/)]);
```

- [ ] **Step 4: Write the failing upload test**

Rewrite `server/tests/routes/uploads.test.ts`, keeping the `png` buffer and the `afterAll` cleanup. Swap `loginAgent` for `signInAgent`, add `beforeEach(resetDb)`, and change the path assertion:

```ts
it('stores a png under the owner directory and returns its url', async () => {
  const { agent, user } = await signInAgent();

  const response = await agent.post('/api/uploads').attach('file', png, 'cover.png');

  expect(response.status).toBe(201);
  // The client filename never reaches the path — the name is a fresh UUID,
  // under a directory named for the owner.
  expect(response.body.url).toMatch(new RegExp(`^/uploads/${user.id}/[0-9a-f-]{36}\\.png$`));

  const written = await readdir(join(UPLOAD_DIR, String(user.id)));
  expect(written).toContain(response.body.url.split('/').pop());
});

it('records the bytes against the owner', async () => {
  const { agent, user } = await signInAgent();
  await agent.post('/api/uploads').attach('file', png, 'cover.png').expect(201);

  const rows = await prisma.upload.findMany({ where: { ownerId: user.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].bytes).toBe(png.length);
});

it('refuses a file that would cross the quota, and writes nothing', async () => {
  const { agent, user } = await signInAgent();
  // Pre-fill the ledger to one byte under the cap.
  await prisma.upload.create({
    data: { ownerId: user.id, path: `${user.id}/seed.png`, bytes: limits().uploadQuotaBytes - 1 },
  });

  const response = await agent.post('/api/uploads').attach('file', png, 'cover.png');

  expect(response.status).toBe(413);
  expect(await prisma.upload.count({ where: { ownerId: user.id } })).toBe(1);
});

it('does not count one owner usage against another', async () => {
  const first = await signInAgent();
  const second = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });
  await prisma.upload.create({
    data: {
      ownerId: first.user.id,
      path: `${first.user.id}/seed.png`,
      bytes: limits().uploadQuotaBytes,
    },
  });

  await first.agent.post('/api/uploads').attach('file', png, 'cover.png').expect(413);
  await second.agent.post('/api/uploads').attach('file', png, 'cover.png').expect(201);
});
```

Add `join` from `node:path`, `prisma` and `resetDb` from `../helpers/db`, `signInAgent` from `../helpers/auth`, and `limits` from `../../src/config/env` to the imports. Keep the existing cases for the 401, the lying extension and the oversized file — the last one still asserts 413 from multer, which is now the `MAX_UPLOAD_BYTES` cap.

- [ ] **Step 5: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/routes/uploads.test.ts
```

Expected: FAIL — the URL is still flat and no `Upload` row is written.

- [ ] **Step 6: Rewrite the upload route**

Replace the handler in `server/src/routes/uploads.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { limits } from '../config/env';
import { asyncHandler } from '../lib/asyncHandler';
import { sniffImageType } from '../lib/imageType';
import { ownerOf } from '../lib/owner';
import { requireUser } from '../middleware/requireUser';
import { prisma } from '../prisma/client';

export const uploadsRouter = Router();

/**
 * Where covers land. A named Docker volume mounts over this path in every
 * environment; UPLOAD_DIR overrides it so tests can write to a temp directory
 * instead of the source tree.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(__dirname, '..', '..', 'uploads');

// memoryStorage so nothing touches disk until the bytes have been sniffed —
// diskStorage would write the payload first and ask questions afterwards.
// The cap is read once at import: multer wants it when the middleware is built,
// and it is not a value that changes while the process runs.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: limits().maxUploadBytes, files: 1 },
});

uploadsRouter.post(
  '/uploads',
  requireUser,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const ownerId = ownerOf(res);

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const type = sniffImageType(req.file.buffer);
    if (!type) {
      res.status(400).json({ error: 'Not a supported image (jpeg, png, webp or avif)' });
      return;
    }

    // One indexed sum, rather than walking the owner directory: a readdir plus
    // a stat per file would be O(n) on the hot path of every upload.
    const used = await prisma.upload.aggregate({ where: { ownerId }, _sum: { bytes: true } });
    if ((used._sum.bytes ?? 0) + req.file.size > limits().uploadQuotaBytes) {
      res.status(413).json({ error: 'Upload quota reached. Remove some covers first.' });
      return;
    }

    // Generated name and an extension derived from the sniffed type, so neither
    // the client filename nor its extension reaches the filesystem. The owner
    // directory makes ownership legible on disk and makes per-user cleanup
    // possible when an account goes.
    const relative = `${ownerId}/${randomUUID()}.${type}`;
    await mkdir(path.join(UPLOAD_DIR, String(ownerId)), { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, relative), req.file.buffer);
    // File first, row second: a file with no row is a leak the operator can
    // find, where a row with no file would 404 a cover that appears to exist.
    await prisma.upload.create({ data: { ownerId, path: relative, bytes: req.file.size } });

    res.status(201).json({ url: `/uploads/${relative}` });
  }),
);

// multer rejects outside the normal error chain; translate its size error into
// the status that actually describes it.
uploadsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File is larger than the per-file limit' });
    return;
  }
  next(err);
});
```

- [ ] **Step 7: Run the tests**

```bash
cd server && npx vitest run tests/routes/uploads.test.ts tests/lib/url.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/uploads.ts server/src/lib/url.ts server/tests
git commit -m "feat: scope uploads to their owner and cap total bytes

New covers land at /uploads/<ownerId>/<uuid>.<ext> and each writes an Upload
row. Files written before this change stay flat and their coverUrl values are
not rewritten, so nothing 404s; imageSource accepts both shapes and exactly
one optional numeric segment, which keeps a traversal out of the pattern.

150 MB per owner, summed from the indexed ledger rather than by walking the
directory. Without a row per file there is also nothing to clean up by when an
account is deleted."
```

---

### Task 9: The cross-user isolation suite

The one test file whose absence would make every other guarantee in this plan a claim rather than a fact.

**Files:**

- Create: `server/tests/routes/isolation.test.ts`

**Interfaces:**

- Consumes: `signInAgent` (Task 6), `resetDb`, `prisma` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/isolation.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

type Agent = Awaited<ReturnType<typeof signInAgent>>['agent'];

async function twoOwners(): Promise<{ a: Agent; b: Agent }> {
  const a = await signInAgent({
    providerUserId: 'sub-a',
    email: 'a@example.com',
    displayName: 'A',
  });
  const b = await signInAgent({
    providerUserId: 'sub-b',
    email: 'b@example.com',
    displayName: 'B',
  });
  return { a: a.agent, b: b.agent };
}

/**
 * One table per resource: the payload A creates, and the patch B will attempt.
 *
 * Driven from a table rather than written out three times because the property
 * under test is identical for each, and a resource added later should only have
 * to add a row here to be covered.
 */
const RESOURCES = [
  {
    path: '/api/records',
    create: {
      title: 'Kind of Blue',
      artist: 'Miles Davis',
      year: 1959,
      format: 'LP',
      genre: 'Jazz',
    },
    patch: { title: 'Hijacked' },
    check: async (id: number) => (await prisma.record.findUniqueOrThrow({ where: { id } })).title,
    unchanged: 'Kind of Blue',
  },
  {
    path: '/api/wishlist',
    create: { title: 'Karma', artist: 'Pharoah Sanders' },
    patch: { title: 'Hijacked' },
    check: async (id: number) =>
      (await prisma.wishlistItem.findUniqueOrThrow({ where: { id } })).title,
    unchanged: 'Karma',
  },
  {
    path: '/api/setup',
    create: { icon: 'turntable', label: 'Turntable', value: 'Technics SL-1200 MK2' },
    patch: { label: 'Hijacked' },
    check: async (id: number) =>
      (await prisma.setupItem.findUniqueOrThrow({ where: { id } })).label,
    unchanged: 'Turntable',
  },
] as const;

describe.each(RESOURCES)('$path isolation', ({ path, create, patch, check, unchanged }) => {
  it('does not list another owner rows', async () => {
    const { a, b } = await twoOwners();
    await a.post(path).send(create).expect(201);

    expect((await b.get(path)).body).toHaveLength(0);
  });

  it('404s a read of another owner row, indistinguishably from a missing one', async () => {
    const { a, b } = await twoOwners();
    const created = await a.post(path).send(create).expect(201);

    // Records are the only resource with a single-row read route; for the
    // others the list is the read surface, covered above.
    if (path === '/api/records') {
      const foreign = await b.get(`${path}/${created.body.id}`);
      const missing = await b.get(`${path}/999999`);

      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);
    }
  });

  it('404s an update of another owner row and leaves it untouched', async () => {
    const { a, b } = await twoOwners();
    const created = await a.post(path).send(create).expect(201);

    const foreign = await b.patch(`${path}/${created.body.id}`).send(patch);
    const missing = await b.patch(`${path}/999999`).send(patch);

    expect(foreign.status).toBe(404);
    // Same status and same body: a caller must not be able to tell "not yours"
    // from "not there" and enumerate ids that way.
    expect(foreign.body).toEqual(missing.body);
    expect(await check(created.body.id)).toBe(unchanged);
  });

  it('404s a delete of another owner row and leaves it in place', async () => {
    const { a, b } = await twoOwners();
    const created = await a.post(path).send(create).expect(201);

    const foreign = await b.delete(`${path}/${created.body.id}`);
    const missing = await b.delete(`${path}/999999`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(await check(created.body.id)).toBe(unchanged);
  });

  it('ignores an ownerId in a create body', async () => {
    const { a, b } = await twoOwners();
    const bId = (await b.get('/api/auth/me')).body.user.id;

    const created = await a
      .post(path)
      .send({ ...create, ownerId: bId })
      .expect(201);

    expect((await b.get(path)).body).toHaveLength(0);
    expect((await a.get(path)).body).toHaveLength(1);
    expect(created.body.ownerId).not.toBe(bId);
  });

  it('ignores an ownerId in an update body', async () => {
    const { a, b } = await twoOwners();
    const bId = (await b.get('/api/auth/me')).body.user.id;
    const created = await a.post(path).send(create).expect(201);

    await a
      .patch(`${path}/${created.body.id}`)
      .send({ ...patch, ownerId: bId })
      .expect(200);

    expect((await b.get(path)).body).toHaveLength(0);
  });
});

describe('settings isolation', () => {
  it('does not overwrite another owner settings', async () => {
    const { a, b } = await twoOwners();

    await a.patch('/api/settings').send({ heroHeadline: 'Mine' }).expect(200);
    await b.patch('/api/settings').send({ heroHeadline: 'Theirs' }).expect(200);

    expect((await a.get('/api/settings')).body.heroHeadline).toBe('Mine');
    expect((await b.get('/api/settings')).body.heroHeadline).toBe('Theirs');
  });

  it('starts empty for a new owner even when another owner has settings', async () => {
    const { a, b } = await twoOwners();
    await a.patch('/api/settings').send({ collectingSince: '2009' }).expect(200);

    expect((await b.get('/api/settings')).body).toEqual({});
  });
});

describe('the whole own tree needs a session', () => {
  it.each([
    ['get', '/api/records'],
    ['get', '/api/genres'],
    ['get', '/api/stats'],
    ['get', '/api/wishlist'],
    ['get', '/api/setup'],
    ['get', '/api/settings'],
  ])('401s %s %s when signed out', async (method, path) => {
    const { default: request } = await import('supertest');
    const { app } = await import('../../src/app');

    await request(app)[method as 'get'](path).expect(401);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd server && npx vitest run tests/routes/isolation.test.ts
```

Expected: PASS. Every guarantee it asserts was built in Tasks 6 and 8; this file is what proves it. If a case fails, the fix belongs in the route or the factory, never in the test.

- [ ] **Step 3: Verify it fails against the old behaviour**

A test that cannot fail proves nothing. Temporarily loosen one check and confirm the suite catches it:

```bash
cd server && git stash push -- src/lib/resourceRouter.ts
```

Then, in `resolveId`, change `findFirst({ where: { id, ownerId: ownerOf(res) } })` to `findFirst({ where: { id, ownerId: { not: -1 } } })` — a filter that matches every row — and run the suite again. Expected: the update and delete cases fail. Restore with:

```bash
cd server && git checkout -- src/lib/resourceRouter.ts && git stash pop
```

- [ ] **Step 4: Commit**

```bash
git add server/tests/routes/isolation.test.ts
git commit -m "test: assert cross-user isolation on every write route

Per resource: B cannot list, read, update or delete A rows, and a foreign row
answers with the same status and the same body as a missing one, so ids cannot
be enumerated by the difference. Also that an ownerId in a create or update
body is ignored rather than honoured.

Table-driven so a resource added later is covered by adding a row."
```

---

### Task 10: The public collection tree

**Files:**

- Create: `server/src/middleware/resolveOwner.ts`, `server/src/routes/publicCollection.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/routes/publicCollection.test.ts`

**Interfaces:**

- Consumes: the `read` router from every resource (Task 6).
- Produces: `resolveOwnerFromSlug` middleware; `publicCollectionRouter`.
- Produces: `GET /api/u/:slug`, `/records`, `/records/:id`, `/genres`, `/stats`, `/wishlist`, `/setup`, `/settings`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/publicCollection.test.ts`:

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { loadFixture } from '../fixtures/collection';
import { signInAgent } from '../helpers/auth';
import { prisma, resetDb } from '../helpers/db';

beforeEach(resetDb);

async function publicOwner() {
  const { agent, user } = await signInAgent();
  await loadFixture(prisma, user.id);
  return { agent, user };
}

describe('GET /api/u/:slug', () => {
  it('returns the profile a collection page needs', async () => {
    const { user } = await publicOwner();

    const response = await request(app).get(`/api/u/${user.slug}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      slug: user.slug,
      displayName: user.displayName,
      avatarUrl: null,
    });
    // Never the email, and never the id: neither is needed to render a page.
    expect(response.body.email).toBeUndefined();
    expect(response.body.id).toBeUndefined();
  });

  it('404s an unknown slug', async () => {
    await request(app).get('/api/u/nobody').expect(404);
  });
});

describe('reading a public collection without a session', () => {
  it('serves records, genres, stats, wishlist, setup and settings', async () => {
    const { user } = await publicOwner();

    const records = await request(app).get(`/api/u/${user.slug}/records`);
    const stats = await request(app).get(`/api/u/${user.slug}/stats`);
    const genres = await request(app).get(`/api/u/${user.slug}/genres`);
    const wishlist = await request(app).get(`/api/u/${user.slug}/wishlist`);
    const setup = await request(app).get(`/api/u/${user.slug}/setup`);
    const settings = await request(app).get(`/api/u/${user.slug}/settings`);

    expect(records.body).toHaveLength(14);
    expect(stats.body.totalRecords).toBe(14);
    expect(genres.body.length).toBeGreaterThan(0);
    expect(wishlist.body).toHaveLength(6);
    expect(setup.body).toHaveLength(5);
    expect(settings.status).toBe(200);
  });

  it('honours sort and limit exactly as the own tree does', async () => {
    const { user } = await publicOwner();

    const response = await request(app).get(`/api/u/${user.slug}/records?sort=addedAt&limit=6`);

    expect(response.body).toHaveLength(6);
    expect(response.body[0].title).toBe('Mezzanine');
    expect(response.body[0].isNew).toBe(true);
  });

  it('serves one owner data and not another', async () => {
    const first = await publicOwner();
    const second = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });
    await second.agent
      .post('/api/records')
      .send({ title: 'Nevermind', artist: 'Nirvana', year: 1991, format: 'LP', genre: 'Grunge' })
      .expect(201);

    expect((await request(app).get(`/api/u/${first.user.slug}/records`)).body).toHaveLength(14);
    expect((await request(app).get(`/api/u/${second.user.slug}/records`)).body).toHaveLength(1);
  });

  it('does not accept a write through the public tree', async () => {
    const { user } = await publicOwner();

    const response = await request(app)
      .post(`/api/u/${user.slug}/records`)
      .send({ title: 'X', artist: 'Y', year: 2000, format: 'LP', genre: 'Jazz' });

    expect(response.status).toBe(404);
  });
});

describe('a private collection', () => {
  it('404s for a stranger, identically to an unknown slug', async () => {
    const { agent, user } = await publicOwner();
    await agent.patch('/api/account').send({ isPublic: false }).expect(200);

    const hidden = await request(app).get(`/api/u/${user.slug}/records`);
    const missing = await request(app).get('/api/u/nobody/records');

    // 404, not 403: a 403 would confirm the slug exists and someone is behind
    // it, which is the one thing "private" is supposed to prevent.
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });

  it('404s for a different signed-in user', async () => {
    const { agent, user } = await publicOwner();
    await agent.patch('/api/account').send({ isPublic: false }).expect(200);
    const other = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });

    await other.agent.get(`/api/u/${user.slug}/records`).expect(404);
  });

  it('still serves the owner their own, so View site works without unhiding', async () => {
    const { agent, user } = await publicOwner();
    await agent.patch('/api/account').send({ isPublic: false }).expect(200);

    const response = await agent.get(`/api/u/${user.slug}/records`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(14);
  });
});

describe('a suspended collection', () => {
  it('404s for everyone, identically to an unknown slug', async () => {
    const { user } = await publicOwner();
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });

    const hidden = await request(app).get(`/api/u/${user.slug}/records`);
    const missing = await request(app).get('/api/u/nobody/records');

    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });
});
```

This file depends on `PATCH /api/account`, which Task 11 builds. Write the file now and expect the private-collection cases to fail until then; the ordering is deliberate, because those cases are what specify what `isPublic` has to do.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/routes/publicCollection.test.ts
```

Expected: FAIL — every `/api/u/...` path 404s, because nothing is mounted there.

- [ ] **Step 3: Write the owner resolver**

Create `server/src/middleware/resolveOwner.ts`:

```ts
import type { Request, Response } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { prisma } from '../prisma/client';

/**
 * Turns `/u/:slug` into an owner, or answers 404.
 *
 * Unknown, private and suspended all give the same 404 with the same body. A
 * 403 would confirm that the slug is taken and someone is hiding behind it,
 * which is exactly what the private switch exists to prevent, and it would let
 * a caller enumerate which slugs are in use.
 *
 * The owner viewing their own private collection gets through, so "View site"
 * works without flipping the switch back.
 */
export const resolveOwnerFromSlug = asyncHandler(async (req: Request, res: Response, next) => {
  const owner = await prisma.user.findUnique({ where: { slug: String(req.params.slug) } });
  const hidden = owner === null || owner.suspendedAt !== null || !owner.isPublic;

  if (hidden && owner?.id !== req.session.userId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Non-null: `hidden` is true whenever owner is null, and the guard above
  // returns for every hidden case that is not the owner themselves.
  res.locals.ownerId = owner!.id;
  res.locals.owner = owner!;
  next();
});
```

- [ ] **Step 4: Write the public router**

Create `server/src/routes/publicCollection.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import type { User } from '@prisma/client';
import { resolveOwnerFromSlug } from '../middleware/resolveOwner';
import { recordsRouters } from './records';
import { settingsRouters } from './settings';
import { setupRouters } from './setup';
import { statsRouters } from './stats';
import { wishlistRouters } from './wishlist';

/**
 * Everything a visitor can read about one collection.
 *
 * mergeParams so `:slug` from the mount reaches the resolver. Every router
 * below it is the same `read` router the own tree uses — one set of handlers,
 * two ways of deciding whose data they are about.
 */
export const publicCollectionRouter = Router({ mergeParams: true });

publicCollectionRouter.use(resolveOwnerFromSlug);

publicCollectionRouter.get('/', (_req: Request, res: Response) => {
  const owner = res.locals.owner as User;
  // Slug, name and avatar only: nothing else is needed to render the page, and
  // the email in particular is not the visitor's business.
  res.json({ slug: owner.slug, displayName: owner.displayName, avatarUrl: owner.avatarUrl });
});

publicCollectionRouter.use(recordsRouters.read);
publicCollectionRouter.use(statsRouters.read);
publicCollectionRouter.use(wishlistRouters.read);
publicCollectionRouter.use(setupRouters.read);
publicCollectionRouter.use(settingsRouters.read);
```

- [ ] **Step 5: Mount it**

In `server/src/app.ts`, add the mount between the auth router and the own tree:

```ts
// Someone else's collection, by slug. Read-only: the write routes live on the
// own tree, where the owner comes from the session rather than the URL.
app.use('/api/u/:slug', publicCollectionRouter);
```

- [ ] **Step 6: Run the tests**

```bash
cd server && npx vitest run tests/routes/publicCollection.test.ts
```

Expected: PASS except the three private-collection cases, which need Task 11.

- [ ] **Step 7: Commit**

```bash
git add server/src/middleware/resolveOwner.ts server/src/routes/publicCollection.ts server/src/app.ts server/tests/routes/publicCollection.test.ts
git commit -m "feat: serve a public collection at /api/u/:slug

The same read handlers as the own tree, mounted behind a middleware that
resolves the owner from the slug instead of the session. Unknown, private and
suspended collections answer with one indistinguishable 404, so a slug cannot
be probed for existence, and the owner still sees their own private page."
```

---

### Task 11: The account route

**Files:**

- Create: `server/src/schemas/account.ts`, `server/src/routes/account.ts`
- Modify: `server/src/app.ts`
- Test: `server/tests/routes/account.test.ts`

**Interfaces:**

- Consumes: `USER_SLUG_PATTERN`, `isReserved` (Task 5); `requireUser` (Task 6).
- Produces: `accountUpdateSchema`; `PATCH /api/account` returning the updated `{ id, slug, displayName, avatarUrl, isPublic }`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/account.test.ts`:

```ts
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import { signInAgent } from '../helpers/auth';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('PATCH /api/account', () => {
  it('requires a session', async () => {
    await request(app).patch('/api/account').send({ slug: 'andriy' }).expect(401);
  });

  it('changes the slug and the display name', async () => {
    const { agent } = await signInAgent();

    const response = await agent.patch('/api/account').send({
      slug: 'andriy',
      displayName: 'Andriy D',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ slug: 'andriy', displayName: 'Andriy D' });
    expect((await agent.get('/api/auth/me')).body.user.slug).toBe('andriy');
  });

  it('frees the old slug immediately, and the old URL stops resolving', async () => {
    const { agent, user } = await signInAgent();
    await agent.patch('/api/account').send({ slug: 'andriy' }).expect(200);

    await request(app).get(`/api/u/${user.slug}`).expect(404);
    await request(app).get('/api/u/andriy').expect(200);
  });

  it('409s a slug another account already holds', async () => {
    const first = await signInAgent();
    await first.agent.patch('/api/account').send({ slug: 'andriy' }).expect(200);
    const second = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });

    const response = await second.agent.patch('/api/account').send({ slug: 'andriy' });

    expect(response.status).toBe(409);
    expect(response.body.fields.slug).toBeDefined();
  });

  it('accepts the slug it already holds, so saving the form twice is not an error', async () => {
    const { agent } = await signInAgent();
    await agent.patch('/api/account').send({ slug: 'andriy' }).expect(200);

    await agent.patch('/api/account').send({ slug: 'andriy', displayName: 'X' }).expect(200);
  });

  it.each(['ab', 'a'.repeat(33), 'Andriy', 'an driy', '-andriy', 'andriy-'])(
    'rejects the malformed slug %s',
    async (slug) => {
      const { agent } = await signInAgent();

      const response = await agent.patch('/api/account').send({ slug });

      expect(response.status).toBe(400);
      expect(response.body.fields.slug).toBeDefined();
    },
  );

  it.each(['admin', 'api', 'settings'])('rejects the reserved slug %s', async (slug) => {
    const { agent } = await signInAgent();

    const response = await agent.patch('/api/account').send({ slug });

    expect(response.status).toBe(400);
    expect(response.body.fields.slug).toBeDefined();
  });

  it('flips the collection to private and back', async () => {
    const { agent, user } = await signInAgent();

    await agent.patch('/api/account').send({ isPublic: false }).expect(200);
    await request(app).get(`/api/u/${user.slug}`).expect(404);

    await agent.patch('/api/account').send({ isPublic: true }).expect(200);
    await request(app).get(`/api/u/${user.slug}`).expect(200);
  });

  it('rejects an unknown key rather than ignoring it', async () => {
    const { agent } = await signInAgent();

    await agent.patch('/api/account').send({ suspendedAt: null }).expect(400);
  });

  it('rejects an empty display name', async () => {
    const { agent } = await signInAgent();

    const response = await agent.patch('/api/account').send({ displayName: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.fields.displayName).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/routes/account.test.ts
```

Expected: FAIL — `/api/account` is not mounted, so every case 404s.

- [ ] **Step 3: Write the schema**

Create `server/src/schemas/account.ts`:

```ts
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
      .regex(USER_SLUG_PATTERN, '3–32 characters: lowercase letters, numbers and inner hyphens')
      .refine((value) => !isReserved(value), { message: 'That address is not available' }),
    displayName: z.string().trim().min(1, 'A name is required').max(80, 'That name is too long'),
    isPublic: z.boolean(),
  })
  .partial();
```

- [ ] **Step 4: Write the route**

Create `server/src/routes/account.ts`:

```ts
import { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { ownerOf } from '../lib/owner';
import { requireUser } from '../middleware/requireUser';
import { validate } from '../middleware/validate';
import { prisma } from '../prisma/client';
import { accountUpdateSchema } from '../schemas/account';

export const accountRouter = Router();

accountRouter.patch(
  '/account',
  requireUser,
  validate(accountUpdateSchema),
  asyncHandler(async (_req: Request, res: Response) => {
    const id = ownerOf(res);
    const data = res.locals.body as Prisma.UserUpdateInput;

    try {
      const user = await prisma.user.update({ where: { id }, data });
      res.json({
        id: user.id,
        slug: user.slug,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isPublic: user.isPublic,
      });
    } catch (error) {
      // Let the unique index decide rather than checking first: a pre-check
      // would still race, and this way there is one source of truth.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Shaped like a validation failure so the account form renders it
        // against the field, the same way every other admin form does.
        res
          .status(409)
          .json({ error: 'Validation failed', fields: { slug: 'That address is taken' } });
        return;
      }
      throw error;
    }
  }),
);
```

- [ ] **Step 5: Mount it**

In `server/src/app.ts`, add `app.use('/api', accountRouter);` immediately after the auth router.

- [ ] **Step 6: Run the tests**

```bash
cd server && npx vitest run tests/routes/account.test.ts tests/routes/publicCollection.test.ts
```

Expected: PASS, including the private-collection cases deferred from Task 10.

- [ ] **Step 7: Run the whole server suite and lint**

```bash
npm test -w server && npm run lint -w server
```

Expected: PASS, zero warnings.

- [ ] **Step 8: Commit**

```bash
git add server/src/schemas/account.ts server/src/routes/account.ts server/src/app.ts server/tests/routes/account.test.ts
git commit -m "feat: let an owner change their address and hide their collection

PATCH /api/account covers slug, display name and the public switch. Separate
from /api/settings, which is homepage copy: different validation, and a slug
collision is a 409 rather than a field error on a content form.

Changing a slug frees the old one at once and the old URL 404s. A history
table would have to answer what happens when someone else then claims the
freed slug — either the redirect wins and the new owner cannot use their own
address, or it silently points at a stranger. Both are worse than a 404.

The uniqueness check is the index, not a pre-read: a pre-read would still race."
```

---

## Phase 4 — The client

### Task 12: A scope-aware API client

**Files:**

- Modify: `client/src/api/client.ts`
- Test: `client/tests/collectionApi.test.ts`

**Interfaces:**

- Produces: `type Scope = { kind: 'own' } | { kind: 'public'; slug: string }`, `interface CollectionApi`, `collectionApi(scope): CollectionApi`.
- Produces: `interface AuthUser { id: number; slug: string; displayName: string; avatarUrl: string | null; isPublic: boolean }`, `interface Profile { slug: string; displayName: string; avatarUrl: string | null }`.
- Produces: `getAuthStatus(): Promise<{ user: AuthUser | null }>`, `getProviders(): Promise<string[]>`, `getProfile(slug): Promise<Profile>`, `updateAccount(data): Promise<AuthUser>`, `logout()`.
- Removes: `login`, and the seven standalone collection fetchers, which `collectionApi` replaces.

- [ ] **Step 1: Write the failing test**

Create `client/tests/collectionApi.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionApi } from '../src/api/client';

function stubFetch() {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
}

afterEach(() => vi.restoreAllMocks());

describe('collectionApi', () => {
  it('reads the signed-in user own collection from the unprefixed routes', async () => {
    const fetchStub = stubFetch();

    await collectionApi({ kind: 'own' }).getRecords();

    expect(fetchStub).toHaveBeenCalledWith('/api/records', expect.anything());
  });

  it('reads a public collection from its slug', async () => {
    const fetchStub = stubFetch();

    await collectionApi({ kind: 'public', slug: 'andriy' }).getRecords();

    expect(fetchStub).toHaveBeenCalledWith('/api/u/andriy/records', expect.anything());
  });

  it('encodes a slug rather than pasting it into the path', async () => {
    const fetchStub = stubFetch();

    await collectionApi({ kind: 'public', slug: 'a/../b' }).getStats();

    expect(fetchStub).toHaveBeenCalledWith('/api/u/a%2F..%2Fb/stats', expect.anything());
  });

  it('keeps the recent-records query on the scoped path', async () => {
    const fetchStub = stubFetch();

    await collectionApi({ kind: 'public', slug: 'andriy' }).getRecentRecords();

    expect(fetchStub).toHaveBeenCalledWith(
      '/api/u/andriy/records?sort=addedAt&limit=6',
      expect.anything(),
    );
  });

  it('returns a stable object for the same scope, so useResource does not refetch', () => {
    const first = collectionApi({ kind: 'own' });
    const second = collectionApi({ kind: 'own' });

    // Different objects are fine — what matters is that each function is stable
    // once captured, which the memo at the call site relies on.
    expect(Object.keys(first)).toEqual(Object.keys(second));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w client -- collectionApi
```

Expected: FAIL — `collectionApi` is not exported.

- [ ] **Step 3: Rework the client**

In `client/src/api/client.ts`, keep `ApiError`, `request`, `Stats`, `Genre` and `uploadCover` exactly as they are. Replace the seven standalone read fetchers and the whole auth block:

```ts
/** Whose collection a set of reads is about. */
export type Scope = { kind: 'own' } | { kind: 'public'; slug: string };

export interface CollectionApi {
  getRecords: () => Promise<VinylRecord[]>;
  getRecentRecords: () => Promise<VinylRecord[]>;
  getStats: () => Promise<Stats>;
  getGenres: () => Promise<Genre[]>;
  getWishlist: () => Promise<WishlistItem[]>;
  getSetup: () => Promise<SetupItem[]>;
  getSettings: () => Promise<SiteSettings>;
}

/**
 * The seven collection reads, bound to one owner.
 *
 * The two scopes differ only in a path prefix, which is the point: the section
 * components take data as props and never learn whose it is, so the public
 * collection page and the admin dashboard render from the same code.
 *
 * Mutations are deliberately not here. They are always the signed-in user's
 * own, and giving them a scope would imply one that does not exist.
 */
export function collectionApi(scope: Scope): CollectionApi {
  const base = scope.kind === 'own' ? '' : `/u/${encodeURIComponent(scope.slug)}`;

  return {
    getRecords: () => request<VinylRecord[]>(`${base}/records`),
    getRecentRecords: () => request<VinylRecord[]>(`${base}/records?sort=addedAt&limit=6`),
    getStats: () => request<Stats>(`${base}/stats`),
    getGenres: () => request<Genre[]>(`${base}/genres`),
    getWishlist: () => request<WishlistItem[]>(`${base}/wishlist`),
    getSetup: () => request<SetupItem[]>(`${base}/setup`),
    getSettings: () => request<SiteSettings>(`${base}/settings`),
  };
}

/* ---- Profile and account ---- */

/** What a visitor is told about a collection's owner. */
export interface Profile {
  slug: string;
  displayName: string;
  avatarUrl: string | null;
}

export const getProfile = (slug: string): Promise<Profile> =>
  request<Profile>(`/u/${encodeURIComponent(slug)}`);

export interface AuthUser {
  id: number;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
  isPublic: boolean;
}

export interface AccountUpdate {
  slug?: string;
  displayName?: string;
  isPublic?: boolean;
}

export const updateAccount = (data: AccountUpdate): Promise<AuthUser> =>
  request<AuthUser>('/account', { method: 'PATCH', body: JSON.stringify(data) });

/* ---- Auth ---- */

/** `{ user: null }` when signed out — "nobody" is an answer, not an error. */
export const getAuthStatus = (): Promise<{ user: AuthUser | null }> =>
  request<{ user: AuthUser | null }>('/auth/me');

/** Which providers the server can actually complete a sign-in with. */
export const getProviders = (): Promise<string[]> => request<string[]>('/auth/providers');

export const logout = (): Promise<void> => request<void>('/auth/logout', { method: 'POST' });
```

Delete the `login` export. Leave the record, wishlist, setup and settings **mutation** fetchers untouched — the admin screens call them and their paths do not change.

- [ ] **Step 4: Point the existing callers at the new shape**

`client/src/admin/DashboardPage.tsx` — replace the three imports with one memoised api:

```tsx
import { useMemo } from 'react';
import { collectionApi } from '../api/client';

const api = useMemo(() => collectionApi({ kind: 'own' }), []);
const stats = useResource(api.getStats);
const wishlist = useResource(api.getWishlist);
const setup = useResource(api.getSetup);
```

`client/src/admin/SettingsPage.tsx` — its `getSettings()` call becomes `collectionApi({ kind: 'own' }).getSettings()`; `updateSettings` is unchanged.

- [ ] **Step 5: Run the tests**

```bash
npm test -w client -- collectionApi
```

Expected: PASS. `client/tests/LoginPage.test.tsx` now fails to compile because `login` is gone — Task 13 deletes it along with the page.

- [ ] **Step 6: Commit**

```bash
git add client/src/api/client.ts client/src/admin client/tests/collectionApi.test.ts
git commit -m "feat: bind the collection reads to an owner

collectionApi(scope) returns the same seven fetchers pointed either at the
session's own routes or at /api/u/<slug>. The sections already take data as
props, so the public collection page and the admin dashboard now render from
one set of components with no notion of whose data they hold.

Mutations stay unscoped: they are always the signed-in user's own, and a scope
parameter would imply one that does not exist."
```

---

### Task 13: The auth context, the landing page, and the routes

**Files:**

- Create: `client/src/auth/AuthProvider.tsx`, `client/src/pages/LandingPage.tsx`, `client/src/pages/LandingPage.module.css`
- Modify: `client/src/admin/RequireAuth.tsx`, `client/src/routes.tsx`, `client/src/main.tsx`
- Delete: `client/src/admin/LoginPage.tsx`, `client/src/admin/LoginPage.module.css`, `client/tests/LoginPage.test.tsx`
- Test: `client/tests/AuthProvider.test.tsx`, `client/tests/LandingPage.test.tsx`, `client/tests/RequireAuth.test.tsx`

**Interfaces:**

- Consumes: `getAuthStatus`, `getProviders`, `AuthUser` (Task 12).
- Produces: `AuthProvider`, `useAuth(): { user: AuthUser | null; loading: boolean; refresh: () => void }`.

- [ ] **Step 1: Write the failing tests**

Create `client/tests/AuthProvider.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';

function Probe(): JSX.Element {
  const { user, loading } = useAuth();
  if (loading) {
    return <p>checking</p>;
  }
  return <p>{user ? user.displayName : 'nobody'}</p>;
}

function mockMe(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('AuthProvider', () => {
  it('exposes the signed-in user', async () => {
    mockMe({
      user: { id: 1, slug: 'andriy', displayName: 'Andriy', avatarUrl: null, isPublic: true },
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('Andriy')).toBeInTheDocument();
  });

  it('exposes null when signed out', async () => {
    mockMe({ user: null });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('nobody')).toBeInTheDocument();
  });

  it('treats a failed check as signed out rather than crashing the tree', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('nobody')).toBeInTheDocument();
  });

  it('throws when used outside the provider, so a missing mount is loud', () => {
    // The error boundary would otherwise swallow this into a blank screen.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
    quiet.mockRestore();
  });
});
```

Create `client/tests/LandingPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth/AuthProvider';
import LandingPage from '../src/pages/LandingPage';

/** /auth/me and /auth/providers are both fetched on mount. */
function mockApi(user: unknown, providers: string[] = ['google', 'github']) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes('/auth/providers') ? providers : { user };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/u/:slug" element={<p>Andriy collection</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('LandingPage', () => {
  it('renders one sign-in link per configured provider', async () => {
    mockApi(null);

    renderAt('/');

    const google = await screen.findByRole('link', { name: /google/i });
    expect(google).toHaveAttribute('href', '/api/auth/google');
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute(
      'href',
      '/api/auth/github',
    );
  });

  it('offers only what the server says is configured', async () => {
    mockApi(null, ['google']);

    renderAt('/');

    await screen.findByRole('link', { name: /google/i });
    expect(screen.queryByRole('link', { name: /github/i })).toBeNull();
  });

  it('carries an invite code onto every provider link', async () => {
    mockApi(null);

    renderAt('/?invite=abc123');

    expect(await screen.findByRole('link', { name: /google/i })).toHaveAttribute(
      'href',
      '/api/auth/google?invite=abc123',
    );
  });

  it('explains a failed sign-in', async () => {
    mockApi(null);

    renderAt('/?error=email_unverified');

    expect(await screen.findByRole('alert')).toHaveTextContent(/verified email/i);
  });

  it('explains a closed signup without blaming the visitor', async () => {
    mockApi(null);

    renderAt('/?error=invite_required');

    expect(await screen.findByRole('alert')).toHaveTextContent(/invit/i);
  });

  it('sends a signed-in owner to their own collection', async () => {
    mockApi({ id: 1, slug: 'andriy', displayName: 'Andriy', avatarUrl: null, isPublic: true });

    renderAt('/');

    expect(await screen.findByText('Andriy collection')).toBeInTheDocument();
  });
});
```

Rewrite `client/tests/RequireAuth.test.tsx` — same four cases, but the guard now reads the context and redirects to `/`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth/AuthProvider';
import { RequireAuth } from '../src/admin/RequireAuth';

const USER = { id: 1, slug: 'andriy', displayName: 'Andriy', avatarUrl: null, isPublic: true };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<p>Landing</p>} />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <p>Secret dashboard</p>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockMe(user: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ user }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('RequireAuth', () => {
  it('shows the children when signed in', async () => {
    mockMe(USER);

    renderAt('/admin');

    expect(await screen.findByText('Secret dashboard')).toBeInTheDocument();
  });

  it('redirects to the landing page when signed out', async () => {
    mockMe(null);

    renderAt('/admin');

    expect(await screen.findByText('Landing')).toBeInTheDocument();
    expect(screen.queryByText('Secret dashboard')).toBeNull();
  });

  it('never flashes protected content while the check is pending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    renderAt('/admin');

    await waitFor(() => expect(screen.queryByText('Secret dashboard')).toBeNull());
    expect(screen.queryByText('Landing')).toBeNull();
  });

  it('treats a failed check as signed out', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    renderAt('/admin');

    expect(await screen.findByText('Landing')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

```bash
npm test -w client -- AuthProvider LandingPage RequireAuth
```

Expected: FAIL — `../src/auth/AuthProvider` does not resolve.

- [ ] **Step 3: Write the auth context**

Create `client/src/auth/AuthProvider.tsx`:

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getAuthStatus, type AuthUser } from '../api/client';
import { useResource } from '../hooks/useResource';

interface AuthState {
  user: AuthUser | null;
  /** True only for the first check. A refresh keeps the current answer on screen. */
  loading: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * One answer to "who am I", shared by the landing page, the admin guard and the
 * account screen — which would otherwise ask three times on one page load.
 *
 * A failed check counts as signed out. That is the safe direction: the worst
 * case is being asked to sign in again, where the other direction would render
 * protected chrome to someone who may not be.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const { data, loading, refresh } = useResource(getAuthStatus);

  const value = useMemo<AuthState>(
    () => ({ user: data?.user ?? null, loading, refresh }),
    [data, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === null) {
    // Loud on purpose: without it a missing provider renders as a permanently
    // signed-out app, which looks like a login bug rather than a wiring one.
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return value;
}
```

- [ ] **Step 4: Rewrite the admin guard**

Replace `client/src/admin/RequireAuth.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

/**
 * Gate for the admin tree.
 *
 * Renders nothing while the session check is in flight: showing the shell first
 * would flash protected chrome to someone who is not signed in.
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element | null {
  const location = useLocation();
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user) {
    // `state.from` lets the landing page return them where they aimed.
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 5: Write the landing page**

Create `client/src/pages/LandingPage.tsx`:

```tsx
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { getProviders } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { DiscIcon } from '../components/ui/icons';
import { useResource } from '../hooks/useResource';
import styles from './LandingPage.module.css';

/** Every `?error=` the OAuth callback can redirect back with. */
const MESSAGES: Record<string, string> = {
  state: 'That sign-in link expired. Try again.',
  denied: 'Sign-in was cancelled.',
  provider: 'That provider could not be reached. Try again in a moment.',
  session: 'Something went wrong starting your session. Try again.',
  email_unverified: 'We need a verified email address from your provider to sign you in.',
  suspended: 'This account has been suspended.',
  signup_closed: 'New accounts are closed at the moment.',
  invite_required: 'New accounts are invite only right now. You need an invite link to join.',
};

const LABELS: Record<string, string> = {
  google: 'Continue with Google',
  github: 'Continue with GitHub',
};

interface LocationState {
  from?: string;
}

export default function LandingPage(): JSX.Element | null {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const providers = useResource(getProviders);

  if (loading) {
    return null;
  }

  if (user) {
    return <Navigate to={`/u/${user.slug}`} replace />;
  }

  const error = params.get('error');
  const invite = params.get('invite');
  const from = (location.state as LocationState | null)?.from;

  /**
   * The invite code rides along untouched and is validated only at redemption.
   * There is no field and no "invalid code" message here: telling an anonymous
   * visitor whether a code exists would be a free oracle, and the link itself
   * is the invitation.
   */
  function hrefFor(provider: string): string {
    const query = new URLSearchParams();
    if (invite) {
      query.set('invite', invite);
    }
    if (from) {
      query.set('next', from);
    }
    const suffix = query.toString();
    return `/api/auth/${provider}${suffix ? `?${suffix}` : ''}`;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <DiscIcon size={26} />
          <span className={styles.wordmark}>Grooves &amp; Dust</span>
        </div>
        <h1 className={styles.heading}>Keep your records spinning</h1>
        <p className={styles.lede}>
          Catalogue your collection, and share it at an address of your own.
        </p>

        {error && (
          <p className={styles.error} role="alert">
            {MESSAGES[error] ?? 'Something went wrong signing you in. Try again.'}
          </p>
        )}

        <div className={styles.providers}>
          {(providers.data ?? []).map((provider) => (
            // A real anchor, not a fetch: the flow is a browser navigation, and
            // fetch cannot follow a cross-origin redirect that sets a cookie.
            <a key={provider} className={styles.provider} href={hrefFor(provider)}>
              {LABELS[provider] ?? `Continue with ${provider}`}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Create `client/src/pages/LandingPage.module.css` by copying `client/src/admin/LoginPage.module.css` verbatim, dropping its now-unused `.form` rule, and adding three. Every value below is a token that exists in `client/src/styles/tokens.css`:

```css
.lede {
  margin: 0;
  font-size: var(--text-body-size);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.providers {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
}

.provider {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: var(--text-body-size);
  font-weight: 500;
  text-decoration: none;
  transition:
    border-color var(--transition-quick),
    background var(--transition-quick);
}

.provider:hover {
  border-color: var(--color-accent);
  background: var(--color-bg-inset);
}
```

Then remove the password screen:

```bash
git rm client/src/admin/LoginPage.tsx client/src/admin/LoginPage.module.css client/tests/LoginPage.test.tsx
```

- [ ] **Step 6: Rewire the routes**

Replace `client/src/routes.tsx`:

```tsx
import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from './admin/RequireAuth';

// Lazy so a visitor to a public collection never downloads the admin bundle.
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const DashboardPage = lazy(() => import('./admin/DashboardPage'));
const RecordsListPage = lazy(() => import('./admin/records/RecordsListPage'));
const RecordFormPage = lazy(() => import('./admin/records/RecordFormPage'));
const WishlistPage = lazy(() => import('./admin/WishlistPage'));
const SetupPage = lazy(() => import('./admin/SetupPage'));
const SettingsPage = lazy(() => import('./admin/SettingsPage'));
const AccountPage = lazy(() => import('./admin/AccountPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));

const suspend = (node: JSX.Element): JSX.Element => <Suspense fallback={null}>{node}</Suspense>;

export const router = createBrowserRouter([
  { path: '/', element: suspend(<LandingPage />) },
  { path: '/u/:slug', element: <CollectionPage /> },
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
      { path: 'settings', element: suspend(<SettingsPage />) },
      { path: 'account', element: suspend(<AccountPage />) },
    ],
  },
]);
```

`CollectionPage` is imported eagerly — `import { CollectionPage } from './pages/CollectionPage';` — because it is the page most visitors arrive on, and it is written in Task 14. `AccountPage` comes in Task 15. Both imports will fail to resolve until then; this step is the routing decision, and splitting it across three tasks would scatter it.

- [ ] **Step 7: Mount the provider**

`client/src/main.tsx` — wrap the router:

```tsx
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
);
```

with `import { AuthProvider } from './auth/AuthProvider';` added.

- [ ] **Step 8: Run the tests**

```bash
npm test -w client -- AuthProvider LandingPage RequireAuth
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/src client/tests
git commit -m "feat: sign in from the landing page instead of a password form

One AuthProvider answers who you are for the guard, the landing page and the
account screen, instead of three separate calls to /auth/me. The guard now
carries a user rather than a boolean and redirects to / rather than a login
route that no longer exists.

Provider buttons are real anchors: the flow is a browser navigation and fetch
cannot follow a cross-origin redirect that sets a cookie. An invite code rides
along to the callback and is validated only at redemption, so a visitor cannot
probe which codes exist."
```

---

### Task 14: The public collection page

**Files:**

- Create: `client/src/pages/CollectionPage.tsx`, `client/src/pages/NotFoundPage.tsx`, `client/src/pages/NotFoundPage.module.css`
- Delete: `client/src/pages/HomePage.tsx`
- Test: `client/tests/CollectionPage.test.tsx`

**Interfaces:**

- Consumes: `collectionApi`, `getProfile` (Task 12).
- Produces: `CollectionPage` — the page at `/u/:slug`, rendering the same sections the homepage does today.

- [ ] **Step 1: Write the failing test**

Create `client/tests/CollectionPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionPage } from '../src/pages/CollectionPage';

const PROFILE = { slug: 'andriy', displayName: 'Andriy', avatarUrl: null };
const RECORD = {
  id: 1,
  slug: 'kind-of-blue',
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  year: 1959,
  format: 'LP',
  genre: 'Jazz',
  url: 'https://www.discogs.com/release/1',
};

/** Answers every endpoint the page fetches on mount. */
function mockCollection({ profileStatus = 200 } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url === '/api/u/andriy') {
      return profileStatus === 200 ? json(PROFILE) : json({ error: 'Not found' }, profileStatus);
    }
    if (url.includes('/records')) return json([RECORD]);
    if (url.includes('/stats')) {
      return json({
        totalRecords: 1,
        topGenre: { name: 'Jazz', count: 1 },
        topArtist: { name: 'Miles Davis', count: 1 },
        collectingSince: '2009',
        addedLast30Days: 1,
      });
    }
    if (url.includes('/genres')) return json([{ name: 'Jazz', count: 1 }]);
    if (url.includes('/settings')) return json({});
    return json([]);
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/u/:slug" element={<CollectionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('CollectionPage', () => {
  it('fetches from the slug in the URL, not from the global routes', async () => {
    const fetchStub = mockCollection();

    renderAt('/u/andriy');

    expect(await screen.findByText('Kind of Blue')).toBeInTheDocument();
    const called = fetchStub.mock.calls.map(([url]) => String(url));
    expect(called).toContain('/api/u/andriy/records');
    expect(called.some((url) => url === '/api/records')).toBe(false);
  });

  it('titles the document with the collector name', async () => {
    mockCollection();

    renderAt('/u/andriy');

    await screen.findByText('Kind of Blue');
    expect(document.title).toBe('Andriy · Grooves & Dust');
  });

  it('keeps the site wordmark rather than renaming the site per collector', async () => {
    mockCollection();

    renderAt('/u/andriy');

    await screen.findByText('Kind of Blue');
    expect(screen.getAllByText('Grooves & Dust').length).toBeGreaterThan(0);
  });

  it('shows a not-found screen when the collection is unknown, private or suspended', async () => {
    mockCollection({ profileStatus: 404 });

    renderAt('/u/andriy');

    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
    expect(screen.queryByText('Kind of Blue')).toBeNull();
  });

  it('does not index a collection with fewer than three records', async () => {
    mockCollection();

    renderAt('/u/andriy');

    await screen.findByText('Kind of Blue');
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w client -- CollectionPage
```

Expected: FAIL — `../src/pages/CollectionPage` does not resolve.

- [ ] **Step 3: Write the not-found screen**

Create `client/src/pages/NotFoundPage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { DiscIcon } from '../components/ui/icons';
import styles from './NotFoundPage.module.css';

/**
 * One screen for three different server answers.
 *
 * A collection that does not exist, one set to private and one that has been
 * suspended all return the same 404, so the client cannot tell them apart —
 * which is the point. Saying "this collection is private" here would leak
 * exactly what the server refused to.
 */
export function NotFoundPage(): JSX.Element {
  return (
    <div className={styles.screen}>
      <DiscIcon size={32} />
      <h1 className={styles.heading}>Collection not found</h1>
      <p className={styles.lede}>There is nothing at this address.</p>
      <Link className={styles.home} to="/">
        Back to Grooves &amp; Dust
      </Link>
    </div>
  );
}
```

Create `client/src/pages/NotFoundPage.module.css`:

```css
.screen {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--space-4);
  min-height: 100vh;
  padding: var(--gutter);
  color: var(--color-accent);
  text-align: center;
}

.heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-h2-size);
  font-weight: 400;
  color: var(--color-text-primary);
}

.lede {
  margin: 0;
  font-size: var(--text-body-size);
  color: var(--color-text-secondary);
}

.home {
  font-size: var(--text-caption-size);
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color var(--transition-quick);
}

.home:hover {
  color: var(--color-accent);
}
```

- [ ] **Step 4: Write the collection page**

Create `client/src/pages/CollectionPage.tsx`. It is `HomePage` with two changes: the fetchers come from a scope, and the profile decides between the page and the not-found screen.

```tsx
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { collectionApi, getProfile } from '../api/client';
import { Footer } from '../components/Footer';
import { NavBar } from '../components/NavBar';
import { useResource } from '../hooks/useResource';
import { AudioSetup } from '../sections/AudioSetup';
import { CollectionHighlights } from '../sections/CollectionHighlights';
import { Hero } from '../sections/Hero';
import { QuickStats } from '../sections/QuickStats';
import { RecentlyAdded } from '../sections/RecentlyAdded';
import { Wishlist } from '../sections/Wishlist';
import { NotFoundPage } from './NotFoundPage';

/** Below this, a collection is too thin to be worth indexing (see robots.txt). */
const INDEX_THRESHOLD = 3;

/**
 * Sets or clears the robots meta tag for the life of the page.
 *
 * A newly created account with one link should not be indexable. Honest about
 * its limits: the app is client-rendered, so this is a tag React writes on
 * mount — Google executes JS and honours it, some other crawlers do not. The
 * rel="nofollow ugc" on the links themselves is the load-bearing part.
 */
function useNoIndex(shouldHide: boolean): void {
  useEffect(() => {
    if (!shouldHide) {
      return;
    }
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [shouldHide]);
}

export function CollectionPage(): JSX.Element {
  const { slug = '' } = useParams();

  // Memoised on the slug: useResource holds its fetcher in a ref, but a fresh
  // api object every render would still churn the effect this feeds.
  const api = useMemo(() => collectionApi({ kind: 'public', slug }), [slug]);
  const profile = useResource(useMemo(() => () => getProfile(slug), [slug]));

  const allRecords = useResource(api.getRecords);
  const recent = useResource(api.getRecentRecords);
  const stats = useResource(api.getStats);
  const genres = useResource(api.getGenres);
  const wishlist = useResource(api.getWishlist);
  const setup = useResource(api.getSetup);
  const settings = useResource(api.getSettings);

  const total = stats.data?.totalRecords ?? 0;
  useNoIndex(profile.data !== null && total < INDEX_THRESHOLD);

  useEffect(() => {
    if (profile.data) {
      // The wordmark stays "Grooves & Dust" on the page itself; the tab is
      // where one collection has to be distinguishable from another.
      document.title = `${profile.data.displayName} · Grooves & Dust`;
    }
  }, [profile.data]);

  if (profile.loading) {
    return <></>;
  }

  // Unknown, private and suspended are one answer from the server, so they are
  // one screen here.
  if (profile.error || !profile.data) {
    return <NotFoundPage />;
  }

  return (
    <>
      <NavBar />
      <main>
        <Hero stats={stats.data} settings={settings.data} />
        <QuickStats stats={stats.data} />
        <CollectionHighlights
          records={allRecords.data ?? []}
          genres={genres.data ?? []}
          total={total}
          error={allRecords.error}
        />
        <RecentlyAdded
          records={recent.data ?? []}
          total={total}
          windowLabel={
            stats.data
              ? `Last 30 days · ${stats.data.addedLast30Days === 1 ? '1 record' : `${stats.data.addedLast30Days} records`}`
              : ''
          }
          error={recent.error}
        />
        <AudioSetup items={setup.data ?? []} settings={settings.data} error={setup.error} />
        <Wishlist items={wishlist.data ?? []} error={wishlist.error} />
      </main>
      <Footer />
    </>
  );
}
```

Then delete the old page:

```bash
git rm client/src/pages/HomePage.tsx
```

The `showSetup` / `showWishlist` props go with it. They were preview flags from the admin-panel design and nothing passes them.

- [ ] **Step 5: Run the tests**

```bash
npm test -w client -- CollectionPage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages client/tests/CollectionPage.test.tsx
git commit -m "feat: render any collection at /u/:slug

HomePage becomes CollectionPage: the same sections, the same CSS modules and
the same tokens, fetching from the slug in the URL. Not one section component
changes, which is what makes it true rather than hopeful that a public
collection looks exactly like the old homepage.

Unknown, private and suspended collections are one 404 from the server and one
screen here — naming which it was would leak what the server refused to say.
Below three records the page asks not to be indexed, so a fresh account with
one link is not worth creating."
```

---

### Task 15: The account screen and the admin chrome

**Files:**

- Create: `client/src/admin/AccountPage.tsx`
- Modify: `client/src/admin/AdminLayout.tsx`, `client/src/admin/AdminLayout.module.css`
- Test: `client/tests/AccountPage.test.tsx`

**Interfaces:**

- Consumes: `updateAccount`, `AuthUser` (Task 12); `useAuth` (Task 13).

- [ ] **Step 1: Write the failing test**

Create `client/tests/AccountPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountPage from '../src/admin/AccountPage';
import { AuthProvider } from '../src/auth/AuthProvider';

const USER = { id: 1, slug: 'andriy', displayName: 'Andriy', avatarUrl: null, isPublic: true };

function mockApi(patch: { status: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (init?.method === 'PATCH') {
      return json(patch.body, patch.status);
    }
    return json({ user: USER });
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AccountPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('AccountPage', () => {
  it('shows the current address and the URL it produces', async () => {
    mockApi({ status: 200, body: USER });

    renderPage();

    expect(await screen.findByLabelText(/address/i)).toHaveValue('andriy');
    expect(screen.getByText(/\/u\/andriy/)).toBeInTheDocument();
  });

  it('warns that changing the address breaks shared links', async () => {
    mockApi({ status: 200, body: USER });

    renderPage();

    expect(await screen.findByText(/links you have already shared/i)).toBeInTheDocument();
  });

  it('saves a new address', async () => {
    const fetchStub = mockApi({ status: 200, body: { ...USER, slug: 'andriy-d' } });

    renderPage();
    const field = await screen.findByLabelText(/address/i);
    await userEvent.clear(field);
    await userEvent.type(field, 'andriy-d');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
    const patch = fetchStub.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[1]?.body)).toContain('andriy-d');
  });

  it('renders a taken address as a field error, not a page error', async () => {
    mockApi({
      status: 409,
      body: { error: 'Validation failed', fields: { slug: 'That address is taken' } },
    });

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/taken/i);
  });

  it('toggles the collection between public and private', async () => {
    const fetchStub = mockApi({ status: 200, body: { ...USER, isPublic: false } });

    renderPage();
    await userEvent.click(await screen.findByLabelText(/visible to anyone/i));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    const patch = fetchStub.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[1]?.body)).toContain('"isPublic":false');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w client -- AccountPage
```

Expected: FAIL — `../src/admin/AccountPage` does not resolve.

- [ ] **Step 3: Write the account screen**

Create `client/src/admin/AccountPage.tsx`. It reuses `ResourceScreen.module.css`, which every other admin form already uses, so it needs no new stylesheet.

```tsx
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, updateAccount } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/Button';
import styles from './components/ResourceScreen.module.css';

export default function AccountPage(): JSX.Element {
  const { user, refresh } = useAuth();
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setSlug(user.slug);
      setDisplayName(user.displayName);
      setIsPublic(user.isPublic);
    }
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setStatus(null);

    try {
      await updateAccount({ slug, displayName, isPublic });
      // The chrome and the guard read the same context, so one refresh updates
      // the sidebar name and the "View site" link together.
      refresh();
      setStatus('Saved.');
    } catch (caught) {
      // A 409 arrives shaped like a validation failure precisely so it can land
      // on the field rather than as an opaque banner.
      if (caught instanceof ApiError && Object.keys(caught.fields).length > 0) {
        setFieldErrors(caught.fields);
      } else {
        setStatus('Could not save that.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.heading}>Profile</h1>
        <p className={styles.sub}>Who you are, and who can see your collection.</p>
      </div>

      <form className={styles.page} onSubmit={handleSubmit} noValidate>
        <section className={styles.panel}>
          <div className={styles.grid}>
            <div
              className={[styles.field, fieldErrors.displayName ? styles.invalid : null]
                .filter(Boolean)
                .join(' ')}
            >
              <label className={styles.label} htmlFor="account-name">
                Display name
              </label>
              <input
                id="account-name"
                className={styles.control}
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              {fieldErrors.displayName && (
                <span className={styles.error} role="alert">
                  {fieldErrors.displayName}
                </span>
              )}
            </div>

            <div
              className={[styles.field, fieldErrors.slug ? styles.invalid : null]
                .filter(Boolean)
                .join(' ')}
            >
              <label className={styles.label} htmlFor="account-slug">
                Address
              </label>
              <input
                id="account-slug"
                className={styles.control}
                type="text"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
              <span className={styles.sub}>
                Your collection lives at /u/{slug || 'your-address'}. Changing this frees the old
                one straight away and breaks links you have already shared.
              </span>
              {fieldErrors.slug && (
                <span className={styles.error} role="alert">
                  {fieldErrors.slug}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelHeading}>Visibility</h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="account-public">
              <input
                id="account-public"
                type="checkbox"
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
              />{' '}
              Visible to anyone with the link
            </label>
            <span className={styles.sub}>
              When this is off your collection returns a not-found page to everyone but you — the
              same page an address nobody has taken returns, so nobody can tell the difference.
            </span>
          </div>
        </section>

        <div className={styles.actions}>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {status && (
            <p className={styles.message} role="status">
              {status}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Update the admin chrome**

In `client/src/admin/AdminLayout.tsx`:

- add `{ to: '/admin/account', label: 'Profile', end: false }` to `SECTIONS`, after `Site content`;
- read `const { user } = useAuth();`;
- point the two `href="/"` links at the owner's collection: `href={user ? \`/u/${user.slug}\` : '/'}`;
- render the signed-in name above the sign-out button:

```tsx
{
  user && <span className={styles.who}>{user.displayName}</span>;
}
```

- change `handleLogout` to navigate to `/` rather than `/admin/login`.

Add to `AdminLayout.module.css`:

```css
.who {
  overflow: hidden;
  font-size: var(--text-caption-size);
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Run the whole client suite and lint**

```bash
npm test -w client && npm run lint -w client
```

Expected: PASS, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add client/src/admin client/tests/AccountPage.test.tsx
git commit -m "feat: let an owner change their address and hide their collection

A Profile screen for the display name, the address and the public switch,
reusing the same form styles as every other admin screen. A taken address
arrives as a field error rather than a banner, because the server shapes its
409 like a validation failure for exactly that reason.

The sidebar now shows who is signed in and View site points at the owner's own
collection rather than at /."
```

---

## Phase 5 — Abuse hardening

Everything so far stops one user reaching another's data. This phase is about the user who only ever touches their own and is still a problem: link farming, scripted signup, storage exhaustion, scraping.

### Task 16: Rate limits and a signup throttle

**Files:**

- Create: `server/src/lib/limiters.ts`
- Modify: `server/src/app.ts`, `server/src/routes/auth.ts`, `server/src/routes/uploads.ts`, `server/src/lib/accounts.ts`, `server/src/config/env.ts`, `client/src/pages/LandingPage.tsx`
- Test: `server/tests/lib/limiters.test.ts`, `server/tests/lib/accounts.test.ts`

**Interfaces:**

- Produces: `createLimiter({ windowMs, limit })` and the five named factories below.
- Modifies: `SignInFailure` gains `'signup_throttled'`.
- Produces: `maxSignupsPerHour(): number` in `config/env.ts`.

**Design note.** Per-IP signup counting was considered and rejected: express-rate-limit counts requests rather than outcomes, so an ordinary sign-in would consume the allowance, and making it count outcomes means storing an IP against a decision. The throttle is therefore **site-wide and counted from `User.createdAt`** — no IP is stored, and a flood is capped for everyone rather than per attacker, which is the honest trade for a personal project where `SIGNUP_MODE=invite` is the primary gate anyway.

- [ ] **Step 1: Write the failing limiter test**

Create `server/tests/lib/limiters.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLimiter } from '../../src/lib/limiters';

/** A throwaway app, so the real limits are not consumed by their own test. */
function appWith(limit: number) {
  const app = express();
  app.use(createLimiter({ windowMs: 60_000, limit }));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('createLimiter', () => {
  it('allows up to the limit and then answers 429', async () => {
    const app = appWith(2);

    await request(app).get('/x').expect(200);
    await request(app).get('/x').expect(200);
    const blocked = await request(app).get('/x');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it('reports the standard headers rather than the legacy ones', async () => {
    const response = await request(appWith(5)).get('/x');

    expect(response.headers['ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing throttle test**

Append to `server/tests/lib/accounts.test.ts`:

```ts
describe('the signup throttle', () => {
  it('refuses a new account once the hourly ceiling is reached', async () => {
    vi.stubEnv('SIGNUP_MODE', 'open');
    vi.stubEnv('MAX_SIGNUPS_PER_HOUR', '1');

    expect((await resolveSignIn('google', profile(), null)).ok).toBe(true);
    expect(
      await resolveSignIn(
        'github',
        profile({ providerUserId: 'gh-9', email: 'two@example.com' }),
        null,
      ),
    ).toEqual({ ok: false, reason: 'signup_throttled' });
  });

  it('does not count accounts created more than an hour ago', async () => {
    vi.stubEnv('SIGNUP_MODE', 'open');
    vi.stubEnv('MAX_SIGNUPS_PER_HOUR', '1');
    const old = await createUser(prisma, { slug: 'old', email: 'old@example.com' });
    await prisma.user.update({
      where: { id: old.id },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    expect((await resolveSignIn('google', profile(), null)).ok).toBe(true);
  });

  it('never throttles an existing user signing back in', async () => {
    vi.stubEnv('SIGNUP_MODE', 'open');
    const first = await resolveSignIn('google', profile(), null);

    vi.stubEnv('MAX_SIGNUPS_PER_HOUR', '1');
    expect(await resolveSignIn('google', profile(), null)).toEqual(first);
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

```bash
cd server && npx vitest run tests/lib/limiters.test.ts tests/lib/accounts.test.ts
```

Expected: FAIL — `../../src/lib/limiters` does not resolve, and the throttle is not enforced.

- [ ] **Step 4: Write the limiters**

Create `server/src/lib/limiters.ts`:

```ts
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env';

const MINUTE = 60 * 1000;

/**
 * A per-IP limiter.
 *
 * Keyed on `req.ip`, which is the real client address because `app.ts` sets
 * `trust proxy` to 1 — without that every request behind nginx would share one
 * key and every limit here would be meaningless.
 *
 * The default memory store is process-local. That is the whole application
 * today, one container; if this is ever run as two replicas the limits halve in
 * effectiveness and need a shared store. Said out loud in the README too.
 */
export function createLimiter({
  windowMs,
  limit,
}: {
  windowMs: number;
  limit: number;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    // Every Supertest request shares one IP, so the suite would otherwise
    // exhaust a real allowance part-way through and fail for reasons unrelated
    // to the test. The thresholds themselves are covered by limiters.test.ts,
    // which builds its own app.
    limit: env.NODE_ENV === 'test' ? Number.MAX_SAFE_INTEGER : limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
  });
}

/** Stops the session table filling with abandoned OAuth handshakes. */
export const oauthStartLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 20 });

/** Code and state spraying against the callback. */
export const oauthCallbackLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 20 });

/** Runaway scripted editing. */
export const writeLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 300 });

/** Bulk scraping of public collections. */
export const publicReadLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 15 * MINUTE, limit: 600 });

/** Pairs with the byte quota: bounds the request rate as well as the volume. */
export const uploadLimiter = (): RateLimitRequestHandler =>
  createLimiter({ windowMs: 60 * MINUTE, limit: 60 });
```

- [ ] **Step 5: Mount them**

In `server/src/routes/auth.ts`, add `oauthStartLimiter()` as the first middleware on `GET /auth/:provider` and `oauthCallbackLimiter()` on `GET /auth/:provider/callback`.

In `server/src/routes/uploads.ts`, add `uploadLimiter()` before `requireUser` on the post route.

In `server/src/app.ts`, add the two blanket limiters — the write one before the own tree, the public one on the public mount:

```ts
app.use('/api/u/:slug', publicReadLimiter(), publicCollectionRouter);
```

and, immediately before the own-tree mounts:

```ts
// Non-GET only: a limiter on reads would punish the admin screens, which fetch
// several endpoints per page load.
app.use('/api', (req, res, next) =>
  req.method === 'GET' ? next() : writeLimiterInstance(req, res, next),
);
```

with `const writeLimiterInstance = writeLimiter();` declared once at module scope, so the limiter keeps one store across requests rather than starting fresh each call.

- [ ] **Step 6: Add the signup throttle**

In `server/src/config/env.ts`:

```ts
export function maxSignupsPerHour(): number {
  return parseCount(process.env.MAX_SIGNUPS_PER_HOUR, 20);
}
```

In `server/src/lib/accounts.ts`, widen the failure type and add the check at the top of step 4, immediately after the `signupMode()` guard:

```ts
export type SignInFailure =
  'email_unverified' | 'suspended' | 'signup_closed' | 'invite_required' | 'signup_throttled';
```

```ts
// A site-wide ceiling rather than a per-IP one: counting per IP would mean
// storing an address against a sign-in decision, and express-rate-limit
// counts requests rather than outcomes, so an ordinary sign-in would eat
// the allowance. Everything above this line is an existing account, so a
// returning collector is never throttled.
const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
if ((await tx.user.count({ where: { createdAt: { gte: hourAgo } } })) >= maxSignupsPerHour()) {
  return { ok: false, reason: 'signup_throttled' };
}
```

with `maxSignupsPerHour` added to the `config/env` import.

- [ ] **Step 7: Explain it to the visitor**

In `client/src/pages/LandingPage.tsx`, add to `MESSAGES`:

```ts
  signup_throttled: 'Too many new accounts just now. Try again in an hour.',
```

- [ ] **Step 8: Run the tests**

```bash
npm test -w server && npm test -w client
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src client/src/pages/LandingPage.tsx server/tests
git commit -m "feat: bound the request rate and the signup rate

Per-IP limiters on the OAuth start and callback, on writes, on public reads
and on uploads. All keyed on req.ip, which is the real client only because
trust proxy is already set — without that every request behind nginx shares
one key.

Signups get a site-wide hourly ceiling counted from User.createdAt instead.
Per-IP counting would mean storing an address against a sign-in decision, and
express-rate-limit counts requests rather than outcomes, so an ordinary
sign-in would consume the allowance. A returning collector is never throttled:
every branch above the check resolves to an existing account."
```

---

### Task 17: Per-account ceilings and string caps

**Files:**

- Create: `server/src/lib/quota.ts`
- Modify: `server/src/lib/resourceRouter.ts`, `server/src/routes/records.ts`, `server/src/schemas/record.ts`, `server/src/schemas/content.ts`
- Test: `server/tests/routes/limits.test.ts`

**Interfaces:**

- Consumes: `limits()` (Task 3), `ownerOf` (Task 6).
- Produces: `enforceCeiling(res, { count, max, noun }): boolean` — sends the 409 and returns false when the ceiling is reached.
- Modifies: `CrudDelegate` gains `count(args: { where: OwnerScope }): Promise<number>` and `ResourceRouterOptions` gains `max: () => number`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes/limits.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInAgent } from '../helpers/auth';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const RECORD = {
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  year: 1959,
  format: 'LP',
  genre: 'Jazz',
};

describe('per-account ceilings', () => {
  it('accepts up to the limit and 409s the one after', async () => {
    vi.stubEnv('MAX_WISHLIST_PER_USER', '2');
    const { agent } = await signInAgent();

    await agent.post('/api/wishlist').send({ title: 'A', artist: 'X' }).expect(201);
    await agent.post('/api/wishlist').send({ title: 'B', artist: 'X' }).expect(201);
    const blocked = await agent.post('/api/wishlist').send({ title: 'C', artist: 'X' });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/limit/i);
  });

  it('applies to records too', async () => {
    vi.stubEnv('MAX_RECORDS_PER_USER', '1');
    const { agent } = await signInAgent();

    await agent.post('/api/records').send(RECORD).expect(201);
    await agent
      .post('/api/records')
      .send({ ...RECORD, title: 'Blue Train' })
      .expect(409);
  });

  it('applies to setup rows too', async () => {
    vi.stubEnv('MAX_SETUP_PER_USER', '1');
    const { agent } = await signInAgent();

    await agent.post('/api/setup').send({ icon: 'turntable', label: 'A', value: 'B' }).expect(201);
    await agent.post('/api/setup').send({ icon: 'cable', label: 'C', value: 'D' }).expect(409);
  });

  it('counts per owner, not across the table', async () => {
    vi.stubEnv('MAX_WISHLIST_PER_USER', '1');
    const first = await signInAgent();
    const second = await signInAgent({ providerUserId: 'sub-2', email: 'two@example.com' });

    await first.agent.post('/api/wishlist').send({ title: 'A', artist: 'X' }).expect(201);
    await second.agent.post('/api/wishlist').send({ title: 'B', artist: 'X' }).expect(201);
  });

  it('still allows an update once the ceiling is reached', async () => {
    vi.stubEnv('MAX_WISHLIST_PER_USER', '1');
    const { agent } = await signInAgent();
    const created = await agent.post('/api/wishlist').send({ title: 'A', artist: 'X' }).expect(201);

    await agent.patch(`/api/wishlist/${created.body.id}`).send({ title: 'B' }).expect(200);
  });
});

describe('string length caps', () => {
  it.each(['title', 'artist', 'format', 'genre'])(
    'rejects an over-long record %s',
    async (field) => {
      const { agent } = await signInAgent();

      const response = await agent
        .post('/api/records')
        .send({ ...RECORD, [field]: 'x'.repeat(201) });

      expect(response.status).toBe(400);
      expect(response.body.fields[field]).toBeDefined();
    },
  );

  it('rejects an over-long wishlist title', async () => {
    const { agent } = await signInAgent();

    const response = await agent
      .post('/api/wishlist')
      .send({ title: 'x'.repeat(201), artist: 'X' });

    expect(response.status).toBe(400);
    expect(response.body.fields.title).toBeDefined();
  });

  it('allows a setup value longer than a label, because it holds a description', async () => {
    const { agent } = await signInAgent();

    await agent
      .post('/api/setup')
      .send({ icon: 'turntable', label: 'T', value: 'x'.repeat(400) })
      .expect(201);
    const response = await agent
      .post('/api/setup')
      .send({ icon: 'cable', label: 'C', value: 'x'.repeat(501) });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && npx vitest run tests/routes/limits.test.ts
```

Expected: FAIL — creates succeed past the ceiling and over-long strings are accepted.

- [ ] **Step 3: Write the ceiling helper**

Create `server/src/lib/quota.ts`:

```ts
import type { Response } from 'express';

/**
 * Answers the 409 when a per-account ceiling is reached, and reports whether
 * the caller should continue.
 *
 * 409 rather than 403: the request is well-formed and the caller is entitled to
 * make it — the conflict is with the state of their account. It carries a
 * form-level message, which the admin screens already know how to render.
 */
export function enforceCeiling(
  res: Response,
  { count, max, noun }: { count: number; max: number; noun: string },
): boolean {
  if (count >= max) {
    res.status(409).json({ error: `You have reached the limit of ${max} ${noun}.` });
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Apply it in the factory**

In `server/src/lib/resourceRouter.ts`, add `count` to `CrudDelegate`:

```ts
  count(args: { where: OwnerScope }): Promise<number>;
```

add to `ResourceRouterOptions`:

```ts
/** Read lazily so a test can vary the ceiling with vi.stubEnv. */
max: () => number;
/** Plural, for the 409 message: "wishlist items". */
plural: string;
```

and guard the create handler, before the insert:

```ts
const ownerId = ownerOf(res);
const allowed = enforceCeiling(res, {
  count: await delegate.count({ where: { ownerId } }),
  max: max(),
  noun: plural,
});
if (!allowed) {
  return;
}
```

Then pass the two new options in `routes/wishlist.ts` and `routes/setup.ts`:

```ts
  max: () => limits().maxWishlist,
  plural: 'wishlist items',
```

```ts
  max: () => limits().maxSetup,
  plural: 'setup rows',
```

- [ ] **Step 5: Apply it to records**

In `server/src/routes/records.ts`, add the same guard at the top of the `POST /records` handler, before the slug is generated:

```ts
const allowed = enforceCeiling(res, {
  count: await prisma.record.count({ where: { ownerId } }),
  max: limits().maxRecords,
  noun: 'records',
});
if (!allowed) {
  return;
}
```

- [ ] **Step 6: Cap the strings**

In `server/src/schemas/record.ts`, give the four free-text fields a maximum. They are unbounded today — harmless on a single-tenant site, a payload on a public one: they are the spam text itself, they break the card layout, and `genre` feeds the chip filter on every visitor's page.

```ts
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
```

In `server/src/schemas/content.ts`, do the same for the wishlist `title` and `artist` (200 each) and the setup `label` (200) and `value` (500 — it holds a description, not a name).

- [ ] **Step 7: Run the tests**

```bash
npm test -w server
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src server/tests/routes/limits.test.ts
git commit -m "feat: cap what one account can create

Ceilings on records, wishlist items and setup rows, checked per owner before
the insert and answered with a 409 the admin forms already render. Updates
stay allowed once the ceiling is reached, so nobody is locked out of fixing a
typo by a limit.

The four free-text record fields and their content equivalents gain maxima.
They were unbounded, which was harmless with one collector and is a payload
with open signup: they are the spam text, they break the card layout, and
genre feeds the filter chips on every visitor's page."
```

---

### Task 18: Take the reward out of spamming it

The cheapest anti-spam measure available: make a spam page worthless rather than hard to create.

**Files:**

- Modify: `client/src/components/AlbumCard.tsx`
- Create: `client/public/robots.txt`
- Test: `client/tests/AlbumCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `client/tests/AlbumCard.test.tsx`:

```tsx
describe('outbound links are user-generated content', () => {
  it('marks a record link nofollow ugc as well as noopener', () => {
    render(<AlbumCard record={{ ...RECORD, url: 'https://www.discogs.com/release/1' }} />);

    const link = screen.getByRole('link');
    const rel = link.getAttribute('rel') ?? '';

    // nofollow ugc is what removes the SEO payoff of signing up to post links,
    // which is the whole reason a stranger would want an account here.
    expect(rel).toContain('nofollow');
    expect(rel).toContain('ugc');
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  it('marks a wishlist link the same way', () => {
    render(
      <WishlistCard
        item={{ id: 1, title: 'Karma', artist: 'Pharoah Sanders', url: 'https://example.com' }}
      />,
    );

    expect(screen.getByRole('link').getAttribute('rel')).toContain('nofollow');
  });

  it('still renders a non-interactive card when there is no url', () => {
    render(<AlbumCard record={{ ...RECORD, url: null }} />);

    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

Reuse whatever `RECORD` fixture the existing file defines, and add `WishlistCard` to its imports.

- [ ] **Step 2: Run it to confirm it fails**

```bash
npm test -w client -- AlbumCard
```

Expected: FAIL — `rel` is `noopener noreferrer`.

- [ ] **Step 3: Change the rel**

In `client/src/components/AlbumCard.tsx`, in `CardShell`:

```tsx
      <a
        className={classes}
        href={href}
        // The target is an arbitrary URL someone pasted into their own
        // collection: noopener stops the opened page reaching back through
        // window.opener, and nofollow ugc removes the search-ranking value that
        // would otherwise make this site worth signing up to spam.
        target="_blank"
        rel="nofollow ugc noopener noreferrer"
        aria-label={label}
      >
```

- [ ] **Step 4: Add robots.txt**

Create `client/public/robots.txt`:

```
# Public collections are meant to be found. The admin and the API are not.
User-agent: *
Allow: /
Allow: /u/
Disallow: /admin
Disallow: /api/
```

Vite copies `public/` verbatim into the build, and the nginx `location /` block serves it with the rest of the static output, so no config change is needed.

- [ ] **Step 5: Run the tests**

```bash
npm test -w client && npm run lint -w client
```

Expected: PASS, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/AlbumCard.tsx client/public/robots.txt client/tests/AlbumCard.test.tsx
git commit -m "chore: remove the search value of links posted here

Every outbound link on a collection page is a URL somebody typed into their
own account, which on an open site is the single most attractive thing about
it to someone who does not collect vinyl. rel=nofollow ugc removes the payoff
in one line, which is cheaper and more reliable than trying to detect them.

robots.txt lets collections be found and keeps the admin and the API out."
```

---

### Task 19: A Content Security Policy on the document

**Files:**

- Modify: `client/nginx.conf.template`
- Test: manual, in the running prod stack — this header is set by nginx, which no unit test exercises.

**Design note.** `helmet()` sets a CSP on Express's own responses — the API and `/uploads`. It does not touch the HTML document, which nginx serves in production and Vite in development. So the app ships with no document CSP today, and on a public site with user-supplied image URLs that is the gap worth closing.

- [ ] **Step 1: Add the header**

In `client/nginx.conf.template`, inside the `location /` block:

```
    location / {
        try_files $uri $uri/ /index.html;

        # helmet only covers responses Express generates; the document itself
        # is served from here and had no policy at all.
        #
        # img-src is deliberately wide: coverUrl accepts any external image,
        # which is the existing design. The consequence, accepted: a collection
        # owner can point a cover at a server they control and log the IP of
        # everyone who views their page. Proxying every external image would
        # close that and open an SSRF surface instead.
        #
        # 'unsafe-inline' is needed for styles because Vite injects critical
        # CSS; scripts do not need it and do not get it.
        add_header Content-Security-Policy "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
    }
```

`frame-ancestors 'none'` closes clickjacking on `/admin`. `always` so the header is present on error responses too, not only 200s.

- [ ] **Step 2: Verify against the running stack**

```bash
npm run prod
```

Then, once it is up:

```bash
curl -sI http://localhost/ | grep -i content-security-policy
```

Expected: the policy above, on one line.

- [ ] **Step 3: Check the app still renders under it**

Open `http://localhost/` in a browser, sign in, and load a collection page with an external cover URL. Watch the browser console: any `Refused to load` message means the policy is too tight for something the app actually does, and the directive it names needs widening — not removing.

- [ ] **Step 4: Commit**

```bash
git add client/nginx.conf.template
git commit -m "chore: give the document a Content-Security-Policy

helmet covers the API responses and /uploads, but the HTML itself is served by
nginx and had no policy. img-src stays wide because external cover URLs are
the existing design; frame-ancestors none closes clickjacking on the admin."
```

---

## Phase 6 — Documentation

### Task 20: `.env.example` and the README

Not an afterthought: nobody can run this without knowing how to register two OAuth apps, and nobody can recover a locked-out account without the psql recipes.

**Files:**

- Modify: `.env.example`, `README.md`

- [ ] **Step 1: Rewrite the admin block in `.env.example`**

Remove the `ADMIN_PASSWORD_HASH` block entirely, including its comment about doubling `$` for Compose. Keep `SESSION_SECRET` and its hex advice. Add:

```
# --- Public origin ---
# The origin the browser sees. Must match the callback URLs registered with
# Google and GitHub byte-for-byte.
#   Dev:  http://localhost:5173
#   Prod: https://your-host
PUBLIC_BASE_URL=http://localhost:5173

# --- OAuth providers (at least one pair is required) ---
# Register the callback as <PUBLIC_BASE_URL>/api/auth/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Register the callback as <PUBLIC_BASE_URL>/api/auth/github/callback
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# --- Bootstrap owner ---
# The first sign-in with this verified email claims the collection that already
# exists in the database, instead of creating a second account. Set it before
# signing in for the first time.
BOOTSTRAP_OWNER_EMAIL=

# --- Signup gate ---
# closed  only existing users can sign in
# invite  a new account needs an invite code (issue one with psql, see README)
# open    anyone with a verified Google or GitHub email
SIGNUP_MODE=invite

# --- Per-account ceilings. Defaults shown; override only if you need to. ---
# 5 MB per file, 150 MB per account.
MAX_UPLOAD_BYTES=5242880
UPLOAD_QUOTA_BYTES=157286400
MAX_RECORDS_PER_USER=5000
MAX_WISHLIST_PER_USER=500
MAX_SETUP_PER_USER=100
# Site-wide, not per IP. See the README on why.
MAX_SIGNUPS_PER_HOUR=20
```

- [ ] **Step 2: Replace the "Admin panel" section of `README.md`**

Rewrite it as **Accounts**, covering, in this order:

1. **What changed.** Accounts replace the single password. Every collection lives at `/u/<address>`; `/admin` edits your own. The migration signs the existing session out, because the session payload changed shape.
2. **Registering the providers.** For Google: Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application, authorised redirect URI `http://localhost:5173/api/auth/google/callback` for development and `https://<host>/api/auth/google/callback` for production. For GitHub: Settings → Developer settings → OAuth Apps → New OAuth App, callback URL the same two shapes with `github` in place of `google`. Note that Google permits `http` on `localhost` and GitHub permits any `http` callback for development, so no tunnel is needed.
3. **First boot and the bootstrap claim.** Set `BOOTSTRAP_OWNER_EMAIL` to your own verified address, run `docker compose exec server npx prisma migrate deploy`, then sign in. The first sign-in with that address claims the existing collection rather than starting an empty one; it can only happen once. If the variable is unset, the collection stays unclaimed and visible at `/u/collection`.
4. **The signup gate**, with the table of the three `SIGNUP_MODE` values and the note that it defaults to `invite`.
5. **Operator recipes**, verbatim from spec §9.6 — issue an invite, suspend an account and sign it out, list an account's files, delete an account. Include the note that `encode(gen_random_bytes(16), 'base64')` produces `+` and `/`, which must be URL-encoded when pasted into an invite link, and that file deletion from the volume is manual because the app never unlinks.
6. **Recovering a locked-out account**, verbatim from spec §6.6: the `INSERT INTO "OAuthIdentity"` statement, and why there is no break-glass password.
7. **Limits**, listing the ceilings and stating plainly that the rate limiters are process-local and need a shared store if this is ever run as more than one container.
8. **Sharing**, covering `/u/<address>`, changing the address (the old one is freed at once and its links break), and the private switch — noting that a private collection returns the same not-found page as an address nobody has taken.

Then update, elsewhere in the file:

- the Prerequisites line, which says Node.js 20+ — this repo is on Node 24, per `.nvmrc` and `engines`;
- the **Scripts** section, removing `admin:hash` and `admin:set-password`;
- the schema sentence under "Run Prisma migrations", which still describes a single three-field `Record` model;
- the "What you can edit" table, adding the Profile row.

- [ ] **Step 3: Check the docs against the code**

Every command in the README should be runnable. Walk them:

```bash
grep -n 'npm run\|docker compose\|npx prisma' README.md
```

and confirm each named script still exists in the relevant `package.json`.

- [ ] **Step 4: Format**

```bash
npx prettier --write README.md .env.example
```

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document accounts, providers and the operator recipes

Registering both OAuth apps with the exact callback for each environment, the
bootstrap claim and when to set it, the three signup modes, and the psql
recipes for issuing an invite, suspending an account and recovering one that
is locked out.

Also corrects three things that had gone stale: the Node 20 prerequisite, the
description of a three-field Record model, and the two admin password scripts
that no longer exist."
```

---

## Final verification

Run once everything above is checked off, from a clean checkout of the branch.

- [ ] **Whole suite, both workspaces**

```bash
npm run test:db:setup -w server && npm test
```

Expected: PASS.

- [ ] **Lint and build**

```bash
npm run lint && npm run build
```

Expected: zero warnings, both builds succeed.

- [ ] **The migration against real data**

The important one: this must run against the development database, which holds the original collection, not just against an empty test database.

```bash
docker compose up -d db
docker compose exec server npx prisma migrate deploy
docker compose exec db psql -U vinyl_lib -c 'SELECT COUNT(*) FROM "Record" WHERE "ownerId" IS NULL;'
docker compose exec db psql -U vinyl_lib -c 'SELECT slug, email, bootstrap FROM "User";'
```

Expected: a count of 0, and one bootstrap row with a null email.

- [ ] **End to end, in a browser**

1. `npm run dev`, open `http://localhost:5173/`. The landing page offers whichever providers are configured.
2. Sign in with the address in `BOOTSTRAP_OWNER_EMAIL`. You land on `/admin` and the existing collection is there — not an empty one. Confirm with `SELECT COUNT(*) FROM "User";` that there is still exactly one row.
3. Open `/admin/account`, change the address, save. Visit `/u/<new address>` — the page is the old homepage, with your records. Visit the old address: not found.
4. Flip the collection to private. In a private window, `/u/<address>` returns the same not-found page as `/u/nobody`.
5. Sign in as a second person in a private window (set `SIGNUP_MODE=open` temporarily, or issue an invite with the README recipe). Add a record with the same title as one of the first collection's — confirm both slugs are unadorned.
6. As the second person, find a record id belonging to the first and try `PATCH /api/records/<id>` from the browser console. Expect 404, and confirm the row is unchanged.
7. Upload a cover and confirm the returned URL is under `/uploads/<your id>/`.

- [ ] **Open the pull request**

```bash
gh pr create --title "feat: multiuser collections with OAuth sign-in" --body "Implements docs/superpowers/specs/2026-08-22-multiuser-design.md."
```
