# Multiuser Collections — Design

**Date:** 2026-08-22
**Status:** Draft — awaiting approval
**Repo:** `Anddep/vinyl-lib`

## 1. Context

The site is built for exactly one collector. `ADMIN_PASSWORD_HASH` holds a bcrypt hash;
`server/src/routes/auth.ts` compares against it and sets `req.session.isAdmin = true`;
`requireAuth` gates every write. `Record`, `WishlistItem`, `SetupItem` and `SiteSetting` have no
owner column, so the database holds one collection and the homepage at `/` renders it.

This design makes the collection a per-user thing. Two collectors sign in independently, each
edits only their own records, wishlist, setup rows, site copy and covers, and each shares a public
page at a URL they choose.

It also assumes the deployment is **reachable from the open internet**. That is not a deployment
detail: it means the site publishes pages whose text, outbound links and images are written by
strangers, and that the account-creation endpoint is a public one. The isolation model (§5) and
the abuse model (§9) are two halves of the same requirement — the first stops one user reaching
another's data, the second stops the site being useful to someone who does not care about vinyl.

### Goals

- Sign in with Google or GitHub. No passwords anywhere in the system.
- Every content row belongs to exactly one user; no read, write or delete crosses that line.
- A public collection page at `/u/:slug`, looking and behaving as the homepage does today.
- An owner-chosen, editable, site-unique slug, and a private switch that hides the collection.
- The existing collection survives, backfilled to one bootstrap user that the real owner claims
  on first sign-in.
- Survive being publicly reachable: bounded signup, bounded resource use per account, no SEO value
  in spamming it, and a way to stop an abusive account without a redeploy (§9).

### Non-goals

- Passwords, signup forms, password reset, or a break-glass password (§6.6).
- Roles or a super-admin surface. `User` has no role column, and there are no moderation screens —
  operator actions run through `psql` (§9.6).
- A shared album catalogue or any deduplication between users (§3.5).
- Collaborators, teams, or a collection with two editors.
- Account deletion, data export, following, feeds, or a public directory of collections.
- A CAPTCHA or bot-scoring service. Deferred with a named option (§9.7).
- Automated content moderation, spam classification, or abuse reporting flows.
- Any visual redesign. This is a data-ownership change.

## 2. Approach

One `User` table, one `OAuthIdentity` table, and an `ownerId` foreign key on all four content
models. Every query — read and write, public and admin — is scoped by owner, and the scope is
supplied by middleware rather than by each handler.

Two owner sources, and therefore two API trees over the same handlers:

- **Public.** `/api/u/:slug/*`. The owner comes from the slug. No session needed.
- **Own.** `/api/*`. The owner comes from `req.session.userId`. Reads and writes both.

Splitting the trees by URL rather than branching inside one handler means an unscoped query has
nowhere to hide: there is no route on which `ownerId` is optional.

Sessions stay exactly as they are — `express-session` over `connect-pg-simple` in the existing
Postgres. The cookie carries `userId` instead of `isAdmin`. Nothing moves to a JWT: logout must
genuinely revoke, and it already does.

Rejected alternatives:

- **Postgres row-level security.** The strongest guarantee — isolation enforced by the database,
  immune to a forgotten `where`. Rejected because Prisma has no first-class RLS support: it needs
  a per-request `SET LOCAL app.user_id` on a dedicated connection, which means routing every query
  through an interactive transaction and giving up the shared client in
  `server/src/prisma/client.ts`. A large change to the data layer to defend against a mistake that
  §5.3 makes a type error instead.
- **A `Collection` table between `User` and content.** Ready-made for a second collection per
  person, and for handing one over. Rejected as YAGNI: it adds a join to every query and an id to
  every route for a feature nobody asked for. `ownerId` becomes `collectionId` later with a
  mechanical migration.
- **Subdomains (`andriy.example.com`).** Nicer URLs, but it needs wildcard DNS, wildcard TLS and
  an nginx rewrite, and it breaks `localhost` development. `/u/:slug` costs one route.
- **A separate identity provider (Auth0, Clerk, Supabase Auth).** Removes the OAuth code in §6.
  Rejected: it adds a paid third party and an outward dependency to a self-hosted app whose whole
  auth surface is two providers and one callback, and the session store already exists.

## 3. Data model

### 3.1 User

```prisma
model User {
  id          Int      @id @default(autoincrement())
  slug        String   @unique
  displayName String
  /// Verified address from the OAuth provider. The linking key (§6.4).
  /// Null only on the unclaimed bootstrap row (§7).
  email       String?  @unique
  avatarUrl   String?
  /// Public by default. Private collections 404 for everyone but the owner (§5.2).
  isPublic    Boolean  @default(true)
  /// Set by the operator through psql. Blocks sign-in and hides the collection (§9.6).
  suspendedAt DateTime?
  /// True on the single row the backfill migration creates, and only there.
  bootstrap   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  identities   OAuthIdentity[]
  records      Record[]
  wishlist     WishlistItem[]
  setup        SetupItem[]
  settings     SiteSetting[]
  uploads      Upload[]
  invitesIssued Invite[] @relation("InviteIssuer")
  invite        Invite?  @relation("InviteRedeemer")
}
```

`email` is nullable because the bootstrap row exists before anyone has signed in. Everywhere else
it is set and unique, which is what makes the claim in §7 self-guarding: it can only fire against
a row whose email is still null.

There is no role column. Operator tasks — suspending an account, deleting one, issuing an invite —
run through `psql`, documented in the README. `suspendedAt` is a timestamp rather than a boolean
because knowing _when_ an account was stopped is the first thing you want when working out what it
did.

### 3.2 OAuthIdentity

```prisma
model OAuthIdentity {
  id             Int      @id @default(autoincrement())
  provider       String   // "google" | "github"
  providerUserId String   // the provider's immutable subject id, never the email
  userId         Int
  createdAt      DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
}
```

`providerUserId` is the provider's stable subject (`sub` for Google, `id` for GitHub) — never the
email, which the user can change at the provider. A user may hold one identity per provider; the
composite unique stops the same provider account attaching to two users.

### 3.3 Ownership on content

Each of `Record`, `WishlistItem`, `SetupItem` gains:

```prisma
  ownerId Int
  owner   User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
```

`onDelete: Cascade` so deleting a user takes their content with it, whenever account deletion
arrives. `Record` additionally changes:

```prisma
model Record {
  ...
  slug     String                       // no longer globally @unique
  ownerId  Int

  @@unique([ownerId, slug])
  @@index([ownerId, addedAt])
  @@index([ownerId, position])
}
```

The global unique on `slug` becomes per-owner — without this, the second user to add _Kind of
Blue_ gets `kind-of-blue-2` for no reason they can see. The two standalone indexes
`@@index([addedAt])` and `@@index([position])` are replaced by composite ones with `ownerId`
leading, because after this change no query touches those columns without also filtering on owner.

