# Running the project

Everything runs in Docker. You need Docker Desktop running and nothing else —
Node is only needed if you want to run tests or scripts outside the containers.

## Start

```bash
docker compose up -d
```

That starts three containers: `client` (Vite dev server), `server` (Express +
ts-node-dev) and `db` (PostgreSQL 16). First run also builds the images, which
takes a couple of minutes; later runs are seconds.

| What  | Where                       |
| ----- | --------------------------- |
| Site  | http://localhost:5173       |
| Admin | http://localhost:5173/admin |
| API   | http://localhost:4000/api   |

Check it came up:

```bash
docker compose ps
```

All three should show `Up` under STATUS, and `db` should say `Up ... (healthy)`.

## Stop

```bash
docker compose down
```

Your data survives — it lives in Docker volumes, not in the containers.

To stop without removing the containers:

```bash
docker compose stop
```

## First time only

Create the database tables:

```bash
docker compose exec server npx prisma migrate deploy
```

Then set an admin password and restart the server so it picks it up:

```bash
npm run admin:set-password -w server -- 'your password'
```

```bash
docker compose up -d server
```

There is no sample data. Open `/admin` and add your own.

---

## Everyday tasks

### See what the server is doing

```bash
docker compose logs -f server
```

`Ctrl-C` stops following. Swap `server` for `client` or `db`.

### After changing the Prisma schema

Create and apply a migration:

```bash
docker compose exec server npx prisma migrate dev --name describe_the_change
```

Then restart the server so it regenerates its client:

```bash
docker compose up -d server
```

> The generated Prisma client lives inside the container's `node_modules`, not
> in your checkout. Skipping the restart leaves the server querying columns
> that no longer exist, and every request 500s.

### After installing a new npm package

```bash
docker compose up -d --build -V server
```

`-V` is the important part: it replaces the container's `node_modules` volume.
Without it the container keeps the old dependency set and crashes with
"Cannot find module".

### Change the admin password

```bash
npm run admin:set-password -w server -- 'new password'
```

```bash
docker compose up -d server
```

Anyone already signed in **stays** signed in — sessions are independent of the
password. To sign everyone out too:

```bash
docker compose exec db psql -U vinyl_lib -c "DELETE FROM session;"
```

### Run the tests

```bash
npm test
```

Needs a separate test database, created once:

```bash
docker compose exec db createdb -U vinyl_lib vinyl_lib_test
```

```bash
npm run test:db:setup -w server
```

Tests truncate between cases, so this must never point at the development
database. Requires Node 24 on your machine (`.nvmrc` pins it).

### Production mode

```bash
npm run prod
```

Builds optimised images: the client is compiled and served by nginx, the server
runs compiled JavaScript. Only the site port is published — Postgres and the
API are reachable only inside the Docker network.

---

## When something is wrong

### The site loads but every section says it could not load

The server is down or erroring:

```bash
docker compose logs --tail 50 server
```

### `Cannot find module '<something>'`

A dependency was installed on the host but not in the container:

```bash
docker compose up -d --build -V server
```

### `The column ... does not exist in the current database`

The migration ran but the container's Prisma client is stale:

```bash
docker compose up -d server
```

### Login says "Invalid credentials" and you are sure the password is right

The hash in `.env` did not reach the container. Check it arrived intact:

```bash
docker compose exec server printenv ADMIN_PASSWORD_HASH
```

It should be exactly 60 characters starting `$2b$12$`. If it is empty or
mangled, set it again with `admin:set-password`, which handles the escaping
Compose needs.

### Port already in use

Something else is on 5173, 4000 or 5432. Change `CLIENT_PORT`, `SERVER_PORT` or
`POSTGRES_PORT` in `.env`, then `docker compose up -d`.

### Start completely fresh

**This deletes your collection.**

```bash
docker compose down -v
```

```bash
docker compose up -d
```

```bash
docker compose exec server npx prisma migrate deploy
```

---

## Backing up your collection

The data is in a Docker volume. To take a copy:

```bash
docker compose exec db pg_dump -U vinyl_lib vinyl_lib > backup.sql
```

To restore it:

```bash
cat backup.sql | docker compose exec -T db psql -U vinyl_lib vinyl_lib
```

Uploaded cover images live in a separate `uploads` volume and are **not** in
that dump. To copy them out:

```bash
docker compose cp server:/app/server/uploads ./uploads-backup
```
