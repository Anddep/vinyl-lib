# vinyl-lib

For your collection vinyl's.

A full-stack scaffold: React + TypeScript (Vite) client, Express + TypeScript + Prisma server, PostgreSQL 16, all orchestrated with Docker Compose.

## Stack

- **Client**: React 18 + TypeScript, built with Vite
- **Server**: Node.js + Express + TypeScript
- **Database**: PostgreSQL 16, via Prisma ORM
- **Containerization**: Docker + Docker Compose (separate dev/prod configs)
- **Package manager**: npm workspaces (`client`, `server`)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (v2, bundled with Docker Desktop)
- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) 24+ (only needed to run `npm install` locally for editor tooling, linting, and Git hooks — not required to run the app itself)

## Getting started

```bash
git clone git@github.com:Anddep/vinyl-lib.git
cd vinyl-lib
cp .env.example .env
npm install   # sets up local tooling: workspace deps, ESLint/Prettier, Husky hooks
```

Adjust `.env` if you need different ports or credentials — every value the stack uses comes from that file.

> Day-to-day commands, troubleshooting and backups live in
> **[RUNNING.md](RUNNING.md)**.

### Run in dev mode (hot reload)

```bash
docker compose up --build
```

This builds and starts `client`, `server`, and `db`. `docker-compose.override.yml` is loaded automatically and:

- bind-mounts `client/src` and `server/src` into their containers, so edits hot-reload without rebuilding the image
- runs the Vite dev server (`client`, default `http://localhost:5173`) and `ts-node-dev` (`server`, default `http://localhost:4000`)
- proxies `/api/*` requests from the Vite dev server straight to the `server` container, avoiding CORS

Open `http://localhost:5173` — the page calls `GET /api/health` on load and shows whether the client → server → database round trip succeeded.