`uniqueSlug()` in `server/src/lib/slug.ts` needs **no change**. Its second argument is already an
`exists` callback, and the owner scope belongs in the closure at the call site in
`server/src/routes/records.ts`:

```ts
async (candidate) => (await prisma.record.count({ where: { ownerId, slug: candidate } })) > 0;
```

The seam is right; only the caller is wrong today.

### 3.4 SiteSetting

`key` stops being the primary key:

```prisma
model SiteSetting {
  ownerId Int
  key     String
  value   String

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@id([ownerId, key])
}
```

Every `findUnique({ where: { key } })` becomes
`findUnique({ where: { ownerId_key: { ownerId, key } } })`, and the upsert loop in
`server/src/routes/settings.ts` follows. The one call site outside that router is
`collectingSince` in `server/src/routes/stats.ts`.

### 3.5 No shared catalogue

Two users owning the same pressing are two independent `Record` rows with their own cover,
position, URL and `addedAt`. There is deliberately no `Album` table and no deduplication.

Sharing rows would mean deciding whose cover art wins, whose edit is authoritative, and what
happens to the other owner when one deletes — a moderation problem, in exchange for saving a few
kilobytes. It also makes every write a merge. A collection is a personal record of personal
objects; two copies of _Blue Train_ are genuinely two things.

### 3.6 Invite and Upload

Both exist for §9 and are described in full there; the shapes belong here.

```prisma
model Invite {
  id         Int       @id @default(autoincrement())
  /// 16 random bytes, base64url. The whole credential — never guessable, never derived.
  code       String    @unique
  issuedById Int?
  redeemedById Int?    @unique
  expiresAt  DateTime?
  createdAt  DateTime  @default(now())
  redeemedAt DateTime?

  issuedBy   User? @relation("InviteIssuer", fields: [issuedById], references: [id], onDelete: SetNull)
  redeemedBy User? @relation("InviteRedeemer", fields: [redeemedById], references: [id], onDelete: SetNull)
}

model Upload {
  id        Int      @id @default(autoincrement())
  ownerId   Int
  /// Path relative to UPLOAD_DIR, e.g. "12/9f3c….webp". Unique across the store.
  path      String   @unique
  bytes     Int
  createdAt DateTime @default(now())

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId])
}
```

`redeemedById` is unique, so one invite makes at most one account, enforced by the database rather
than by the callback remembering to check. `expiresAt` is nullable — an invite you hand to a
friend in person does not need a clock on it.

`Upload` records bytes at write time rather than measuring the directory on each request: a
`SUM(bytes) WHERE ownerId` is one indexed query, where a `readdir` plus `stat` per file is O(n) on
the hot path of every upload. It also makes per-user cleanup possible at all — deleting a
suspended account's files needs a list of what they are.

## 4. API surface

### 4.1 Public reads — owner from the slug

```
GET /api/u/:slug                       -> { slug, displayName, avatarUrl }
GET /api/u/:slug/records[?sort&limit]  -> Record[]
GET /api/u/:slug/records/:id           -> Record
GET /api/u/:slug/genres                -> Genre[]
GET /api/u/:slug/stats                 -> Stats
GET /api/u/:slug/wishlist              -> WishlistItem[]
GET /api/u/:slug/setup                 -> SetupItem[]
GET /api/u/:slug/settings              -> SiteSettings
```

Mounted as one sub-router behind `resolveOwnerFromSlug` (§5.2), which puts `ownerId` on
`res.locals` or answers 404. Handlers below it cannot run without an owner.

### 4.2 Own reads and writes — owner from the session

Unchanged paths, new meaning: `/api/records` is now _my_ records, and requires a session.

```
GET    /api/records         GET /api/records/:id      GET /api/genres    GET /api/stats
POST   /api/records         PATCH /api/records/:id    DELETE /api/records/:id
GET    /api/wishlist        POST /api/wishlist        PATCH|DELETE /api/wishlist/:id
GET    /api/setup           POST /api/setup           PATCH|DELETE /api/setup/:id
GET    /api/settings        PATCH /api/settings
POST   /api/uploads
```

Every one of these carries `requireUser` (§5.1). A signed-out request gets 401, where today it
would get the single global collection.

The duplication between §4.1 and §4.2 is one handler per resource, invoked under two different
owner-resolving middlewares — not two copies of the logic (§5.3).

### 4.3 Account and auth

```
GET   /api/auth/providers          -> ["google","github"]   configured providers only
GET   /api/auth/:provider[?next=&invite=]  -> 302 to the provider (state + PKCE)
GET   /api/auth/:provider/callback -> 302 to /admin or /?error=<code>
POST  /api/auth/logout             -> 204
GET   /api/auth/me                 -> { user: { id, slug, displayName, avatarUrl, isPublic } | null }

PATCH /api/account                 -> { slug?, displayName?, isPublic? }
```

`/api/account` is separate from `/api/settings`: the latter is homepage copy, the former is who
you are and whether anyone can see you. Different validation, different failure modes, and a slug
collision is a 409 rather than a field error on a content form.

`GET /api/auth/me` returns `{ user: null }` rather than 401 when signed out — it is the question
"who am I", and "nobody" is a valid answer.

### 4.4 Slug rules

Pattern `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$` — 3 to 32 characters, lowercase alphanumerics and
inner hyphens. Reserved, and rejected with a field error: `admin`, `api`, `auth`, `u`, `uploads`,
`assets`, `static`, `health`, `login`, `logout`, `signin`, `signout`, `me`, `new`, `settings`,
`account`, `about`, `favicon.svg`, `index`. These either collide with a route today or are the
obvious next one.

The default at account creation is `slugify(displayName)` run through `uniqueSlug()` against
`User.slug`, both of which already exist and need no change.

**Changing a slug frees the old one immediately, and the old slug 404s.** No redirect table. A
history table would have to answer what happens when a second user then claims the freed slug —
either the redirect wins and the new owner cannot use their own URL, or the new owner wins and the
redirect silently starts pointing at a stranger's collection. Both are worse than a 404. The
account screen says so above the field: _"Changing this breaks links you have already shared."_

## 5. Security model

### 5.1 `requireUser` — is anyone signed in

