# Admin Panel — Design

**Date:** 2026-08-21
**Status:** Approved for planning
**Repo:** `Anddep/vinyl-lib`

## 1. Context

The homepage ships as of [PR #1](https://github.com/Anddep/vinyl-lib/pull/1), but it renders
from `client/src/data/collection.ts` — a static TypeScript module transcribed from the design
handoff. Nothing is editable without a code change and a redeploy.

The server is a scaffold: one `GET /api/health` route, and a `Record` Prisma model with four
fields (`id`, `title`, `artist`, `year`, `createdAt`) that no code reads. There is no write API,
no auth, no router in the client, and no test infrastructure anywhere in the repo.

This design covers a single-collector admin panel that makes the homepage's content editable,
backed by a real schema and API.

### Goals

- Create, edit, delete and reorder records, wishlist items, setup rows and FAQ entries.
- Give each record an external URL used as the click target on its card.
- Attach cover art, either by uploading a file or pasting an image URL.
- Protect every write behind a login.
- Keep the public homepage looking and behaving as designed.

### Non-goals

- Multiple users, roles, or permissions. One collector, one password.
- A public record detail page. Cards link outward (§4.3); `/records/:slug` is not built.
- Drag-and-drop reordering. Ordering is an integer field (§3.2).
- Public write access of any kind — no comments, no submissions, no sign-up.
- Editing hero, section or contact copy. Those stay in code.

## 2. Approach

The admin lives in the existing React app as a lazy-loaded route tree, not a second bundle or a
separate service. `react-router` is added to the client; `/` serves the public homepage and
`/admin/*` sits behind an auth guard loaded via `React.lazy`, so public visitors never download
admin code. One build, one container, one deploy.

The nginx config already ends `location /` with `try_files $uri $uri/ /index.html`, so deep
links like `/admin/records/12` resolve without a config change.

Rejected alternatives:

- **Two Vite entry points.** Guarantees no admin code in the public bundle, but lazy-loading
  achieves the same in practice and this costs a second nginx location block and a multi-entry
  build. Moving to it later is a config change, not a rewrite.
- **A third npm workspace with its own container.** Maximum isolation, most infrastructure:
  another Dockerfile, compose service and CI target, for a single-user admin.
- **A headless CMS (Directus, Payload).** Least code, but adds a service, sidelines the Express
  and Prisma scaffold already built and dockerised, and moves the content model out of git.

## 3. Data model

### 3.1 Records

`Record` is replaced wholesale. The existing model has no data and no readers, so this is a
new migration rather than a careful alteration.

```prisma
model Record {
  id        Int      @id @default(autoincrement())
  slug      String   @unique
  title     String
  artist    String
  year      Int
  format    String                    // "LP", "2×LP", "7\"", "Box Set"
  genre     String
  label     String?                   // feeds the "Top label" stat
  note      String?                   // collector's line on featured cards
  url       String?                   // external card target (§4.3)
  coverUrl  String?                   // uploaded path or pasted URL (§4.4)
  featured  Boolean  @default(false)
  position  Int      @default(0)      // featured grid order
  addedAt   DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([addedAt])
  @@index([featured, position])
}
```

`year` is required, where the scaffold had it optional. The card spec line renders
`1970 · 2×LP · JAZZ`; a null year prints `null` into that string.

`slug` is unique and generated from the title on create, with a numeric suffix on collision
(`blue-train`, `blue-train-2`). It is editable, because two pressings of the same album are a
realistic case. It is retained even though cards link outward — it keeps URLs stable if a
detail page is ever added, and gives the admin a human-readable identifier.

### 3.2 Ordering

`WishlistItem`, `SetupItem` and `FaqItem` each carry a `position Int @default(0)`, as does
`Record` for the featured grid. Lists sort by `position ASC, id ASC`, so equal positions fall
back to insertion order rather than an arbitrary one.

Ordering is edited as a number field in the form. Drag-and-drop is explicitly out of scope: it
needs a drag library, touch handling, and a batch reorder endpoint, to save typing a number in
lists of four to eight items.

### 3.3 Remaining models

```prisma
model WishlistItem {
  id        Int      @id @default(autoincrement())
  title     String
  artist    String
  pressing  String                    // "1971 original", "any pressing"
  url       String?
  position  Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model SetupItem {
  id        Int      @id @default(autoincrement())
  icon      String                    // turntable|cartridge|amplifier|speakers|cable
  label     String                    // "Turntable"
  value     String                    // "Technics SL-1200 MK2 · 1984, serviced 2023"
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

`SetupItem.icon` is a string constrained by a zod enum at the API boundary, not a Postgres
enum. The five icons are drawn by `client/src/components/ui/icons.tsx`; adding one is a code
change either way, and a string avoids a migration each time.

`SiteSetting` holds one key today, `collectingSince`. A key/value table rather than a columned
singleton, so a second setting does not need a migration.

### 3.4 Stats are computed, with one exception

`GET /api/stats` computes on each request:

| Card                  | Source                                                       |
| --------------------- | ------------------------------------------------------------ |
| Total records         | `COUNT(*)`                                                   |
| Top genre · N records | `GROUP BY genre ORDER BY count DESC LIMIT 1`                 |
| Top label · N records | `GROUP BY label ORDER BY count DESC LIMIT 1`, ignoring nulls |
| Collecting since      | `SiteSetting['collectingSince']`                             |

**Collecting since cannot be derived.** `MIN(addedAt)` is the date the earliest row was entered
into _this database_, not the year the collection started. With seeded data it would render 2026. It is a fact about the collector, so it is stored and edited at `/admin/settings`.

The same computation feeds the counters elsewhere on the page: `8 of 324 shown`, `View All 324
Records`, and `Last 30 days · 11 records` (records with `addedAt` inside 30 days).

### 3.5 The "New" badge

Derived, not stored: the single most recently added record carries the badge. A time window
("added within 14 days") was considered and rejected — with the seeded dates it would badge two
of six cards, where the design badges exactly one.

## 4. API

All routes are under `/api`. Public reads need no auth; every write requires a session (§5).

### 4.1 Public reads

```
GET /api/records?featured=true&limit=8     -> Record[]  (position ASC, id ASC)
GET /api/records?sort=addedAt&limit=6      -> Record[]  (addedAt DESC)
GET /api/stats                             -> Stats
GET /api/wishlist                          -> WishlistItem[]
GET /api/setup                             -> SetupItem[]
GET /api/faq                               -> FaqItem[]
```

`limit` is clamped to 100 server-side so a crafted query cannot ask for the whole table.

Genre and decade filtering stays **client-side**, unchanged from the current implementation.
The handoff's reasoning holds — 324 records fit in memory — and the filter already works
against the fetched featured set.

### 4.2 Writes

For each of `records`, `wishlist`, `setup`, `faq`:

```
POST   /api/<resource>        -> 201 + created row
PATCH  /api/<resource>/:id    -> 200 + updated row
DELETE /api/<resource>/:id    -> 204
```

Plus `PATCH /api/settings` taking `{ key, value }` pairs.

Bodies are validated with **zod**. Four resources times three verbs is more surface than
hand-rolled checks can cover consistently, and zod gives one schema per resource that also
types the handler. A failed parse returns `400` with a field-keyed error object that the admin
forms render inline:

```json
{ "error": "Validation failed", "fields": { "year": "Expected number, received string" } }
```

`PATCH` bodies are partial; `POST` bodies are complete. Both derive from one base schema via
`.partial()`, so the two can never drift.

### 4.3 The record URL

`Record.url` is the click target of the card. Validated as `http`/`https` only — a zod URL
check plus an explicit protocol allowlist, because `javascript:` passes a naive URL parse and
would be a stored-XSS vector on a link the collector pastes.

Rendering: when `url` is present the card is an `<a href target="_blank"
rel="noopener noreferrer">`; when absent, a non-interactive `<article>` with no pointer cursor.
`AlbumCard` already branches on an optional `href` prop, so this is a prop change at the call
site, not a component rewrite.

This replaces the `/records/:slug` links currently shipped, which 404 because no such route
exists.

### 4.4 Cover images

Two paths, as chosen:

```
POST /api/uploads    multipart/form-data, field "file"  -> { url: "/uploads/<uuid>.jpg" }
```

- Mime allowlist: `image/jpeg`, `image/png`, `image/webp`, `image/avif`. Checked against the
  sniffed content type, not the client-supplied filename extension.
- Size cap 5 MB, enforced by `multer` limits so an oversized body is rejected before it is
  buffered.
- Stored filename is a generated UUID plus the extension implied by the sniffed type. The
  original filename is never used in a path.
- Files land on a named Docker volume mounted at `/app/server/uploads`, served read-only by
  `express.static`.

`coverUrl` therefore holds either an app-relative `/uploads/...` path or an external URL. Both
are just a string to the renderer. External URLs are validated with the same protocol
allowlist as §4.3.

When `coverUrl` is empty the existing striped placeholder renders, exactly as the design
intends. An `onError` handler on the `<img>` falls back to the placeholder too, so a dead
external host degrades to the designed state instead of a broken image icon.

Deleting a record does **not** delete its uploaded file. Orphan cleanup is deliberately out of
scope; a stray image on a volume is cheaper than the risk of deleting a file another row still
references.

## 5. Auth and security

### 5.1 Session

`express-session` with `connect-pg-simple`, storing sessions in the Postgres instance already
running. This is chosen over a stateless signed cookie specifically so logout revokes: a
stateless token stays valid until it expires no matter what the server does.

Cookie flags: `httpOnly` (unreadable by injected script), `SameSite=Strict`, `Secure` when
`NODE_ENV === 'production'`, and a rolling 7-day `maxAge`.

```
POST /api/auth/login    { password }  -> 204 + Set-Cookie
POST /api/auth/logout                 -> 204, destroys the session row
GET  /api/auth/me                     -> { authenticated: boolean }
```

### 5.2 Credential

One admin. `ADMIN_PASSWORD_HASH` in `.env` holds a bcrypt hash (cost 12); `SESSION_SECRET`
holds the signing secret. A helper script prints a hash to paste in:

```
npm run admin:hash -- 'the password'
```

No user table, no signup, no reset flow. `.env.example` gains both keys with empty values and a
comment pointing at the script. The server refuses to start if either is missing in production,
using the existing `required()` helper in `server/src/config/env.ts`.

Login is rate-limited with `express-rate-limit` — 10 attempts per 15 minutes per IP — so a
single password cannot be brute-forced. Failed logins return `401` with a generic message and
no indication of whether the password was close.

### 5.3 CSRF

`SameSite=Strict` is the mitigation. The admin and API are same-origin in both environments —
nginx proxies `/api/` in production, the Vite dev server proxies it in development — so a
cross-site form post cannot carry the cookie. No token exchange is added; it would be
ceremony without a threat it closes.

### 5.4 Pre-existing issues this closes

Three findings from the earlier branch review become exploitable once writes exist, so they are
fixed as part of this work rather than deferred:

1. `server/src/index.ts` calls `app.use(cors())`, allowing every origin. Replaced with a
   same-origin configuration; both proxies make cross-origin access unnecessary.
2. `docker-compose.yml` publishes Postgres to the host in every environment, including prod,
   with the password from `.env.example`. The mapping moves to `docker-compose.override.yml`
   so it is development-only.
3. `docker-compose.yml` publishes the API port directly to the host. Removed in prod; nginx is
   the only public entry point.

## 6. Admin UI

### 6.1 Routes

```
/admin/login                 password form
/admin                       dashboard: row counts + quick links
/admin/records               list, search, filter by featured
/admin/records/new           create form
/admin/records/:id           edit form
/admin/wishlist              list + inline create/edit
/admin/setup                 list + inline create/edit
/admin/faq                   list + inline create/edit
/admin/settings              collectingSince
```

Records get dedicated form pages because the model has twelve fields. The other three
resources have three to four fields each and are edited inline in their list.

`RequireAuth` wraps the tree: it calls `GET /api/auth/me` once, renders a spinner while
pending, and redirects to `/admin/login` on a negative answer, preserving the attempted path so
login returns the user to where they were headed.

### 6.2 Reuse

The admin uses the same design system as the public site — `styles/tokens.css`, `Button`,
`Field`, `FilterChip` — so it reads as part of the same product. Three new shared components:

- `DataTable` — column definitions in, rows and a row-action slot out.
- `ConfirmDialog` — a focus-trapped modal for destructive actions. Deletes are irreversible and
  must not be one misclick away.
- `ImageField` — the upload/paste toggle, with a thumbnail preview of the current value.

### 6.3 Feedback

Every mutation resolves into one of three visible states: a success toast, a field-level error
from the API's `fields` object, or a form-level error for anything else. Submit buttons disable
while in flight, matching the existing contact form's `sending` state.

## 7. Homepage migration

`client/src/data/collection.ts` stops being the content source. Each section fetches from the
API through a small typed client extending `client/src/api/client.ts`.

Loading and failure states, in the design's own vocabulary:

- **Loading** — the striped `ImagePlaceholder` components already render at the correct aspect
  ratios and slot sizes, so the skeleton is the design. Text lines render at their final size
  with an empty string, holding layout and avoiding a shift on arrival.
- **Failure** — the section keeps its heading and shows a single muted line in `--color-text-muted`
  rather than collapsing, so a dead API does not produce a half-empty page.

`data/collection.ts` is deleted once the seed script owns the content, rather than left behind
as a stale second copy.

## 8. Seed data and a visible consequence

A Prisma seed script inserts the handoff's exact content: 8 featured records, 6 recent, 6
wishlist items, 5 setup rows, 4 FAQ entries, and `collectingSince = 2009`. Real labels are
filled in for the records that have them (Columbia, Impulse!, Warp, Blue Note, Sire, Melodiya,
Mo' Wax).

**The stat cards will show smaller numbers than the mockup.** The design reads
`324 / Jazz · 64 records / Blue Note · 21 records`. Those are invented figures for a collection
this database does not contain. Once the numbers are computed, the page reports what is
actually there — roughly `20 / Jazz · 3 records / Blue Note · 1 record` — and the counters
follow (`8 of 20 shown`, `View All 20 Records`).

This is the correct behaviour and the point of computing them: the alternative is a number that
lies. `Collecting since 2009` still renders as designed, because it is a stored setting. The
numbers reach the design's figures when the real collection is entered.

## 9. Testing

**The repo has no test infrastructure.** No runner, no test files, and `.github/workflows/ci.yml`
runs only `lint` and `build`. Standing this up is part of the work, and development is
test-first.

- **Server** — Vitest plus Supertest. Coverage: the auth guard rejects unauthenticated writes on
  every resource; zod rejects malformed bodies and reports per-field errors; the protocol
  allowlist rejects `javascript:` URLs; slug collisions get suffixed; `limit` is clamped; the
  stats computation returns correct counts against a known fixture; upload rejects oversized
  and wrong-mime files.
- **Client** — Vitest plus React Testing Library. Coverage: `RequireAuth` redirects when
  unauthenticated; record form submits and renders field errors; `ConfirmDialog` blocks a delete
  until confirmed; `AlbumCard` renders an anchor with `rel="noopener noreferrer"` when `url` is
  set and a non-interactive article when it is not.
- **CI** — a `test` step added to `ci.yml`, running before `build`. Server tests needing a
  database use a `postgres` service container.

## 10. Infrastructure changes

- Named volume `uploads` mounted at `/app/server/uploads`, in base compose and prod.
- Postgres and API host port mappings move to the dev-only override file (§5.4).
- `/uploads/` needs its own proxy rule in **both** environments — it does not sit under `/api/`,
  so the existing rules do not cover it: a second `location /uploads/` block in
  `client/nginx.conf.template`, and a second key in the `server.proxy` object in
  `client/vite.config.ts`.
- `.env.example` gains `ADMIN_PASSWORD_HASH` and `SESSION_SECRET`.
- CI gains a `postgres` service and a `test` step.

## 11. Dependencies added

| Package                                         | Where  | Why                                       |
| ----------------------------------------------- | ------ | ----------------------------------------- |
| `react-router-dom`                              | client | Admin route tree; no router exists today. |
| `zod`                                           | server | Request validation across four resources. |
| `express-session`, `connect-pg-simple`          | server | Revocable sessions in existing Postgres.  |
| `bcrypt`                                        | server | Password hashing.                         |
| `express-rate-limit`                            | server | Login brute-force protection.             |
| `multer`                                        | server | Multipart upload handling.                |
| `vitest`, `supertest`, `@testing-library/react` | both   | Test infrastructure (§9).                 |

## 12. Risks

- **Externally hosted covers can break.** A Discogs URL is not under your control. Mitigated by
  the `onError` fallback to the placeholder, and by the upload path existing for anything you
  want to guarantee.
- **Orphaned uploads accumulate.** Accepted (§4.4). Revisit if the volume grows enough to matter.
- **A single shared password has no audit trail.** Acceptable for one collector; the
  `SiteSetting`/session structure does not block adding a `User` table later.
- **Seeded stats look sparse.** Documented in §8. It is honest output, not a defect.