### Run in prod mode

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
```

This skips the dev bind mounts and instead builds optimized images: the client is compiled with Vite and served as static files via nginx (which also proxies `/api/*` to the server), and the server runs its compiled JavaScript directly (`node dist/index.js`).

### Run Prisma migrations

With the stack running (`db` healthy):

```bash
# Apply pending migrations in development (creates new ones interactively if the schema changed)
docker compose exec server npx prisma migrate dev

# Apply already-generated migrations only (typical for prod/CI)
docker compose exec server npx prisma migrate deploy

# Regenerate the Prisma client after editing prisma/schema.prisma
docker compose exec server npx prisma generate
```

`server/prisma/schema.prisma` defines the content models — `Record`, `WishlistItem`, `SetupItem` and `SiteSetting`, each owned by a `User` — plus `OAuthIdentity`, `Invite` and `Upload`. Every migration is committed under `server/prisma/migrations/`.

## Accounts

Anyone can sign in with Google or GitHub and keep their own collection. Yours
lives at `/u/<your address>`; `/admin` edits it. There is no password and no
signup form — the provider vouches for you, and nothing else does.

> **Upgrading from the single-password version?** The migration replaces
> `session.isAdmin` with a user id, so the existing session is signed out. Set
> `BOOTSTRAP_OWNER_EMAIL` before you sign in again (see
> [First boot](#first-boot)) or your existing collection stays unclaimed.

### Registering the providers

At least one is required; configure both and the sign-in screen offers both.
A provider with a missing id or secret is simply absent — its routes 404 rather
than offering a button that cannot work.

**Google.** Cloud Console → APIs & Services → Credentials → _Create
credentials_ → _OAuth client ID_ → **Web application**. Under _Authorised
redirect URIs_ add the one matching where you run it:

```
http://localhost:5173/api/auth/google/callback     # development
https://<your-host>/api/auth/google/callback       # production
```

**GitHub.** Settings → Developer settings → OAuth Apps → _New OAuth App_. The
_Authorization callback URL_ takes the same two shapes with `github` in place
of `google`.

Google permits `http` on `localhost` and GitHub permits any `http` callback, so
neither needs a tunnel for local development. Copy the client id and secret of
each into `.env`, and set `PUBLIC_BASE_URL` to the origin the browser sees — it
is what the callback URL is built from, and it must match the registration
exactly.

### First boot

Set `BOOTSTRAP_OWNER_EMAIL` to your own verified address **before** signing in
for the first time, then create the schema:

```bash
docker compose exec server npx prisma migrate deploy
```

The migration puts every existing record, wishlist item, setup row and setting
behind one placeholder owner. The first sign-in with that address claims the
placeholder rather than starting an empty collection. It can only happen once:
the claim only matches a row whose email is still unset, and every later
sign-in resolves to your account before it is reached.

Leave the variable unset and nothing is claimed — the collection simply stays
at `/u/collection` until you set it and sign in.

### The signup gate

`SIGNUP_MODE` decides who can create an account. It defaults to `invite`, so a
fresh deployment is not open by accident.

| Value    | Behaviour                                                            |
| -------- | -------------------------------------------------------------------- |
| `closed` | Only existing users can sign in. A new identity is refused.          |
| `invite` | A new account needs an invite code. Existing users sign in normally. |
| `open`   | Anyone with a verified Google or GitHub email.                       |

Changing it is an env edit and a restart, which is the point: it is the fastest
lever you have if the site starts attracting the wrong kind of signup.

### Operator recipes

There is no moderation UI. These are the whole of it, and they run in `psql`:

```bash
docker compose exec db psql -U vinyl_lib
```

```sql
-- Issue an invite (SIGNUP_MODE=invite). Hand the code out as
--   https://<your-host>/?invite=<code>
INSERT INTO "Invite" (code, "expiresAt")
VALUES (encode(gen_random_bytes(16), 'base64'), NOW() + INTERVAL '14 days')
RETURNING code;

-- Suspend an account and sign it out. Both statements: the flag blocks the
-- next sign-in, the delete revokes the session they already have.
UPDATE "User" SET "suspendedAt" = NOW() WHERE slug = '<slug>';
DELETE FROM session WHERE (sess::jsonb ->> 'userId') = '<user id>';

-- List an account's files before deleting it, so they can be removed from the
-- uploads volume by hand. The app never unlinks.
SELECT path, bytes FROM "Upload" WHERE "ownerId" = <user id>;

-- Delete an account. Cascades to records, wishlist, setup, settings,
-- identities and upload rows.
DELETE FROM "User" WHERE slug = '<slug>';
```

`encode(..., 'base64')` can produce `+` and `/`, which need URL-encoding when
you paste the code into an invite link. Generating a fresh code until you get
one without them is the lazy way out and works fine.

### If you are locked out

There is deliberately no break-glass password: keeping one would re-introduce
the long-lived shared secret this replaced, and a second path through
authentication for every future change to check. Anyone who can be locked out
here has shell access, and the recovery is one statement — attach a provider
identity you control to the account:

```sql
INSERT INTO "OAuthIdentity" (provider, "providerUserId", "userId")
VALUES ('github', '<your github numeric id>', <user id>);
```

Your GitHub numeric id is the `id` field from `https://api.github.com/users/<login>`.
For Google it is the `sub` claim, which is easiest to read out of the server log
during a failed sign-in.

### Limits

Per account: 5,000 records, 500 wishlist items, 100 setup rows, and 150 MB of
uploads at 5 MB a file. All are `.env` variables, all return a clear error at
the boundary rather than failing silently.

Signups are capped site-wide per hour rather than per IP — counting per address
would mean storing one against a sign-in decision. Requests are rate limited
per IP.

> Rate limits live in the process, so they are correct for one container and
> quietly half as effective across two. Running more than one replica needs a
> shared store.

### Sharing your collection

Your collection is public at `/u/<your address>` as soon as you have one. The
Profile screen changes the address and hides the collection.

Changing the address frees the old one **immediately** and any link you have
already shared stops working. There is no redirect, on purpose: if someone else
later takes the freed address, a redirect would either block them from their own
URL or silently point your old links at a stranger.

Switching a collection to private returns the same not-found page as an address
nobody has taken, so nobody can tell the difference between hidden and unused.
You still see your own.

### What you can edit

| Screen       | Controls                                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| Records      | Every field on a record, including the URL its card links to and its cover art |
| Wishlist     | The Looking For section, with cover art                                        |
| Setup        | The equipment rows in What it all plays on                                     |
| Site content | Hero and setup copy and imagery, and Collecting since                          |
| Profile      | Your display name, your address, and whether the collection is public          |

Three of the four stat cards are **computed** from your records — total, top
genre and top artist — so they cannot drift from the data, and each is scoped to
your own collection. "Collecting since" is a stored setting: the earliest
`addedAt` is when a record was entered here, not when the collection started.

The genre filter is built from the genres actually in your collection, so a
genre you invent on a record appears as a chip with no code change, and one no
record uses stops offering an always-empty filter.

Record cards link out to whatever URL you set (Discogs, Bandcamp, anywhere), and
carry `rel="nofollow ugc"` so posting links here earns nobody any search
ranking. A record with no URL renders as a non-interactive card. Covers can be
uploaded or pasted as a URL; with neither, the striped placeholder shows.

## Tests

```bash
npm test              # both workspaces
npm test -w server    # typecheck + Vitest + Supertest
npm test -w client    # Vitest + React Testing Library
```

Server tests need a database of their own:

```bash
docker compose up -d db
docker compose exec db createdb -U vinyl_lib vinyl_lib_test
npm run test:db:setup -w server
```

`DATABASE_URL_TEST` in `.env` points at it. Tests truncate between cases, so it
must never be the development database.

## Project structure

```
project-root/
├── client/            # React app (Vite)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── api/       # fetch wrapper for calling the backend
│   ├── public/
│   └── Dockerfile      # multi-stage: dev (vite server) / prod (nginx)
├── server/             # Express API
│   ├── src/
│   │   ├── index.ts    # app entrypoint
│   │   ├── routes/     # GET /api/health, etc.
│   │   ├── config/     # typed env var loading/validation
│   │   └── prisma/     # shared PrismaClient instance
│   ├── prisma/         # schema + migrations
│   └── Dockerfile      # multi-stage: dev (ts-node-dev) / prod (compiled JS)
├── docker-compose.yml            # base config
├── docker-compose.override.yml   # dev overrides (auto-loaded)
├── docker-compose.prod.yml       # prod overrides
├── .env.example
└── package.json                  # npm workspaces root
```

## Git workflow

- **Branch naming**: `feat/<short-description>`, `fix/<short-description>`, `chore/<short-description>` (mirrors the commit prefixes below).
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, etc.
- **Pre-commit hook**: Husky + lint-staged run automatically on `git commit`, linting and formatting only the files you staged in whichever workspace(s) they belong to. A failing lint blocks the commit — fix the reported issues (or let `--fix` resolve them) and commit again.
- No remote beyond `origin` is assumed by this scaffold. If you're starting a new repo from this template elsewhere:
  ```bash
  git remote add origin <url>
  git push -u origin main
  ```

## Scripts

Root (`package.json`):

- `npm run dev` — `docker compose up --build`
- `npm run prod` — `docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build`
- `npm run build` — builds both workspaces
- `npm run lint` — lints both workspaces

Each workspace (`client/package.json`, `server/package.json`) also exposes its own `dev`, `build`, `lint` (and `start`/`preview` respectively).

The `admin:hash` and `admin:set-password` scripts are gone: there is no password
to set. See [Accounts](#accounts).

## CI

`.github/workflows/ci.yml` runs on every push and pull request: installs dependencies, then runs `npm run lint` and `npm run build` for both workspaces. It does not run the Docker stack.