```ts
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

This replaces `requireAuth`, which is deleted along with `session.isAdmin`. It answers the first
of the two questions the prompt identifies — _is anyone signed in_ — and, critically, it is also
where the owner scope enters the request. A handler that wants to write has no way to obtain an
`ownerId` other than from this middleware.

It stays synchronous and does **not** load the user. Checking `suspendedAt` here would put a query
on every authenticated request to catch a state that changes perhaps twice a year; instead
suspension is enforced where the row is already in hand — at sign-in (§6.4) and in
`resolveOwnerFromSlug` below — and the operator's suspend recipe deletes that user's session rows,
which revokes them immediately (§9.6). This is the same reasoning that put sessions in Postgres in
the first place: revocation is a delete, not a wait.

### 5.2 `resolveOwnerFromSlug` — whose collection is this

```ts
const owner = await prisma.user.findUnique({ where: { slug: req.params.slug } });
const hidden = owner === null || owner.suspendedAt !== null || !owner.isPublic;
if (hidden && owner?.id !== req.session.userId) {
  res.status(404).json({ error: 'Not found' });
  return;
}
res.locals.ownerId = owner.id;
```

A private collection, a suspended one, and a slug that was never taken return the **same 404 with
the same body**.
A 403 would confirm that the slug exists and someone is hiding behind it, which is exactly what
"private" is supposed to prevent. The client mirrors this: `/u/:slug` renders one not-found screen
for all three.

The owner viewing their own private collection at `/u/:slug` gets 200, so "view site" works
without flipping the switch back.

### 5.3 Ownership inside the CRUD factory

`server/src/lib/resourceRouter.ts` is the IDOR today: `findUnique`, `update` and `delete` all key
on `id` alone, so `PATCH /api/wishlist/7` reaches row 7 whoever owns it. Adding a separate
ownership lookup would work and would be forgotten by the next route to use the factory.

Instead the ownership check goes into the **delegate's type**, so an unscoped call does not
compile:

```ts
type OwnerScope = { ownerId: number };

interface CrudDelegate {
  findMany(args: {
    where: OwnerScope;
    orderBy: Array<Record<string, 'asc' | 'desc'>>;
  }): Promise<unknown[]>;
  findFirst(args: { where: OwnerScope & { id: number } }): Promise<unknown | null>;
  create(args: { data: ValidatedBody & OwnerScope }): Promise<unknown>;
  update(args: { where: OwnerScope & { id: number }; data: ValidatedBody }): Promise<unknown>;
  delete(args: { where: OwnerScope & { id: number } }): Promise<unknown>;
}
```

Notes on the shape:

- `findUnique` becomes `findFirst`. `{ id, ownerId }` is not a unique input, and `findFirst`
  states that plainly.
- `update` and `delete` keep a `where` of `{ id, ownerId }`. Prisma 5 accepts non-unique filters
  alongside a unique field in those calls, and raises `P2025` when nothing matches — but
  `resolveId()` already pre-checks with `findFirst`, so the 404 comes from the explicit path and
  `P2025` stays a genuine race.
- `ownerId` reaches `create` from `res.locals.ownerId`, never from the request body. The zod
  schemas are already non-strict object schemas that strip unknown keys, so a posted `ownerId` is
  discarded before it reaches Prisma; a test asserts that.

`resolveId()` becomes:

```ts
if (!(await delegate.findFirst({ where: { id, ownerId } }))) {
  res.status(404).json({ error: `${noun} not found` });
  return null;
}
```

**A row that does not exist and a row owned by someone else are the same 404, with the same
message.** Distinguishing them would let an attacker enumerate which ids are in use.

`records.ts` keeps its own router (slug generation, the `isNew` flag) and gets the identical
treatment by hand, with the same tests run against it.

### 5.4 The other global queries

Every aggregate in the codebase is currently over the whole table. Each gains
`where: { ownerId }`:

| Location                      | Query                                  | Fix                                        |
| ----------------------------- | -------------------------------------- | ------------------------------------------ |
| `routes/stats.ts` `topGenre`  | `groupBy(['genre'])`                   | `where: { ownerId }`                       |
| `routes/stats.ts` `topArtist` | `groupBy(['artist'])`                  | `where: { ownerId }`                       |
| `routes/stats.ts`             | `record.count()`                       | `where: { ownerId }`                       |
| `routes/stats.ts`             | `count({ addedAt: { gte } })`          | add `ownerId`                              |
| `routes/stats.ts`             | `siteSetting.findUnique({ key })`      | `where: { ownerId_key: { ownerId, key } }` |
| `routes/records.ts` `/genres` | `groupBy(['genre'])`                   | `where: { ownerId }`                       |
| `routes/records.ts` `isNew`   | `findFirst({ orderBy: addedAt desc })` | `where: { ownerId }`                       |
| `routes/settings.ts`          | `findMany()` / `upsert({ key })`       | `ownerId` in both                          |

The `isNew` badge is the subtle one: derived from the newest record _in the entire table_ today,
so with two users only one collection would ever show a badge. Scoped, exactly one record per
collection carries it, as designed.

### 5.5 Uploads

New files land at `/uploads/<ownerId>/<uuid>.<ext>`; `POST /api/uploads` takes the owner from
`requireUser`. Existing files stay flat at `/uploads/<uuid>.<ext>` and their `coverUrl` values are
**not** rewritten — `express.static` serves both, so there is no data migration and no window in
which a cover 404s.

Two limits, both env-backed so they can be moved together:

- **5 MB per file** (`MAX_UPLOAD_BYTES`), enforced by multer's own `limits.fileSize` — the
  oversized body is rejected before it is buffered, not after. This is the existing cap, promoted
  from a constant to a variable so it sits beside the quota rather than three files away.
- **150 MB per user** (`UPLOAD_QUOTA_BYTES`). Each write inserts an `Upload` row; a write whose
  bytes would push the owner's `SUM(bytes)` past the quota is refused with **413** and writes
  nothing.

At 5 MB a file the quota is at least thirty covers and, at realistic cover sizes, several hundred —
comfortable for a collection, and bounded enough that one account cannot take the volume down.
Details in §9.4.

The magic-byte allowlist in `server/src/lib/imageType.ts` is unchanged and matters more now than
it did: `image/svg+xml` is deliberately **not** in it. SVG is a scriptable document, and an
uploaded one served same-origin from `/uploads` is stored XSS against every visitor to that
collection.

Accepted limitation: a private collection's covers remain fetchable at their direct
`/uploads/...` URL. The path is a UUID and is never listed (`index: false` is already set), so it
is unguessable, but it is not access-controlled. Gating static files would mean routing every
image through Express and the ownership check — real cost, for content the owner published to a
public page in every other case.

### 5.6 CSRF, and what changes when the cookie relaxes

`sameSite: 'strict'` is the CSRF mitigation today. **It cannot survive OAuth.** The provider
redirects the browser to `/api/auth/:provider/callback` as a cross-site top-level navigation, and
a `Strict` cookie is withheld from exactly that — so the session holding the `state` and PKCE
verifier would not arrive, and every sign-in would fail state validation.

The cookie becomes `sameSite: 'lax'`. What that gives up, precisely:

- `Lax` still withholds the cookie from **cross-site non-GET** requests. Every state-changing route
  in this app is POST, PATCH or DELETE issued by `fetch`, so the classic cross-site form post is
  still cookie-less. This is the bulk of what `Strict` was doing.
- What `Lax` newly permits is the cookie riding a **cross-site top-level GET** — a link or
  `<img src>` pointing at our origin. Every GET here is side-effect-free, with one exception: the
  OAuth callback, which is a GET that creates a session.

Two things replace the lost margin:

1. **An origin check on every non-GET `/api` request.** A middleware that rejects with 403 when
   `Origin` is present and is not the app's own origin (`env.PUBLIC_BASE_URL`). Header-based, no
   token store, no per-form plumbing — it closes the residual gap without a session-bound CSRF
   token, which would be ceremony for a same-origin SPA.
2. **The `state` parameter** protects the callback (§6.3): single-use, 32 random bytes, held in
   the session, compared and deleted on arrival. That is the standard defence for precisely this
   GET, and it is stronger than SameSite would have been.

`httpOnly`, `secure` in production, and the rolling 7-day `maxAge` are unchanged.

### 5.7 Session fixation

`req.session.regenerate()` runs on successful sign-in, before `userId` is set. The password login
does not do this today; with an OAuth callback that can be initiated cross-site, a pre-seeded
session id must not survive into an authenticated one. `logout` keeps `destroy()`.

## 6. Authentication

### 6.1 No new dependency

The authorization-code flow is implemented directly against the two providers, using Node 24's
global `fetch`. **No OAuth package is added.**

| Option                                                      | Verdict                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passport` + `passport-google-oauth20` + `passport-github2` | Rejected. Three packages plus `passport-oauth2`; both strategy packages have been unmaintained for years, which is a worse supply-chain position than the code they save. Passport also imposes `serializeUser`/`deserializeUser` over a session this app already manages explicitly. |
| `openid-client`                                             | Rejected. v6 is ESM-only and the server is CommonJS; v5 is CJS but is an OIDC client, and GitHub is not an OIDC provider — it would cover Google only, leaving GitHub hand-rolled anyway.                                                                                             |
| `arctic`                                                    | Rejected. Well-scoped and modern, but ESM-only.                                                                                                                                                                                                                                       |
| Direct implementation                                       | **Chosen.** ~150 lines: build an authorize URL, exchange a code, read a profile. Pure JS, no `node-gyp` (the constraint that put `bcryptjs` in this repo instead of `bcrypt`), CommonJS, and fully testable by stubbing one `fetch` seam.                                             |

