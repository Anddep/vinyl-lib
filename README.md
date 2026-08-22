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
- [Node.js](https://nodejs.org/) 20+ (only needed to run `npm install` locally for editor tooling, linting, and Git hooks — not required to run the app itself)

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

The starter schema (`server/prisma/schema.prisma`) defines a single `Record` model (a vinyl record: title, artist, year) with an initial migration already committed under `server/prisma/migrations/`.

## Admin panel

The site's content lives in Postgres and is edited at `/admin`. One collector,
one password — there is no signup and no user table.

### First-time setup

Set the password. This hashes it and writes it into `.env` for you:

```bash
npm run admin:set-password -w server -- 'your password here'
```

Then add a session secret:

```bash
openssl rand -hex 32
```

```
SESSION_SECRET=<the hex string>
```

Restart the server afterwards — the hash is read once at startup:

```bash
docker compose up -d server
```

> Use hex rather than base64 for the secret. Docker Compose interpolates `$` in
> `.env` values, so a `$` in a secret arrives at the container mangled.
> `admin:set-password` handles this for the hash by doubling the `$`;
> `admin:hash` only prints a hash, and you must double the `$` yourself.

### Changing the password later

Same command. Note that **existing sessions stay signed in** — they live in a
`session` table in Postgres, independent of the password. To sign everyone out
as well:

```bash
docker compose exec db psql -U vinyl_lib -c "DELETE FROM session;"
```

### First boot

With the stack running, create the schema:

```bash
docker compose exec server npx prisma migrate deploy
```

Then open `http://localhost:5173/admin` and add your collection. There is no
seed command: sample data only exists as a test fixture, so nothing can write
over content you have curated.

### What you can edit

| Screen       | Controls                                                                       |
| ------------ | ------------------------------------------------------------------------------ |
| Records      | Every field on a record, including the URL its card links to and its cover art |
| Wishlist     | The Looking For section, with cover art                                        |
| Setup        | The equipment rows in What it all plays on                                     |
| Site content | Hero and setup copy and imagery, and Collecting since                          |

Three of the four stat cards are **computed** from the records table — total,
top genre and top artist — so they cannot drift from the data. "Collecting
since" is a stored setting: the earliest `addedAt` is when a record was entered
here, not when the collection started.

Hero and setup copy and imagery are editable under Site content. Leave a field
empty and the original design wording is used instead.

The genre filter on the homepage is built from the genres actually in the
collection, so a genre you invent on a record appears as a chip with no code
change, and one no record uses stops offering an always-empty filter.

Record cards link out to whatever URL you set (Discogs, Bandcamp, anywhere).
A record with no URL renders as a non-interactive card. Covers can be uploaded
or pasted as a URL; with neither, the striped placeholder from the design shows.

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

## CI

`.github/workflows/ci.yml` runs on every push and pull request: installs dependencies, then runs `npm run lint` and `npm run build` for both workspaces. It does not run the Docker stack.