`express-rate-limit` is **kept**, not removed with the password login. It moves to
`GET /api/auth/:provider` — 20 starts per 15 minutes per IP — so nobody can spray the redirect
endpoint and fill the `session` table with abandoned OAuth state.

`bcryptjs` and `@types/bcryptjs` are removed.

### 6.2 Provider descriptors

`server/src/lib/oauth/providers.ts` exports one descriptor per provider — authorize URL, token
URL, scopes, whether PKCE applies, and a `fetchProfile(accessToken)` returning a normalised
`{ providerUserId, email, emailVerified, displayName, avatarUrl }`.

|                | Google                                     | GitHub                                                             |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Authorize      | `accounts.google.com/o/oauth2/v2/auth`     | `github.com/login/oauth/authorize`                                 |
| Token          | `oauth2.googleapis.com/token`              | `github.com/login/oauth/access_token` (`Accept: application/json`) |
| Profile        | `openidconnect.googleapis.com/v1/userinfo` | `api.github.com/user` + `api.github.com/user/emails`               |
| Scopes         | `openid email profile`                     | `read:user user:email`                                             |
| PKCE           | yes (S256)                                 | no — GitHub OAuth Apps do not support it                           |
| Verified email | `email_verified`                           | the entry in `/user/emails` with `primary && verified`             |

GitHub is the reason `fetchProfile` is a per-provider function rather than one shared shape: the
verified address is only available from a second call, and `/user` alone can return a null or
unverified email.

A provider with no client id/secret in the environment is **disabled**: its routes 404 and it is
absent from `GET /api/auth/providers`, so the sign-in screen renders only what actually works.
The server refuses to start if neither provider is configured — otherwise it boots into a state
where nobody can ever sign in.

### 6.3 The flow

**`GET /api/auth/:provider`**

1. 404 unless the provider is configured.
2. Generate `state` (32 random bytes, base64url) and, for Google, a PKCE `code_verifier` plus its
   S256 `code_challenge`.
3. Store `req.session.oauth = { provider, state, verifier, returnTo, invite }`. `returnTo` comes
   from a validated `?next=` — app-relative paths only, so it cannot become an open redirect.
   `invite` is the raw `?invite=` code, carried through the round trip and validated only at
   redemption (§9.2), so an invalid code fails at the point it is used rather than leaking whether
   it exists before the user has authenticated.
4. 302 to the provider's authorize URL, with
   `redirect_uri = ${PUBLIC_BASE_URL}/api/auth/${provider}/callback`.

**`GET /api/auth/:provider/callback`**

1. Reject when `req.session.oauth` is absent, its `provider` differs, or `state` does not match.
   **Delete `req.session.oauth` before doing anything else**, so a replayed callback fails —
   single-use, not merely single-valued.
2. Exchange `code` at the token endpoint (with `code_verifier` for Google).
3. Fetch the profile. **Refuse the sign-in if the provider does not assert a verified email**
   (§6.4) — 302 to `/?error=email_unverified`.
4. Resolve the account (§6.4 / §7).
5. `req.session.regenerate()`, set `req.session.userId`, 302 to `returnTo ?? '/admin'`.

Failures redirect to `/?error=<code>` rather than rendering JSON: the user is in a browser
navigation, and a raw error object is a dead end. The landing page renders a message for each
code.

### 6.4 Account resolution — linking by verified email

In one `prisma.$transaction`, in order:

1. `OAuthIdentity` matching `(provider, providerUserId)` → sign in as its user. Every repeat
   sign-in stops here.
2. `User` whose `email` equals the verified email (compared lowercase) → **create the identity
   against that user** and sign in. This is the Google-then-GitHub case: one person, one
   collection.
3. The bootstrap claim (§7).
4. Otherwise this is a **new account**, and it happens only if `SIGNUP_MODE` allows it (§9.2).
   When it does: create a `User` — slug from `slugify(displayName)` via `uniqueSlug()`, `isPublic`
   true — plus its identity, and mark the invite redeemed if one was used.

Steps 1, 2 and 3 resolve to an existing row; if that row has `suspendedAt` set, the sign-in is
refused with `/?error=suspended` and no session is created. A suspended account cannot sign back
in, and cannot escape by adding a second provider — step 2 finds the same row.

The trade-off, stated plainly: linking by email means an account is only as safe as the provider's
verification claim. If a provider could be induced to assert someone else's address as verified,
that would be an account takeover. This is why step 3 of §6.3 refuses the sign-in outright rather
than falling through to step 4 with an unverified address — an unverified email never reaches the
linking logic, and never gets written to `User.email`.

The alternative — separate accounts with manual linking from the account screen — was considered
and rejected: signing in "the wrong way" would land the owner in an empty collection, which reads
as data loss, and the manual link is itself a flow that has to be built and secured.

### 6.5 Callback URLs

`PUBLIC_BASE_URL` is required, because `redirect_uri` must match what is registered at the
provider byte-for-byte and cannot be inferred reliably behind two different proxies.

| Environment                        | `PUBLIC_BASE_URL`       | Register at the provider                                                |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| Development (Vite proxies `/api`)  | `http://localhost:5173` | `http://localhost:5173/api/auth/google/callback`, `.../github/callback` |
| Production (nginx proxies `/api/`) | `https://<your-host>`   | `https://<your-host>/api/auth/google/callback`, `.../github/callback`   |

Both are documented in `.env.example` and `README.md`, together with the click-path for creating
the Google OAuth client and the GitHub OAuth App. Google permits `http` on `localhost`; GitHub
permits any `http` callback for development.

### 6.6 No break-glass password

The password path is removed entirely: `routes/auth.ts`'s login handler, `createLoginLimiter`,
`ADMIN_PASSWORD_HASH`, `scripts/setPassword.ts`, `scripts/hashPassword.ts`, the `admin:hash` and
`admin:set-password` npm scripts, `bcryptjs`, and their tests.

Keeping one would re-introduce precisely the surface this removes — a long-lived shared secret in
`.env`, a brute-force target, and a second code path through authentication that every future
authorization change has to be checked against — to solve a problem the operator already has a
better tool for. Anyone who can be locked out here is someone with shell access to the host, and
the recovery is two SQL statements:

```sql
-- Attach a provider identity you control to an existing user.
INSERT INTO "OAuthIdentity" (provider, "providerUserId", "userId")
VALUES ('github', '<your github numeric id>', <user id>);
```

That recipe goes in the README next to the bootstrap instructions.

## 7. Migration and the bootstrap claim

The dev database holds real content. One hand-written migration, created with
`prisma migrate dev --create-only --name multiuser_owner` and then **edited**, because
`prisma migrate diff` will emit `ADD COLUMN ... NOT NULL` with no backfill and fail on the first
existing row. It must run cleanly under `prisma migrate deploy` against both the populated dev
database and an empty CI one.

Order inside the single migration:

1. `CREATE TABLE "User"`, `"OAuthIdentity"`, `"Invite"` and `"Upload"`, with their unique indexes.
   The three new tables start empty; existing flat upload files get no `Upload` row, so they do not
   count against the first user's quota — a small, deliberate amnesty rather than a backfill that
   would have to `stat` a volume from inside a migration.
2. Insert exactly one placeholder:
   ```sql
   INSERT INTO "User" (slug, "displayName", bootstrap, "isPublic", "updatedAt")
   VALUES ('collection', 'The Collection', true, true, NOW());
   ```
   Unconditional, so the foreign keys in step 5 are satisfiable on an empty database too.
3. `ALTER TABLE ... ADD COLUMN "ownerId" INTEGER;` — nullable — on all four content tables.
4. `UPDATE "<table>" SET "ownerId" = (SELECT id FROM "User" WHERE bootstrap);` on all four.
5. `SET NOT NULL`, then add the foreign keys with `ON DELETE CASCADE`.
6. `DROP INDEX "Record_slug_key";` and
   `CREATE UNIQUE INDEX "Record_ownerId_slug_key" ON "Record"("ownerId", slug);`
7. Drop `Record_addedAt_idx` and `Record_position_idx`; create the composite pair from §3.3.
8. `ALTER TABLE "SiteSetting" DROP CONSTRAINT "SiteSetting_pkey";` then
   `ADD PRIMARY KEY ("ownerId", key);`

The `session` table is untouched — but existing sessions carry `isAdmin`, not `userId`, so
everyone is signed out by the change in shape. That is correct and worth stating in the README.

**The claim.** `BOOTSTRAP_OWNER_EMAIL` is an optional env var. Step 3 of §6.4:

```ts
const claimed = await tx.user.updateMany({
  where: { bootstrap: true, email: null },
  data: { email, displayName, avatarUrl },
});
if (claimed.count === 1) {
  /* attach the identity to that row */
}
```

fires only when the verified email matches `BOOTSTRAP_OWNER_EMAIL` case-insensitively.

Three things make it safe to run on every sign-in:

- `email: null` in the `where` means it can match at most once. The second attempt updates zero
  rows and falls through to §6.4 step 4.
- After the first success, §6.4 step 1 (identity) or step 2 (email) short-circuits before the claim
  is ever reached — including when the same person later signs in with the other provider.
- The whole resolution runs in one transaction, and `User.email` is unique, so two concurrent
  callbacks cannot both claim: the loser hits the constraint and retries into step 2.

With `BOOTSTRAP_OWNER_EMAIL` unset, the placeholder simply stays unclaimed and its collection stays
visible at `/u/collection` — reachable, not lost. The README says to set it before first sign-in.

## 8. UI surface

### 8.1 Routes

```
/                    landing (signed out) · redirect to /u/<my slug> (signed in)
/u/:slug             public collection — today's homepage, someone's data
/admin               dashboard          } unchanged in shape, now scoped to the session user
/admin/records…      records
/admin/wishlist      wishlist
/admin/setup         setup
/admin/settings      site content
/admin/account       NEW — display name, slug, public/private
```

`/admin/login` is removed; `/` is the sign-in screen and `RequireAuth` redirects there.

### 8.2 The landing page

Signed out: the brand mark, one line of copy, and one button per configured provider — real
`<a href="/api/auth/google">` anchors, because the flow is a browser navigation and `fetch` cannot
follow a cross-origin redirect that sets a cookie. It reuses `LoginPage.module.css`'s card
treatment and `Button`, so it is a re-arrangement of existing styles rather than new design. The
`?error=` codes from §6.3 render in the card's existing error slot.

An `?invite=<code>` on the landing URL is forwarded onto each provider anchor and nothing else —
no field, no validation, no "invalid code" message before sign-in. The invite link _is_ the
invitation, and telling an anonymous visitor whether a code exists is a free oracle. Under
`SIGNUP_MODE=invite` the card also says so plainly, so someone arriving without a link understands
why signing in returned them to this page.

Signed in: `<Navigate to={`/u/${user.slug}`} replace />`.

### 8.3 One collection page, two data sources

`client/src/api/client.ts` gains a scope-aware factory:

```ts
export type Scope = { kind: 'own' } | { kind: 'public'; slug: string };

/** All seven collection reads, bound to one owner. */
export function collectionApi(scope: Scope) {
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
```

`HomePage.tsx` becomes `CollectionPage.tsx`, taking the slug from `useParams()` and memoising
`collectionApi()` on it. Every `sections/*` component is already prop-driven and **does not
change** — which is what makes "the public collection page looks exactly like today's homepage" a
statement about the code rather than a hope.

Mutation fetchers (`createRecord`, `updateWishlistItem`, …) keep their current paths. They are
always the signed-in user's own, and giving them a scope would imply a scope that does not exist.

`useResource` is unchanged: it already holds the fetcher in a ref, so a memoised api object does
not send it into a refetch loop.

### 8.4 Auth context

`client/src/auth/AuthProvider.tsx` fetches `GET /api/auth/me` once and exposes
`{ user, loading, refresh }`. `RequireAuth` reads the context instead of calling `getAuthStatus`
itself, so the landing page, the admin guard and the account screen share one answer rather than
three requests. Its behaviour is otherwise as today: render nothing while pending, redirect on a
negative or failed answer.

`LoginPage.tsx` and `RequireAuth`'s boolean `authenticated` both go; `AdminLayout` gains the
signed-in user's name and avatar next to "Sign out", and its "View site →" link points at
`/u/<my slug>`.

### 8.5 The wordmark stays

`NavBar` and `Footer` hardcode "Grooves & Dust". That is the name of the site, not of a collector,
so it stays on every page and `NavBar` and `Footer` do not change at all. Renaming the project is a
separate decision for later, and when it comes it is one string in two components.

The collector identifies themselves through copy they already control: `heroEyebrow`,
`heroHeadline` and `heroLede` are per-user `SiteSetting` rows (§3.4), so each collection's hero
says whose it is without any component learning about ownership.

`displayName` from `GET /api/u/:slug` is used in exactly two places — the document title
(`CollectionPage` sets `<displayName> · Grooves & Dust`, so a browser tab and a shared link are
distinguishable) and the admin chrome beside "Sign out". The public page renders no new element.

### 8.6 The account screen

`/admin/account`: display name, slug, and a public/private switch. The slug field shows the live
URL beneath it and the warning from §4.4. A 409 from `PATCH /api/account` renders as a field error
("That address is taken"), reusing `ResourceScreen.module.css` like every other admin form.

## 9. Abuse, fraud and bots

### 9.1 What being open actually exposes

Isolation (§5) answers "can user B touch user A's data". It says nothing about a user who only
ever touches their own data and is still a problem. On a publicly reachable deployment there are
five of those:

1. **Link farming.** `/u/:slug` is an indexable page carrying outbound links the account holder
   chose — `Record.url`, `WishlistItem.url`, and the hero copy. That is the single most attractive
   thing about this site to someone who does not collect vinyl.
2. **Scripted signup.** `POST`-free though it is, the OAuth callback creates accounts, and
   throwaway Google and GitHub accounts are obtainable in bulk.
3. **Storage exhaustion.** One account uploading 5 MB covers in a loop fills the volume for
   everyone.
4. **Scraping.** Every public collection is enumerable once slugs are guessable.
5. **Impersonation.** Grabbing a slug or display name that reads as someone else, or as the site
   itself.

The response is layered and boring: raise the cost of each, and keep a lever that can be pulled
without a redeploy. Nothing here is a spam classifier.

### 9.2 Signup control — `SIGNUP_MODE`

One env var, three values, checked at step 4 of §6.4 — the only place an account is created:

| Value    | Behaviour                                                                                                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `closed` | An identity that resolves to no existing user is refused: `/?error=signup_closed`. Existing users sign in normally.                                                                                                         |
| `invite` | **Default.** Creation requires a valid, unexpired, unredeemed `Invite` code, carried from `GET /api/auth/:provider?invite=<code>` into `req.session.oauth` and validated inside the same transaction that creates the user. |
| `open`   | Anyone with a verified provider email, subject to §9.3 and §9.4.                                                                                                                                                            |

Defaulting to `invite` means the site is safe on the day it goes up and opens on a decision rather
than by omission. Flipping to `open` is an env change and a restart.

Invite codes are 16 random bytes, base64url — the code _is_ the credential, so it is generated,
never derived from a name or a sequence. They are issued with `psql` (§9.6); there is no invite UI,
because a screen for issuing invites is a feature for a site that has decided to grow, and this one
has not yet.

`Invite.redeemedById` is `@unique`, so a code cannot make two accounts even if two callbacks race:
the second hits the constraint inside the transaction and fails closed.

Rejected: allowlisting email domains. It reads like access control and is not — anyone can hold a
`gmail.com` address.

### 9.3 Rate limits

`express-rate-limit` is already a dependency (§6.1). It gains limiters, all keyed on `req.ip`,
which is the real client address because `app.ts` already sets `trust proxy` to 1 — without that
every request behind nginx would share one key and the limits would be nonsense.

| Route group                        | Limit                  | What it stops                                          |
| ---------------------------------- | ---------------------- | ------------------------------------------------------ |
| `GET /api/auth/:provider`          | 20 / 15 min / IP       | Filling the `session` table with abandoned OAuth state |
| `GET /api/auth/:provider/callback` | 20 / 15 min / IP       | Code and state spraying                                |
| Account creation (§6.4 step 4)     | 20 / hour, site-wide   | Signup floods. **Not per IP** — see below              |
| Non-GET `/api/*`                   | 300 / 15 min / session | Runaway scripted editing                               |
| `GET /api/u/:slug/*`               | 600 / 15 min / IP      | Bulk scraping                                          |
| `POST /api/uploads`                | 60 / hour / session    | Pairs with the byte quota below                        |

Account creation is the one that is not keyed on an address at all. Counting it per IP would mean
storing an IP against a sign-in decision, and `express-rate-limit` counts requests rather than
outcomes, so an ordinary returning sign-in would consume the allowance. `MAX_SIGNUPS_PER_HOUR` is
checked instead inside `resolveSignIn`, against the number of `User` rows created in the last hour
— no address is stored, and every branch above the check resolves to an existing account, so a
returning collector is never throttled. The trade is that a flood pauses signups for everyone
rather than for one attacker, which is acceptable when `SIGNUP_MODE=invite` is the primary gate.

The default memory store is process-local. That is the whole application today — one container —
and it is stated in the README, because the day this runs as two replicas the limits silently halve
in effectiveness and need a shared store.

### 9.4 Per-account ceilings

Enforced server-side, in the create handlers, returning **409** with a form-level message the admin
screens already know how to render:

| Resource            | Cap    | Env var                 |
| ------------------- | ------ | ----------------------- |
| Records             | 5,000  | `MAX_RECORDS_PER_USER`  |
| Wishlist items      | 500    | `MAX_WISHLIST_PER_USER` |
| Setup rows          | 100    | `MAX_SETUP_PER_USER`    |
| Bytes per file      | 5 MB   | `MAX_UPLOAD_BYTES`      |
| Uploaded bytes/user | 150 MB | `UPLOAD_QUOTA_BYTES`    |

Uploads are the one that returns **413** rather than 409, matching the existing oversized-file
response. `POST /api/uploads` sums `Upload.bytes` for the owner, refuses if the new file would
cross the line, and otherwise writes the file and its row in that order — a file with no row is a
leak the operator can find; a row with no file would 404 a cover.

**String length caps.** `server/src/schemas/record.ts` currently has `min(1)` and no maximum on
`title`, `artist`, `format` and `genre`, and `schemas/content.ts` the same on wishlist `title` and
`artist` and setup `label`/`value`. Unbounded on a single-tenant site, a payload on a public one:
they are the spam text itself, they break the card layout, and `genre` feeds the chip filter on
every visitor's page. All gain `.max(200)` — `.max(500)` for setup `value`. `displayName` is capped
at 80 and stripped of control characters where the provider profile is normalised, since it is
rendered in the admin chrome and returned by the public profile endpoint (§8.5).

### 9.5 Removing the reason to bother

The cheapest anti-spam measure here is making a spam page worthless.

- **Every user-supplied outbound link gets `rel="nofollow ugc noopener noreferrer"`.**
  `AlbumCard` and the wishlist card carry `noopener noreferrer` today; `nofollow ugc` is the
  addition, and it removes the entire SEO payoff of creating an account to post links. One prop
  change, two components.
- **`client/public/robots.txt`** — currently absent. Allows `/` and `/u/`, disallows `/admin` and
  `/api`.
- **Thin collections are not indexed.** `CollectionPage` sets
  `<meta name="robots" content="noindex">` when the collection has fewer than three records, so a
  fresh account with one link is not indexable at all. Stated honestly: the app is client-rendered,
  so this is a tag React writes on mount — Google executes JS and honours it, some other crawlers
  do not. It is a deterrent, not a guarantee, and `nofollow ugc` is the load-bearing part.
- Copy fields (`heroHeadline`, `heroLede`, …) render as text through React, which escapes — there
  is no HTML injection path, only a text-spam one, and that is what the length caps address.

### 9.6 Suspension and the operator's recipes

`User.suspendedAt` is set by hand. Once set: sign-in is refused (§6.4), the collection 404s to
everyone (§5.2), and deleting the user's session rows revokes any live session immediately.

```sql
-- Suspend an account and sign it out.
UPDATE "User" SET "suspendedAt" = NOW() WHERE slug = '<slug>';
DELETE FROM session WHERE (sess::jsonb ->> 'userId') = '<user id>';

-- Issue an invite (SIGNUP_MODE=invite).
INSERT INTO "Invite" (code, "expiresAt") VALUES (encode(gen_random_bytes(16), 'base64'), NOW() + INTERVAL '14 days')
RETURNING code;

-- List an account's files before deleting it, so they can be removed from the volume.
SELECT path, bytes FROM "Upload" WHERE "ownerId" = <user id>;

-- Delete an account. Cascades to records, wishlist, setup, settings, identities and upload rows.
DELETE FROM "User" WHERE slug = '<slug>';
```

The `base64` there needs its `+/` translated to `-_` to be URL-safe, or the code pasted as-is into
a query string with encoding — the README gives the exact line. File deletion is manual: the app
never unlinks, matching the existing decision that deleting a record leaves its cover (§4.4 of the
admin-panel spec).

All of this is why there is no super-admin role. These are five statements a person with shell
access runs perhaps twice a year; a moderation UI would be a new authenticated surface, a new set
of isolation tests, and a new thing to get wrong, to save typing them.

### 9.7 Bot checks — deferred, with the pick named

No CAPTCHA now. OAuth already forces an attacker to hold a real, email-verified Google or GitHub
account per signup, and `SIGNUP_MODE=invite` is both a stronger gate and instantly reversible. A
challenge widget would add a third-party script to a self-hosted app for a threat that is currently
gated twice over.

If it is ever needed — the trigger is `SIGNUP_MODE=open` plus a signup rate that does not look
human — the choice is **Cloudflare Turnstile**: a script tag on the landing page and one
server-side `fetch` to `siteverify` before the OAuth redirect starts. No npm dependency, no
`node-gyp`, and it does not hand visitor traffic to Google the way reCAPTCHA does. The insertion
point is deliberate: the `GET /api/auth/:provider` handler already validates and stores state, so a
token check is one more guard clause in a function that exists.

### 9.8 Content Security Policy

`helmet()` sets a CSP on **Express's own responses** — the API and `/uploads`. It does not touch
the HTML document, which nginx serves in production and Vite in development. So the app ships with
no document CSP today, and on a public site with user-supplied image URLs that is worth fixing.

A `Content-Security-Policy` header is added to the `location /` block in
`client/nginx.conf.template`:

```
default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline';
script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

`img-src https:` is deliberately wide — `coverUrl` accepts any external image, which is the
existing design. `frame-ancestors 'none'` closes clickjacking on `/admin`. `'unsafe-inline'` on
styles is required by Vite's injected critical CSS; scripts do not need it.

Accepted limitation, following from `img-src https:`: a collection owner can point a cover at a
server they control and log the IP and user agent of everyone who views their page. Proxying every
external image through the server would close it and would mean fetching arbitrary attacker-chosen
URLs from inside the network — trading a tracking pixel for an SSRF surface. Not worth it.

## 10. Testing strategy

Test-first throughout. Vitest + Supertest on the server, Vitest + React Testing Library on the
client.

**The auth helper changes shape.** `server/tests/helpers/auth.ts` currently posts a password.
It becomes `signInAgent(profile)`, which stubs the provider's token and profile calls via
`vi.stubGlobal('fetch', …)` and then drives the **real** flow: `GET /api/auth/google`, read
`state` out of the `Location` header, `GET /api/auth/google/callback?code=…&state=…`. A
`request.agent(app)` carries the session across both.

This is deliberately not a test-only backdoor that sets `session.userId` directly. A backdoor
would mean the isolation suite never exercises the code path that decides who you are, and it
would be a production route that must never ship enabled.

`resetDb()` adds `"User"` and `"OAuthIdentity"` to its `TRUNCATE`. `tests/fixtures/collection.ts`
takes an `ownerId`, and a new `tests/fixtures/users.ts` creates two users with content, since
almost every test now needs at least one owner and the isolation tests need two.

**New server tests:**

- `routes/auth.oauth.test.ts` — the start redirect carries `state` and, for Google, an S256
  `code_challenge`; the callback rejects a missing, mismatched or **replayed** state; an
  unconfigured provider 404s; an unverified email is refused; the session id changes on sign-in;
  logout destroys the row.
- `routes/auth.linking.test.ts` — Google then GitHub with the same verified email is one user with
  two identities; different emails are two users; the same provider account twice does not create
  a second user.
- `routes/bootstrap.test.ts` — a matching email claims the placeholder rather than creating a
  second user; the claim does not fire twice; a non-matching email creates a new user and leaves
  the placeholder alone; with the var unset nothing is claimed.
- `routes/isolation.test.ts` — **the required one**. For each of `records`, `wishlist`, `setup`:
  user B's `GET /api/<resource>` excludes A's rows; `GET /api/<resource>/:id`, `PATCH` and
  `DELETE` against A's row each return **404, not 403**, and A's row is unchanged afterwards.
  Plus: B's `PATCH /api/settings` does not touch A's settings, and a `POST` body carrying
  `ownerId` is ignored.
- `routes/publicCollection.test.ts` — `/api/u/:slug/*` returns that owner's data; an unknown slug
  and a private collection return identical 404s to a stranger; the owner gets 200 on their own
  private collection; stats, genres and `isNew` are per collection.
- `lib/slug.test.ts` — two owners can both hold `kind-of-blue`; a collision within one owner still
  suffixes.
- `security.test.ts` — the session cookie is `SameSite=Lax`; a non-GET with a foreign `Origin` is
  403; same-origin and origin-less requests pass.
- `routes/uploads.test.ts` — the returned URL is under the owner's directory; an unauthenticated
  upload is 401; a file over `MAX_UPLOAD_BYTES` is 413 from multer before the body is buffered; an
  upload crossing `UPLOAD_QUOTA_BYTES` is 413 and writes neither file nor row; a file that fits
  exactly at the boundary is accepted; one owner's usage does not count against another's.
- `routes/signupMode.test.ts` — `closed` refuses a new identity but lets an existing user in;
  `invite` refuses without a code, refuses an expired, unknown or already-redeemed code, accepts a
  valid one and marks it redeemed; a code cannot be redeemed twice; `open` creates freely.
- `routes/suspension.test.ts` — a suspended user cannot sign in, cannot sign in via a second
  provider, and their collection 404s at `/u/:slug` identically to an unknown slug.
- `routes/limits.test.ts` — the per-resource ceilings return 409 at the boundary and 201 below it;
  over-long `title`, `artist`, `genre` and setup `value` are 400 with a field error.

**Every existing route test** gains an owner: `records.read`, `records.write`, `content.read`,
`content.write`, `stats`, `uploads`, `schema`, `fixtures/collection`. `routes/loginLimiter.test.ts`
and `scripts/setPassword.test.ts` are deleted with the code they cover.

**Client tests:** `AuthProvider` exposes the user and survives a 401; the landing page renders one
anchor per configured provider and shows an `?error=` message; `RequireAuth` redirects to `/`
without a user; `CollectionPage` requests `/api/u/<slug>/…` for a public slug and `/api/…` for the
own scope; the account screen renders a 409 as a field error; `AlbumCard` and the wishlist card
render `rel="nofollow ugc noopener noreferrer"` on an outbound link; `CollectionPage` sets the
`noindex` meta below three records and removes it above. `LoginPage.test.tsx` is replaced.

Rate limiters are tested the way `loginLimiter.test.ts` does it today — through the exported
factory at a low threshold, with the mounted instances effectively open under `NODE_ENV=test`,
because every Supertest request shares one IP and the suite would otherwise exhaust the real
allowance part-way through.

**CI** needs no structural change — the migration runs against the service container the same way.

## 11. Environment, infrastructure and docs

`.env.example` — removed: `ADMIN_PASSWORD_HASH`. Added:

```
# --- Public origin ---
# Must match the callback URLs registered with Google and GitHub exactly.
# Dev: http://localhost:5173   Prod: https://your-host
PUBLIC_BASE_URL=http://localhost:5173

# --- OAuth providers (at least one is required) ---
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# --- Bootstrap owner ---
# The first sign-in with this verified email claims the existing collection
# instead of creating a new account. Set it before signing in the first time.
BOOTSTRAP_OWNER_EMAIL=

# --- Signup gate (§9.2) ---
# closed  only existing users can sign in
# invite  a new account needs an invite code (issue one with psql, see README)
# open    anyone with a verified Google or GitHub email
SIGNUP_MODE=invite

# --- Per-account ceilings (§9.4). Defaults shown; override only if you need to. ---
# 5 MB per file, 150 MB per user.
MAX_UPLOAD_BYTES=5242880
UPLOAD_QUOTA_BYTES=157286400
MAX_RECORDS_PER_USER=5000
MAX_WISHLIST_PER_USER=500
MAX_SETUP_PER_USER=100
# Site-wide, not per IP (§9.3).
MAX_SIGNUPS_PER_HOUR=20
```

`server/src/config/env.ts` — drop `ADMIN_PASSWORD_HASH`; add `PUBLIC_BASE_URL` via the existing
`required()`; the four provider variables and `BOOTSTRAP_OWNER_EMAIL` as optional; `SIGNUP_MODE`
parsed against the three literals and rejected at startup if it is anything else; the six ceilings
parsed as numbers with defaults, reusing the shape of the existing `parsePort()` helper — which
exists precisely because Compose substitutes an empty string for an unset variable and `Number('')`
is `0`, and a quota of zero would refuse every upload.

A startup check requires at least one complete provider pair; otherwise the server boots into a
state where nobody can ever sign in.

`server/package.json` — remove `admin:hash` and `admin:set-password`; remove `bcryptjs` and
`@types/bcryptjs`.

`client/nginx.conf.template` — one added header, the document CSP from §9.8, in the `location /`
block. No Docker or Vite proxy changes: `/api` and `/uploads` are already proxied in both
environments, and the OAuth callback is under `/api`.

`client/public/robots.txt` — new (§9.5).

`README.md` — the "Admin panel" section is rewritten as "Accounts":

- Creating a Google OAuth client and a GitHub OAuth App, with the exact callback URL for each
  environment.
- The new environment variables, including `SIGNUP_MODE` and what each value means.
- The bootstrap claim and when to set `BOOTSTRAP_OWNER_EMAIL` — before the first sign-in.
- That the migration signs the existing session out.
- The operator recipes from §9.6 — issue an invite, suspend an account, delete one, list its files
  — and the sign-in recovery recipe from §6.6.
- That rate limits are process-local and need a shared store if the app is ever run as more than
  one container (§9.3).
- Removal of `admin:set-password` and `admin:hash`.

`/u/:slug`, the private switch and the per-account ceilings get a short section of their own.

## 12. Risks

- **Provider outage locks people out.** Two providers, and either can be linked to an existing
  account, so an outage at one is survivable. The `psql` recipe covers the rest.
- **Email linking trusts the provider's verification claim.** Stated in §6.4. Mitigated by
  refusing sign-in outright when verification is not asserted, so an unverified address never
  becomes a linking key.
- **Slug squatting and impersonation.** Nothing stops a new user taking a desirable slug or a
  display name that reads as someone else. The reserved list protects the routes that matter and
  `SIGNUP_MODE=invite` bounds who can try; beyond that it is a suspension, by hand.
- **Private collections' covers stay reachable by direct URL.** Accepted in §5.5.
- **The migration signs everyone out.** One person today, and unavoidable — the session payload
  changes shape.
- **Rate limits are process-local.** Correct for one container, quietly wrong for two. Documented
  rather than solved, because a shared store is a dependency this app does not need yet (§9.3).
- **Spam is deterred, not detected.** There is no classifier and no reporting flow. If a spam wave
  gets past `invite` mode and the ceilings, the response is manual: suspend, and consider
  `SIGNUP_MODE=closed` while you work out what happened. The bet is that `nofollow ugc` plus an
  invite gate makes this site a bad target rather than a defended one, which is the right trade
  for a personal project — and the wrong one if it ever gets popular.
- **External cover URLs let an owner log their visitors' IPs.** Accepted in §9.8; the alternative
  is an SSRF surface.
