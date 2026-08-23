# Public Deployment — Design

**Date:** 2026-08-23
**Status:** Draft — awaiting approval
**Repo:** `Anddep/vinyl-lib`

## 1. Context

The application runs on one laptop. `docker compose up` brings up three containers, the
site answers on `http://localhost:5173`, and the only person who can reach it is the person
holding the keyboard. Every design decision to date has been able to assume that.

The multiuser work already assumed the opposite. Its spec opens by saying the deployment is
"reachable from the open internet" and builds a signup gate, per-account ceilings, per-IP
rate limits and a suspension recipe on that assumption. Those defences exist and are
untested against the thing they defend against, because the thing has never happened. This
design is the other half: it makes the assumption true.

What that means concretely. The site becomes a host that strangers can reach, that holds an
OAuth client secret for two providers, that accepts file uploads, that runs a database
holding the only copy of a collection, and that must keep a TLS certificate valid without
anyone remembering to renew it. It must do all of that on infrastructure that costs
nothing, and it must update itself when `main` moves, because a deployment that needs a
human to remember a command is a deployment that drifts.

### Goals

- The site is reachable at a stable public HTTPS origin with a certificate that renews
  unattended.
- A push to `main` reaches production with no human action, and a bad one rolls itself back.
- Images are built once, in CI, and deployed by immutable digest — the box never compiles.
- The host survives being publicly addressed: no port open that does not need to be, no
  password authentication, automatic security patching, and logs that cannot fill the disk.
- Every secret lives in exactly one place, and that place is neither the repository nor an
  image layer.
- Nothing in the repository knows it is running on Oracle. The same artifacts deploy to any
  Ubuntu box with an SSH port.
- The whole thing costs nothing per month.

### Non-goals

- **Backups.** Explicitly out of scope by the operator's decision. §11 states what that
  costs and what remains.
- High availability, multiple replicas, or any load balancing. §3.5 explains why a second
  replica is not merely unnecessary but incorrect.
- A CDN, an edge cache, or Cloudflare in front. Caddy talks to the internet directly.
- Staging, preview environments, or per-branch deployments. One environment, called
  production, is the whole set.
- Monitoring, alerting, uptime checks, log shipping or metrics. The deploy's health poll is
  the only automated observation, and it observes exactly one moment.
- Infrastructure as code. The VM is provisioned by hand once, from a runbook. Terraform for
  a single instance is more state to lose than it saves.
- Zero-downtime deployment. `docker compose up -d` restarts the changed containers; the site
  is unavailable for a few seconds. For a personal collection that is not a defect.
- Any change to what the application does. This design adds no feature and removes none.

## 2. Approach

One small Ubuntu VM, running the same `docker compose` topology it runs locally, with a TLS
terminator added in front and the images supplied by a registry instead of a build context.

The load-bearing idea is that **the unit of deployment stays `docker compose`**. The stack
is three containers, a database volume and an uploads volume that must stay adjacent to each
other; every deployment target that is not a VM asks for that shape to be dismantled. Keeping
compose means the topology that runs in production is reviewable as one file, is the same
shape that runs on the laptop, and is portable to any host that can run Docker.

The second idea is that **the box never builds**. It has two cores and it is running a
database. `npm install` on it competes with Postgres for memory at exactly the moment a
person is looking at the site. CI has four times the CPU and no users, so CI builds, pushes
to a registry, and the box pulls a finished artifact by digest.

The third is that **the deployment identity can only deploy**. The pipeline authenticates to
the box with an SSH key that is restricted to a forced command. It cannot open a shell, it
cannot forward a port, and it cannot run an arbitrary `docker` invocation. §8.4 explains why
that restriction is doing more work here than the `from=` restriction it replaces.

### 2.1 Rejected alternatives

**A free PaaS — Render, Railway, Fly.io, Koyeb.** The obvious answer and the wrong one, for
reasons that are specific rather than aesthetic. Render's free Postgres is deleted after 30
days. Railway's free tier became a one-off trial credit. Fly.io requires a card and bills
volumes. All of them want each container declared as a separate service with its own
configuration, so `docker-compose.yml` stops being the description of the system and
becomes a thing that only exists on the laptop — which is precisely the drift this design
is trying to prevent. And a free PaaS instance that sleeps turns the first request after a
quiet hour into a thirty-second wait.

**Kamal.** Purpose-built for this exact shape: build elsewhere, push to a registry, deploy
containers to a VM by SSH, with health checks and rollback already written. Genuinely a good
fit, and rejected for one reason: it replaces `docker-compose.yml` with `deploy.yml` and its
own accessory model, so the laptop and the server stop describing the system the same way.
Kamal also brings its own `kamal-proxy`, which would displace the Caddy decision below. The
whole benefit here is machinery this design writes by hand in about 150 lines of shell — and
those 150 lines are readable at 2am by someone who has never read Kamal's documentation.

**Traefik instead of Caddy.** Traefik discovers routes from container labels, which is
elegant when there are twenty services and noise when there are two. Its TLS configuration
is more surface than Caddy's `automatic`. Caddy's whole config for this site is a dozen
lines and every one of them is legible.

**Cloudflare Tunnel, no public IP at all.** Attractive: no inbound ports, no firewall
question, TLS handled upstream, and the origin unreachable except through the tunnel. It
also puts a third party in the request path for a site whose entire content is public
anyway, makes the real client IP depend on `CF-Connecting-IP` rather than a proxy chain this
design controls, and moves the certificate out of the operator's hands. Rejected as a
dependency that buys defence the firewall already provides.

**nginx or Certbot for TLS.** Certbot renewal is a cron job that fails silently and is
discovered when the certificate expires. Caddy renews as a consequence of running, and a
renewal failure is a log line in a container that is being watched anyway.

**Dropping the client nginx and letting Caddy serve the static files.** One fewer container
and one fewer proxy hop. Rejected because the client image would stop being self-contained —
`try_files $uri $uri/ /index.html` and the `/api` and `/uploads` proxying would move out of
the image and into host configuration, so what CI builds would no longer be the whole client.
Keeping nginx means `npm run prod` on the laptop exercises the same routing production does.

**Building on the server.** Removes the registry, the digest pinning and two workflows. Also
means a deploy takes ten minutes of contended CPU, that a `main` which does not compile
takes the site down rather than failing in CI, and that the box needs the source, a
toolchain, and a checkout of the source. Rejected on all four counts.

**Docker Swarm or k3s.** A scheduler for one node is a scheduler that can only fail.

## 3. Topology

### 3.1 The four services

```
                     internet
                         │
                    :80  │  :443
                         ▼
                  ┌─────────────┐
                  │    caddy    │  TLS, HSTS, CSP, HTTP→HTTPS
                  └──────┬──────┘
                         │ app-network
                  ┌──────▼──────┐
                  │   client    │  nginx: static assets,
                  └──────┬──────┘  /api/* and /uploads/* proxied
                         │
                  ┌──────▼──────┐
                  │   server    │  express, uploads volume
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │     db      │  postgres 16, db-data volume
                  └─────────────┘
```

`caddy` is the only service that publishes a host port. `client`, `server` and `db` are
reachable only on the `app-network` bridge. This is a change from `docker-compose.prod.yml`,
where `client` publishes `${CLIENT_PORT}:80`; that publication is removed.

| Service  | Image                                    | Published | Volumes                                        |
| -------- | ---------------------------------------- | --------- | ---------------------------------------------- |
| `caddy`  | `caddy:2-alpine`                         | 80, 443   | `caddy-data`, `caddy-config`, `Caddyfile` (ro) |
| `client` | `ghcr.io/anddep/vinyl-lib-client@sha256` | none      | —                                              |
| `server` | `ghcr.io/anddep/vinyl-lib-server@sha256` | none      | `uploads`                                      |
| `db`     | `postgres:16-alpine`                     | none      | `db-data`                                      |

`caddy-data` holds the issued certificates and the ACME account key. It is a named volume
rather than a bind mount because losing it means re-issuing, and Let's Encrypt permits five
duplicate certificates per week — enough to be recoverable, not enough to be careless with.

### 3.2 Container hardening

Applied to every service:

- `restart: unless-stopped` — survives a reboot, respects a deliberate `stop`.
- `security_opt: ["no-new-privileges:true"]` — a setuid binary inside the container cannot
  gain privileges the container did not start with.
- `cap_drop: [ALL]`, with the minimum added back per service.
- `read_only: true`, with `tmpfs` for the paths that genuinely need to be written.
- A memory limit, so one leaking container cannot take the database down with it.

The capability sets are not uniform, because the images are not:

| Service  | `cap_add`                                                | Why                                                                                             |
| -------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `caddy`  | `NET_BIND_SERVICE`                                       | Binds 80 and 443, which are privileged ports                                                    |
| `client` | `CHOWN`, `SETGID`, `SETUID`                              | nginx starts as root and drops its workers to the `nginx` user                                  |
| `server` | none                                                     | The image is changed to run as `USER node`; nothing needs a capability                          |
| `db`     | `CHOWN`, `DAC_READ_SEARCH`, `FOWNER`, `SETGID`, `SETUID` | The postgres entrypoint fixes ownership of the data directory and then `su-exec`s to `postgres` |

`read_only: true` is the setting most likely to fight back, because each image writes
somewhere. The tmpfs mounts are: `client` needs `/var/cache/nginx`, `/var/run` and `/tmp`
(the `nginx` image's entrypoint renders `default.conf.template` into `/etc/nginx/conf.d`, so
that needs to be writable too); `server` needs `/tmp`; `db` needs `/var/run/postgresql` and
`/tmp`; `caddy` needs `/tmp`. Named volumes are writable regardless of `read_only`, which is
why `uploads` and `db-data` still work.

Memory limits: `db` 2g, `server` 1g, `client` 256m, `caddy` 256m. On a 12 GB box these are
not about scarcity. They are about a runaway process being contained rather than shared.

### 3.3 Volumes and the data that matters

Two volumes hold everything irreplaceable:

- `db-data` — records, wishlist, setup rows, site settings, users, OAuth identities, invites
  and sessions.
- `uploads` — every cover image the owner uploaded rather than linked.

They are separate, and this is the trap that `RUNNING.md` already warns about: a `pg_dump`
captures the first and nothing of the second. Since §11 removes backups entirely the warning
has nowhere to be actionable, but it stays true and it stays stated, because the pre-migration
dump in §8.5 has the same blind spot and someone reading it at 2am needs to know.

### 3.4 Host portability

Nothing in the repository names Oracle. `bootstrap.sh` requires Ubuntu 24.04 and root, and
that is the entire host contract. The deploy pipeline needs an SSH host, a user, a key and a
known-hosts entry, all of which are GitHub Environment secrets.

The concrete consequence: if A1 capacity in `eu-frankfurt-1` is unavailable — which it
frequently is — the same artifacts deploy to a Hetzner CAX11 (arm64, €4/mo) by changing
`SSH_HOST`, re-running `bootstrap.sh`, and pointing the DNS record at the new address. No
file in this repository changes. The one Oracle-specific paragraph in the whole design is
§7.3, which handles a quirk of Oracle's Ubuntu image, and it is written to be a no-op
anywhere else.

### 3.5 One replica, and why that is a constraint rather than a default

`server/src/lib/limiters.ts` uses `express-rate-limit`'s default memory store. The counters
live in the process. Two replicas means two independent sets of counters and every published
limit becomes twice as permissive, silently — the endpoints still answer, the limits still
appear in the response headers, and nothing indicates the limit is not the limit.

Sessions are safe across replicas (they are in Postgres, via `connect-pg-simple`) and
uploads are safe (a shared volume). Rate limits are not. **The application runs as exactly
one `server` replica until `express-rate-limit` is given a shared store**, and the compose
file does not have a `deploy.replicas` key to make the mistake convenient.

## 4. Images

### 4.1 Built in CI, on ARM, for ARM

Both images are built on GitHub's `ubuntu-24.04-arm` runners and target `linux/arm64` only.
Native, not emulated: a QEMU cross-build of a Vite build plus `tsc` plus `prisma generate`
takes upwards of fifteen minutes for no benefit, now that a public repository gets four ARM
vCPUs for nothing.

There is no `linux/amd64` variant. The only machine that runs these images is the VM, and it
is ARM. Building both doubles the CI time and the registry footprint to serve nobody. If the
host ever moves to x86, one line in `build.yml` changes.

### 4.2 `npm ci`, and a production install that is actually production

Both Dockerfiles run `npm install` today. Two consequences, both fixed here.

First, `npm install` is free to resolve a version that `package-lock.json` does not name. A
build is therefore not reproducible against the lockfile, which makes the digest of an image
a weaker statement than it looks. `npm ci` in the deps stage fixes it and fails loudly if the
lockfile and the manifests disagree.

Second, and worse, `server/Dockerfile`'s prod stage copies `/app/node_modules` wholesale from
the build stage. That tree contains typescript, vitest, supertest, eslint, prettier,
ts-node-dev, ts-node and every `@types/*` package — all of it shipped to production, all of
it inside the container that is exposed to the internet. The fix is a separate stage that
runs `npm ci --omit=dev` and a final stage that copies only that.

The one complication is Prisma. `prisma generate` writes the generated client into
`node_modules/.prisma/client`, and a pruned install has no `.prisma` because generation never
ran there. So the pruned tree gets `.prisma/client` copied across from the build stage.
`@prisma/client` itself is a real dependency and survives the prune on its own.

The second complication is that `prisma migrate deploy` is the `prisma` CLI, and the CLI is a
devDependency. §8.5 runs migrations from the server image, so the CLI has to be present.
**`prisma` moves from `devDependencies` to `dependencies`.**

The alternative was a third image containing schema, migrations and the CLI — a `migrate`
target built from the same Dockerfile. It is arguably cleaner and it was rejected because it
is a third image to build, push, tag, pin by digest, roll back and reason about, in exchange
for perhaps forty megabytes. Moving one package is the smaller change and the prune still
removes the great majority of what was being shipped.

### 4.3 arm64 and the Prisma query engine

`server/prisma/schema.prisma` declares no `binaryTargets`, so `prisma generate` produces the
engine for whichever platform generated it. The build now happens on ARM, in an Alpine image,
against OpenSSL 3 — a combination Prisma calls `linux-musl-arm64-openssl-3.0.x`. Getting this
wrong does not fail the build and does not fail the container's start. It fails on the first
query, which means the deploy's health poll is what catches it, at the point where the site
is already down.

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-arm64-openssl-3.0.x"]
}
```

`native` stays so that generating on the laptop still works. The verification for this is
deliberately not "read the config": it is to run the built arm64 image against a database
and watch `/api/health` answer `db: connected`, because that response is the first thing
that actually loads the engine.

### 4.4 Digests, not tags

CI pushes each image with two tags — `sha-<commit>` and, on `main`, `latest` — and outputs
the digest. The deployment pins `@sha256:…`.

A tag is a pointer and pointers move. `sha-abc123` is stable by convention and by nothing
else; anyone with push access can move it, and a compromised registry can move it silently.
A digest is the content. Pinning by digest also gives rollback its meaning: the previous
digest recorded on the box is not "whatever `latest` pointed at yesterday", it is the exact
image that was serving traffic.

The box keeps two files:

- `/opt/vinyl-lib/.images` — the digests currently deployed, sourced by compose.
- `/opt/vinyl-lib/.images.prev` — the digests deployed before the current ones.

`.images.prev` is written at the start of a deploy, before anything is pulled, and is what
the automatic rollback in §10 reads.

## 5. The edge

### 5.1 What Caddy does and does not do

Caddy terminates TLS, redirects HTTP to HTTPS, sets the security headers, and reverse-proxies
everything else to `client:80`. It does not route by path, it does not serve files, and it
does not know that `/api` is different from `/`. All of that stays in
`client/nginx.conf.template`, where it already is and where it travels with the image.

The site address is a single variable:

```caddyfile
{$SITE_ADDRESS} {
	encode zstd gzip
	...
	reverse_proxy client:80
}
```

`SITE_ADDRESS` comes from the environment. In production it is `vinyl.is-a.dev`. Set to
`localhost`, Caddy issues a certificate from its own internal CA, which makes the entire
production edge — TLS, headers, CSP, proxy chain — testable on the laptop before a VM exists.

### 5.2 TLS

Automatic. Caddy provisions from Let's Encrypt on first request for the configured hostname,
renews at roughly two-thirds of the certificate's lifetime, and stores everything in
`caddy-data`. There is no cron job, no `certbot renew`, and no renewal step in the runbook,
because there is nothing to remember.

The failure mode worth naming: Let's Encrypt permits **five duplicate certificates per week**
for the same set of names. Destroying `caddy-data` five times in a week — by `docker compose
down -v`, or by rebuilding the box repeatedly — exhausts that and the site has no certificate
until the window rolls. The runbook says so where `down -v` appears.

### 5.3 Security headers

Set once, in the Caddyfile:

| Header                      | Value                                                                                                           | Why                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                                                                           | A year, subdomains included                                                    |
| `X-Content-Type-Options`    | `nosniff`                                                                                                       | An uploaded file is never re-interpreted by content sniffing                   |
| `X-Frame-Options`           | `DENY`                                                                                                          | Belt to the CSP's `frame-ancestors` braces, for anything old enough to need it |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                               | A record card links out; the path of the page they left should not travel      |
| `Permissions-Policy`        | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()` | The site uses none of these and should not be able to start                    |
| `-Server`                   | removed                                                                                                         | The version of the proxy is not the visitor's business                         |

**`preload` is deliberately absent from HSTS.** Submitting to the preload list is close to a
one-way door: removal is a request to browser vendors and takes months to propagate. It also
applies to `includeSubDomains` on a hostname under a shared parent. A year of HSTS without
preload is the same protection for every visitor after their first request, and it can be
undone in an afternoon.

### 5.4 Content Security Policy, derived

The policy currently in `client/nginx.conf.template` was written by reasoning about what the
app ought to load. This one is written from what the built output actually loads, which turns
out to be a different thing — see §5.4.2.

#### 5.4.1 What the built client loads

From `client/dist/index.html` after `npm run build -w client`:

- one module script, `/assets/index-*.js`, same origin
- one stylesheet, `/assets/index-*.css`, same origin
- a stylesheet from `https://fonts.googleapis.com` (Geist, Geist Mono, Instrument Serif)
- font files, which that stylesheet pulls from `https://fonts.gstatic.com`
- `/favicon.svg`, same origin
- **no inline `<script>` and no inline `<style>`** — Vite extracts CSS to a file, and route
  chunks add `<link rel="stylesheet">` at runtime rather than injecting `<style>`
- `fetch` to `/api/*`, same origin
- images from `/uploads/*` and from any external `https` URL a collector pastes into `coverUrl`

Two components set an inline `style` **attribute** — `client/src/components/ui/VinylDisc.tsx`
and `client/src/components/ui/ImagePlaceholder.tsx` — both to pass a CSS custom property
through to a stylesheet.

#### 5.4.2 The existing policy blocks the site's own fonts

The policy shipping today is:

```
default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline';
script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';
form-action 'self'
```

`style-src` does not list `https://fonts.googleapis.com`, so the Google Fonts stylesheet is
refused. There is no `font-src` at all, so it falls through to `default-src 'self'` and every
font file from `fonts.gstatic.com` is refused as well. **In production mode today, Geist and
Instrument Serif never load**; the page renders in `system-ui` and Georgia, which are the
fallbacks in `client/src/styles/tokens.css`, and it does so silently — the site looks slightly
wrong and nothing reports why.

This is a real, current bug, found by reading the built output rather than the source. The
new policy fixes it and §14 verifies the fix by loading the page and confirming the console
is clean and the computed `font-family` resolves to Geist.

#### 5.4.3 The policy

```
default-src 'self';
script-src 'self';
style-src 'self' https://fonts.googleapis.com;
style-src-attr 'unsafe-inline';
font-src 'self' https://fonts.gstatic.com;
img-src 'self' https: data:;
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests
```

Three things about it are worth stating rather than leaving to be inferred.

**`style-src` does not carry `'unsafe-inline'`.** The reflexive policy grants it and thereby
permits any injected `<style>` block, which is a real exfiltration primitive. Because the
build emits no inline stylesheet, the only inline styling is the two `style` attributes, and
`style-src-attr 'unsafe-inline'` grants exactly those while leaving `<style>` injection
refused. That is the whole reason for deriving the policy instead of copying one.

**`img-src https:` is wide, on purpose, and it is not new.** `coverUrl` accepts any external
image and always has; `client/nginx.conf.template` already documents the accepted cost — a
collection owner can point a cover at a server they control and learn the IP of everyone who
views their page. Narrowing it means proxying every external image, which trades that for an
SSRF surface. The existing trade stands.

**It lives in the Caddyfile, and is removed from nginx.** One definition, one place to change
it. Two definitions would be enforced as their intersection, which is the kind of thing that
is discovered by a feature not working six months later. The trade-off accepted: `npm run
prod` on the laptop, which does not run Caddy, serves no CSP at all — so CSP verification
happens against the deploy compose file with `SITE_ADDRESS=localhost`, which is a better test
anyway because it exercises the real edge.

A Caddy request matcher keeps the header off `/api/*`, where `helmet()` in
`server/src/app.ts` already sets its own and two policies would be pointlessly intersected.

### 5.5 Proxy hops, and the cookie that silently never arrives

`server/src/app.ts` sets `app.set('trust proxy', 1)`. That was correct when nginx was the
only proxy. It is wrong once Caddy is in front, and wrong in two ways that both fail quietly.

The chain becomes: client → Caddy → nginx → Express. Caddy sets `X-Forwarded-For: <client>`;
nginx appends with `$proxy_add_x_forwarded_for`, making it `<client>, <caddy>`; Express sees
a socket address of `<nginx>`. With `trust proxy` at 1, Express trusts one hop and concludes
`req.ip` is `<caddy>` — the Docker bridge address of a container.

**Consequence one:** every per-IP limiter in `server/src/lib/limiters.ts` keys on that single
address. The OAuth start limiter, the callback limiter, the write limiter, the public read
limiter and the upload limiter all become one shared bucket for the entire internet. They do
not error; they just stop being per-IP, and the `RateLimit-*` headers keep claiming otherwise.

**Consequence two:** `req.protocol` is wrong, and `secure: true` on the session cookie means
the cookie is never sent. Sign-in fails with no error anywhere — the OAuth round trip
completes, the session is written, and the browser was never given the cookie to send back.

Both are fixed by trusting two hops. It is set as **`TRUST_PROXY_HOPS`, an integer defaulting
to `1`**, rather than hardcoded to `2`, because `docker-compose.prod.yml` on the laptop still
has exactly one proxy and hardcoding either number breaks one of the two environments. It is
a count and not `true`: `trust proxy: true` makes Express believe the leftmost
`X-Forwarded-For` entry unconditionally, and that entry is a header the client can write,
which hands any visitor the ability to forge their own address and defeat the limiters
they are being limited by.

Per the landmine this codebase already documents, `TRUST_PROXY_HOPS` must be added to the
`environment:` list of `docker-compose.yml`, `docker-compose.override.yml` **and**
`docker-compose.deploy.yml` — the base list is replaced by the override, not merged with it,
and a variable in `.env` that no compose file names never reaches the container at all.

## 6. Secrets

### 6.1 Every secret, and the one place each lives

| Secret                               | Lives in                                          | Reaches production by                          | Rotation                                     |
| ------------------------------------ | ------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `SESSION_SECRET`                     | `/opt/vinyl-lib/.env` on the box, mode 0600       | Read by compose at `up`                        | §6.4                                         |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | same                                              | same                                           | Requires a database password change; §6.4    |
| `GOOGLE_CLIENT_SECRET`               | same                                              | same                                           | Regenerate at Google, edit `.env`, `up -d`   |
| `GITHUB_CLIENT_SECRET`               | same                                              | same                                           | Regenerate at GitHub, edit `.env`, `up -d`   |
| `BOOTSTRAP_OWNER_EMAIL`              | same                                              | same                                           | Not a secret; set once, before first sign-in |
| SSH deploy private key               | GitHub Environment `production`, secret `SSH_KEY` | Written to a runner temp file, used, discarded | §6.4                                         |
| SSH deploy public key                | `~deploy/.ssh/authorized_keys` on the box         | Installed by hand once                         | §6.4                                         |
| `SSH_KNOWN_HOSTS`                    | GitHub Environment `production`                   | Pinned host key, written to the runner         | Changes only if the box is rebuilt           |
| GHCR push credential                 | none — `GITHUB_TOKEN`, minted per run             | Automatic                                      | Automatic                                    |

The application `.env` **never** enters GitHub. There is no workflow step that writes it, no
secret containing it, and no path by which the pipeline could read it. The deploy changes
image digests and nothing else; configuration is the operator's, held on the box, and a
compromise of the GitHub account does not disclose the OAuth client secrets.

That is a deliberate asymmetry and it has a cost: changing a configuration value is an SSH
session and a manual `docker compose up -d`, not a commit. For a value that changes twice a
year, holding the secrets out of the CI system is worth more than the convenience.

### 6.2 What must never appear in the repository or an image

- Anything in the table above.
- The `.env` file. `.gitignore` excludes it and `.dockerignore` excludes it from every build
  context, so it cannot be baked into a layer even accidentally.
- The public hostname is **not** in this category. It is public by definition, appears in
  DNS, and is a Caddy site address and a `PUBLIC_BASE_URL`. It is a GitHub Environment
  _variable_, not a secret, because marking a public value secret only produces `***` in
  logs where the hostname would have helped debugging.

Proof rather than assertion: `gitleaks` runs over the full history on every CI run, and §14
requires a search of the built image layers before the work is called done.

With the repository public, **GitHub secret scanning with push protection is enabled** — free
for public repositories. It refuses a `git push` that contains a recognised credential
format, which moves the defence from "detected afterwards" to "never landed". `DEPLOYMENT.md`
carries the click-path to turn it on.

### 6.3 Generated at setup, never by CI

Three values are generated once by the operator, on the laptop, and their halves go to
different places. `DEPLOYMENT.md` gives the exact commands.

```bash
openssl rand -hex 32                              # SESSION_SECRET  → the box's .env only
openssl rand -base64 24 | tr -d '/+=' | head -c 32  # POSTGRES_PASSWORD → the box's .env only
ssh-keygen -t ed25519 -C 'github-actions-deploy' -f ~/.ssh/vinyl-deploy -N ''
#   ~/.ssh/vinyl-deploy      (private) → GitHub Environment secret SSH_KEY, then delete locally
#   ~/.ssh/vinyl-deploy.pub  (public)  → ~deploy/.ssh/authorized_keys on the box, with §8.4's restrictions
```

Hex for `SESSION_SECRET`, not base64, for a reason `.env.example` already records: base64
can contain `$`, and Compose interpolates `$` in an env file. A secret that silently loses
its tail is worse than one that is obviously wrong.

### 6.4 Rotation

**Session secret.** Edit `.env`, `docker compose up -d server`. Every existing session cookie
fails its signature check and everyone is signed out, which is the intended effect and the
reason to do it if a secret is ever suspected. Note `up -d`, never `restart`: Compose reuses
the old environment on `restart` and the rotation would appear to do nothing.

**Deploy key.** Generate a new pair, append the new public half to `authorized_keys` with the
same restrictions, update the `SSH_KEY` secret, run a `workflow_dispatch` deploy to prove the
new key works, and only then remove the old line. In that order — removing first and testing
after is how a deploy pipeline locks itself out of its own server.

**Database password.** `ALTER USER … WITH PASSWORD`, then `.env`, then `up -d`. Both, in that
order; the running server holds a connection pool that survives the `ALTER` and would
otherwise mask the mistake until the next restart.

**OAuth client secrets.** Regenerate at the provider, edit `.env`, `up -d`. Both providers
allow a new secret before the old is revoked, so there is no outage window if done in that
order.

## 7. Host hardening

All of this is `deploy/bootstrap.sh`: idempotent, safe to re-run, every step commented with
why it is there rather than what it does. Re-runnable matters more than it sounds — the
script is how the box is rebuilt after a reclaim, and a script that only works on a pristine
system is a script that is never trusted enough to run twice.

### 7.1 SSH

A drop-in at `/etc/ssh/sshd_config.d/99-hardening.conf`, not an edit to the main file, so a
distribution upgrade cannot silently revert it:

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
AllowUsers deploy ubuntu
```

The script **refuses to apply this unless `~deploy/.ssh/authorized_keys` already contains at
least one key**, and runs `sshd -t` before reloading. Disabling password authentication on a
box with no working key installed is the single most common way to permanently lose a server,
and it is entirely preventable with two checks.

### 7.2 The firewall, and Docker publishing straight past it

UFW: default deny inbound, allow 22, 80 and 443, allow all outbound.

That is necessary and **not sufficient**, and the reason is the sharpest edge in this design.
Docker does not go through UFW's chains. It writes its own `iptables` rules in the `nat` and
`filter` tables, and `DOCKER` rules are evaluated before UFW's. A container published as
`0.0.0.0:5432->5432` is reachable from the internet with a UFW `deny 5432` sitting right
there, looking like it is working. Anyone who has checked `ufw status` and concluded the box
is closed has met this.

Two independent defences, both applied:

**Publish nothing.** `docker-compose.deploy.yml` publishes only Caddy's 80 and 443. `db` and
`server` publish no host port at all, so there is nothing for Docker to open. This alone is
sufficient today.

**Guard the `DOCKER-USER` chain.** Because "sufficient today" depends on nobody ever adding a
`ports:` line for debugging and forgetting it. Docker consults `DOCKER-USER` before its own
rules and never modifies it, which makes it the correct place for a policy that outlives a
`docker-compose.yml` edit:

```
# Established flows first, or every reply packet is dropped.
-I DOCKER-USER -i $EXT_IF -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
-I DOCKER-USER -i $EXT_IF -p tcp -m multiport --dports 80,443 -j RETURN
-A DOCKER-USER -i $EXT_IF -j DROP
```

Rule order is the whole thing here, so `bootstrap.sh` does not append incrementally — it
flushes a dedicated chain and rebuilds it, which is what makes re-running safe. `$EXT_IF` is
detected from the default route rather than hardcoded to `ens3` or `eth0`, because that name
differs between Oracle's images and Hetzner's.

### 7.3 The rules Oracle's image ships

The only Oracle-specific paragraph in this design.

Oracle's Ubuntu images arrive with a populated `netfilter-persistent` ruleset whose `INPUT`
chain ends in a `REJECT`, permitting little beyond 22. It sits ahead of anything UFW adds.
The symptom is unmistakable once seen and baffling before: `curl localhost` on the box works
perfectly, `curl` from anywhere else hangs, and `ufw status` shows 80 and 443 allowed.

`bootstrap.sh` clears that ruleset and lets UFW own `INPUT`. On any host that does not have
it — Hetzner, a plain Ubuntu install — the step finds nothing and does nothing.

There is a **third** filter above both, outside the box entirely: the OCI VCN security list
or network security group, at the tenancy level. It is not something a script on the host can
touch. `DEPLOYMENT.md` carries the console click-path, and states the diagnostic plainly —
if `curl` works on the box and hangs from outside, and the host firewall is open, it is the
security list, not the application.

### 7.4 Patching and brute force

**`unattended-upgrades`**, restricted to the security origins, with
`Unattended-Upgrade::Automatic-Reboot "true"` and `Automatic-Reboot-Time "04:30"` against a
box set to `Europe/Kyiv`. Automatic reboot is enabled deliberately: a kernel update that is
downloaded but never activated is a patch that has not been applied, and every container
carries `restart: unless-stopped`, so the stack returns without help. The cost is a few
seconds of downtime at 4:30am on the occasional night.

**`fail2ban`** on `sshd`, `backend = systemd`, 5 retries, one-hour ban. Password
authentication is off, so this is not stopping a credential guess — it is stopping the
constant background noise of the internet from filling the journal and consuming the CPU of
a two-core box.

### 7.5 The Docker daemon

`/etc/docker/daemon.json`:

```json
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

`live-restore` keeps containers running while the daemon itself restarts, which turns a
Docker package upgrade from an outage into a non-event.

Log rotation is not housekeeping, it is a data-integrity control. `morgan('combined')` writes
a line per request, the default `json-file` driver has **no rotation whatsoever**, and the
boot volume is shared with `db-data`. An unrotated log grows until the disk is full, and a
full disk does not stop nginx — it stops Postgres from writing, mid-transaction. 30 MB per
container is the ceiling.

### 7.6 Swap

Neither OCI's nor Hetzner's images configure swap. A 4 GB file at `vm.swappiness=10`.

The reason is not the build, because nothing builds here. It is Postgres. Under a burst of
concurrent requests Postgres allocates work memory per connection, and on a box with no swap
the kernel's response to exhaustion is the OOM killer, which reliably chooses the largest
process — Postgres. Swap converts a kill into a slowdown. `swappiness=10` keeps it as the
emergency it is rather than something the kernel reaches for casually.

## 8. CI/CD

Three workflows in a chain, plus CodeQL on its own schedule. Each stage gates the next, so a
failing test cannot produce an image and a failing image cannot reach the box.

```
push to main ──▶ ci.yml ──success──▶ build.yml ──success──▶ deploy.yml
                    │                    │                      │
              lint, test, build    arm64 → GHCR            ssh, migrate,
              audit, gitleaks      SBOM + provenance       up -d, health poll,
                                   digests out            rollback on failure
```

The chaining uses `workflow_run`, which has one trap worth naming: a `workflow_run`-triggered
job checks out the **default branch** by default, not the commit that triggered it. Every
downstream job therefore checks out `github.event.workflow_run.head_sha` explicitly. Getting
this wrong produces a pipeline that appears to work and deploys the wrong commit whenever two
pushes land close together.

### 8.1 `ci.yml` — extended, not replaced

The existing `lint-and-build` job keeps its Postgres service, its `npm ci`, its lint, its
migrate, its test and its build. Added around it:

- **`permissions: { contents: read }`** at the top level. The default token is
  read/write across the repository; a lint job has no business with either.
- **Third-party actions pinned to a full commit SHA**, with the version in a trailing
  comment. A tag is mutable; `@v4` is a promise from a third party that they will not
  change what it points at. First-party `actions/*` keep their tags.
- **`audit`** — `npm audit --audit-level=high`, its own job.
- **`secrets`** — `gitleaks detect` over full history (`fetch-depth: 0`; the default shallow
  checkout would scan one commit and report clean, which is worse than not running it).

Both new jobs start `continue-on-error: true`. This is an explicit, temporary choice: a
brand-new scanner that blocks `main` on day one teaches everyone to bypass it. They report
for a week, the backlog is triaged, then the flag is removed. `DEPLOYMENT.md` records that
this is a thing to do rather than a thing that was decided forever.

### 8.2 `codeql.yml`

Free now that the repository is public. Runs on push to `main`, on pull requests, and weekly
— the schedule matters because CodeQL's rule packs improve, so the same code is worth
re-scanning against newer queries.

Language matrix: `javascript-typescript`, covering both workspaces. It runs on `ubuntu-latest`
rather than the ARM runner: this analyses source, not artifacts, and the analysis has no
architecture.

CodeQL replaces the Semgrep job that a private repository would have needed. One scanner
whose findings land in the Security tab with dataflow traces beats two that only produce
console output.

### 8.3 `build.yml`

Triggers on `workflow_run` of CI completing successfully on `main`, and on tags. Runs on
`ubuntu-24.04-arm` — four vCPUs now that the repository is public.

```yaml
permissions:
  contents: read
  packages: write # push to GHCR
  id-token: write # provenance attestation
  attestations: write
```

Both images build with `docker/build-push-action`, `platforms: linux/arm64`, `cache-from` and
`cache-to` of `type=gha,mode=max`. Layer caching matters more than usual here because the
`deps` stage is a full `npm ci` of both workspaces, and it is identical between runs until
`package-lock.json` changes.

Tags `sha-<commit>` and `latest`. `sbom: true` and `provenance: mode=max` attach an SBOM and
a signed build attestation to each image in the registry — a record of what went in, from a
build nobody can reach into.

The job's outputs are the two digests. Not the tags: §4.4.

### 8.4 `deploy.yml`, and a deploy identity that can only deploy

Triggers on `workflow_run` of Build succeeding on `main`, and on `workflow_dispatch` with a
`sha` input. That input is the whole rollback interface — dispatching a previously built
commit resolves its digests from the registry and deploys exactly those bytes.

`environment: production` holds the secrets, which also means a deployment appears in the
repository's environment history with the commit that caused it.

The mechanism people usually reach for is an SSH key with a `from=` restriction. **That does
not work here.** GitHub-hosted runners have no stable, narrow address range; the ranges
published at `api.github.com/meta` are enormous and change without notice. A `from=` listing
them would be security theatre with a maintenance burden.

So the restriction is a **forced command**, which is strictly stronger:

```
command="/opt/vinyl-lib/remote-deploy.sh",no-agent-forwarding,no-port-forwarding,
no-pty,no-X11-forwarding,no-user-rc ssh-ed25519 AAAA… github-actions-deploy
```

Whatever the client asks to run, `sshd` runs `remote-deploy.sh` and puts the requested command
in `SSH_ORIGINAL_COMMAND`. The script validates it against a strict pattern —

```
^deploy [0-9a-f]{40} sha256:[0-9a-f]{64} sha256:[0-9a-f]{64}$
```

— and refuses anything else. The topology files travel as a tar on stdin, which a forced
command still receives; the script extracts them to a temp directory, accepts only the two
expected filenames, validates with `docker compose config -q`, and installs them. So the
compose file and Caddyfile remain reviewable in git and ship with the deploy, exactly as
intended, without needing shell access to place them.

**Why this matters more than `from=` would have.** The `deploy` user is in the `docker` group.
Docker group membership is root-equivalent, without qualification: a member can run
`docker run -v /:/host --privileged` and own the machine. There is no way to grant "can
restart containers" without granting that, short of a socket proxy this design judges to be
more moving parts than it is worth. So the blast radius if `SSH_KEY` leaks is defined by what
the key can _invoke_, not by what the user could theoretically do. With a shell, a leaked key
is root on the box. With a forced command, a leaked key can deploy an already-built image
digest and read the script's own output — bad, recoverable, and not root.

This is stated in the threat model as T5 rather than left implicit, because the honest
summary is: the `docker` group is the weakest link in this design, and the forced command is
what keeps it from being reachable.

### 8.5 What a deploy actually does

`remote-deploy.sh`, in order:

1. **Record the current digests** to `.images.prev`, before anything changes.
2. **Install the config tar** from stdin, after validation.
3. **`docker compose pull`** the two new digests. Failing here means a bad digest or a
   registry problem, and nothing has changed yet.
4. **`docker compose up -d db --wait`** — the database must be healthy before a migration.
5. **`pg_dump`** to `/opt/vinyl-lib/pre-migrate/<utc-timestamp>.sql.gz`, keeping the last
   five. §11 explains what this is and is not.
6. **`docker compose run --rm server npx prisma migrate deploy`** — a one-shot container,
   before the new server starts. Never `migrate dev`, which is interactive, can generate a
   migration from a schema diff, and can reset the database.
7. **`docker compose up -d --remove-orphans`** — `up -d`, never `restart`. `restart` reuses
   the container's existing environment, so a changed `.env` or a changed image would appear
   to deploy and change nothing.
8. **Poll `https://<host>/api/health`** until it returns `"status":"ok"`, bounded — roughly
   30 attempts at 2-second intervals. Through the public URL, not `localhost`: that path
   exercises DNS, Caddy, TLS, nginx, Express and Postgres, which is the thing being claimed
   to work.
9. **On failure**, restore `.images.prev`, `up -d` again, re-poll, and exit non-zero so the
   workflow fails visibly.

Migrations run before the new server starts, so the old server briefly runs against a migrated
schema. Prisma migrations here are additive in practice, but this is the constraint that makes
it safe and it is written down in §10.2 rather than assumed.

## 9. Threat model

Each row is a thing that can be done to a publicly reachable host, and what stops it.

| #   | Threat                                              | Mitigation                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Port scan finds Postgres or the API                 | Only Caddy publishes ports; `DOCKER-USER` drops everything else on the external interface; verified by `nmap` from off-host (§14)                                                                                                                                               |
| T2  | SSH brute force                                     | Key-only authentication, no root login, `AllowUsers`, fail2ban                                                                                                                                                                                                                  |
| T3  | Traffic intercepted or downgraded                   | TLS via Let's Encrypt, HTTP→HTTPS redirect, HSTS for a year, `upgrade-insecure-requests`                                                                                                                                                                                        |
| T4  | Session cookie stolen by XSS                        | CSP with no `'unsafe-inline'` on `script-src` or `style-src`, `object-src 'none'`, `base-uri 'self'`; cookie is `HttpOnly` so script cannot read it even given a bug                                                                                                            |
| T5  | **Deploy key leaks**                                | Forced command — deploys, cannot get a shell (§8.4). Key is per-purpose, rotatable in minutes, and used from one place. **This is the sharpest residual risk**: the `deploy` user is in `docker`, which is root-equivalent, so the forced command is the control doing the work |
| T6  | GitHub account compromised                          | Attacker can deploy arbitrary images. They cannot read the OAuth client secrets or the session secret — those exist only on the box and no workflow reads them (§6.1). `environment: production` records every deployment                                                       |
| T7  | Malicious or careless dependency                    | `npm ci` against the lockfile, `npm audit` at high, Dependabot on npm/actions/docker, SBOM per image, CodeQL weekly                                                                                                                                                             |
| T8  | Compromised or moved image tag                      | Deployment is by digest, never by tag (§4.4)                                                                                                                                                                                                                                    |
| T9  | Secret committed                                    | `.gitignore` + `.dockerignore`; gitleaks over full history each run; GitHub push protection refuses the push outright                                                                                                                                                           |
| T10 | Signup flood / spam collections                     | Pre-existing and unchanged: `SIGNUP_MODE=invite`, site-wide signup cap, per-IP limiters — the last of which only became real once §5.5 fixed the proxy count                                                                                                                    |
| T11 | Upload abuse filling the disk                       | Pre-existing per-file and per-account byte quotas, content sniffing, generated filenames. Now also: container memory limits and Docker log rotation, so neither logs nor a runaway process take the volume that Postgres is on                                                  |
| T12 | CSRF                                                | Pre-existing: `SameSite=Lax`, the `sameOrigin` middleware, and no CORS headers anywhere                                                                                                                                                                                         |
| T13 | Malicious `coverUrl` pointing at internal addresses | The browser fetches it, not the server, so there is no SSRF. `safeUrl` restricts the protocol to http/https                                                                                                                                                                     |
| T14 | Log or disk exhaustion takes down the database      | `max-size 10m`, `max-file 3` per container; 4 GB swap so memory pressure degrades rather than OOM-kills Postgres                                                                                                                                                                |
| T15 | Container escape from a compromised process         | `no-new-privileges`, `cap_drop: ALL`, read-only root filesystems, non-root `server`, no host mounts other than a read-only Caddyfile                                                                                                                                            |
| T16 | **Instance reclaimed by Oracle**                    | Accepted, unmitigated. §11                                                                                                                                                                                                                                                      |

### 9.1 What is deliberately not defended against

**A determined attacker with a zero-day in Caddy, nginx, Node or Postgres.** Patching is
automatic and unattended; there is no WAF and no intrusion detection. For a personal
collection behind an invite gate, the cost of those exceeds the loss they prevent.

**Denial of service.** Anyone with a botnet can saturate a 2-core box. The rate limiters slow
a single abusive client; nothing here survives a real flood, and the recovery is that the
attacker gets bored.

**Data loss.** §11.

## 10. Rollback

### 10.1 Automatic, image-level

Every deploy writes `.images.prev` before it changes anything. If the health poll does not
succeed within its bounded window, `remote-deploy.sh` restores those digests, brings the
stack back up, polls again, and exits non-zero.

This covers the failure that actually happens: an image that does not start, a missing
environment variable, a Prisma engine built for the wrong platform, a bad digest. In all of
them the previous image is known-good and still in the local Docker cache, so recovery is
seconds.

Acceptance criterion 2 exercises this on purpose, with a deliberately bad digest.

### 10.2 What it does not cover

**A migration.** `prisma migrate deploy` is forward-only; there is no down migration to run
and Prisma does not generate one. Rolling the image back leaves the previous server running
against a schema from the future.

This is safe when a migration is additive — a new nullable column, a new table, a new index —
because the old server simply does not know about it. It is **not** safe when a migration
drops or renames a column the previous image still selects. Then the rollback restores an
image that 500s on every request, and the automatic re-poll fails too.

The recovery is manual and is written into `DEPLOYMENT.md` as a numbered procedure: restore
the newest `pre-migrate/*.sql.gz`, then deploy the previous SHA. This is the one place in the
design where a human is required, and the design says so rather than implying coverage that
does not exist.

The rule that keeps it theoretical: **a migration that drops or renames anything must be
split across two deploys** — one that stops using the column, one that removes it.

### 10.3 Manual rollback

`workflow_dispatch` on `deploy.yml` with any previously built SHA. The digests are resolved
from GHCR, so any commit that ever produced images can be deployed, not just the last one.

## 11. No backups — the decision and what it costs

**Decided by the operator: no backup machinery.** No `backup.sh`, no `restore.sh`, no systemd
timer, no off-host copy, no scheduled freshness check. This section exists so the consequence
is recorded rather than discovered.

### 11.1 What this means

`db-data` and `uploads` exist in exactly one place: the volumes on one VM. If the VM is lost,
the collection is lost — every record, every wishlist item, every setup row, every uploaded
cover, every account and every invite.

This combines with T16 in a way worth stating directly. Oracle reclaims Always Free instances
that stay idle, the operator has chosen to accept that risk rather than upgrade to Pay As You
Go, and a personal vinyl site is by nature low-traffic. **The most likely way this deployment
ends is Oracle reclaiming an idle instance, and there is no copy of the data.**

### 11.2 What survives anyway

- **The pre-migration dump.** `remote-deploy.sh` writes `pg_dump` output to
  `/opt/vinyl-lib/pre-migrate/` before every migration, keeping five. This is **rollback
  machinery, not a backup**: it lives on the same disk as the database it dumps, it captures
  nothing between deploys, and it does not include `uploads`. It exists so §10.2's manual
  recovery has something to restore. Without it, a bad migration is unrecoverable rather than
  merely inconvenient.
- **`RUNNING.md`'s manual recipes.** `pg_dump` and `docker compose cp` for the uploads volume
  still work, on demand, whenever the operator chooses.
- **The application itself.** Every artifact is in git and every image is in GHCR. Rebuilding
  the host is `bootstrap.sh`, an `.env`, and one `workflow_dispatch`. It is the _data_ that
  has no second copy, not the deployment.

### 11.3 Reversing this

If it is ever wanted, it is small: a `deploy/backup.sh` doing `pg_dump` plus a tar of
`uploads`, `age`-encrypted, on a systemd timer, and a `deploy/pull-backup.sh` run from the
laptop. It needs no third-party account and no credentials on the box. Roughly an hour of
work, noted here so the path back is short.

## 12. What the free tiers actually give

Every figure verified 2026-08-23. Free tiers move; the ones that moved recently moved in the
unfriendly direction.

| Resource                 | What is free                                                     | The catch                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OCI Ampere A1            | 2 OCPU / 12 GB, 200 GB block storage, 10 TB egress/mo            | **Cut from 4 OCPU / 24 GB on 15 Jun 2026**, with no announcement. Instances over the new limit have been terminated since **18 Aug 2026**. Provision at 2/12 |
| OCI idle policy          | —                                                                | Idle Always Free compute is reclaimed. Only real mitigation is upgrading to Pay As You Go, which the operator declined (§11.1)                               |
| OCI A1 capacity          | —                                                                | "Out of capacity" is routine in `eu-frankfurt-1`. Retry, or use the Hetzner fallback (§3.4)                                                                  |
| GitHub Actions           | Unlimited minutes on standard runners for public repositories    | Public repository required — which is now the case                                                                                                           |
| `ubuntu-24.04-arm`       | Free, 4 vCPU / 16 GB on public repositories                      | Would have been 2 vCPU while private                                                                                                                         |
| GHCR                     | Container storage and bandwidth currently free at any visibility | "Currently". GitHub commits to one month's notice before changing it                                                                                         |
| CodeQL + secret scanning | Free for public repositories                                     | Would have needed paid GitHub Code Security while private                                                                                                    |
| Let's Encrypt            | Free certificates, automatic renewal                             | 5 duplicate certificates per week. Destroying `caddy-data` repeatedly is how that limit is met                                                               |
| is-a.dev                 | Free subdomain                                                   | Registered by a pull request the operator opens **by hand** — the maintainers reject AI-generated pull requests                                              |

**Total recurring cost: nothing.** The failure modes are availability and reclamation, not
billing. Nothing in this design can generate a charge, because nothing in it provisions a
resource outside an Always Free allowance.

## 13. What the operator does by hand

Four things cannot be automated from here, and the design stops cleanly at each boundary
rather than guessing. `DEPLOYMENT.md` carries the exact values and the click-path for all
four.

1. **Create the OCI account and provision the instance.** Card required for identity
   verification; not charged on Always Free. Ubuntu 24.04, `VM.Standard.A1.Flex` at 2 OCPU /
   12 GB, `eu-frankfurt-1`. Then open 80 and 443 in the VCN security list (§7.3).
2. **Open the `is-a.dev` pull request.** By hand, explicitly. The design supplies the record
   values; it does not open the PR.
3. **Register the OAuth callbacks** at Google and GitHub:
   `https://vinyl.is-a.dev/api/auth/google/callback` and `…/github/callback`.
4. **Create the GitHub Environment secrets** — `SSH_HOST`, `SSH_USER`, `SSH_KEY` and
   `SSH_KNOWN_HOSTS`. Plus flipping the repository to public and enabling push protection.

   _Revised during implementation:_ an earlier draft of this section also called for a
   `PUBLIC_BASE_URL` environment variable, for the deploy's health poll. It is not needed.
   `remote-deploy.sh` reads the value out of the box's own `.env`, which is where the
   application already gets it, so the public origin has exactly one definition instead of
   two that could drift apart.

### 13.1 The DNS records

For `domains/vinyl.json` in the `is-a-dev/register` pull request:

```json
{
  "owner": { "username": "Anddep", "email": "<your address>" },
  "record": { "A": ["<the instance's public IPv4>"] }
}
```

Add `"AAAA": ["<public IPv6>"]` if the instance has one. Caddy needs the record resolving
**before** it first starts, because that is when it requests the certificate — ordering that
`DEPLOYMENT.md` makes explicit, since getting it backwards burns a Let's Encrypt attempt.

### 13.2 Changing the domain later

The public origin is one variable in three places, so the swap is a documented procedure
rather than a migration. `DEPLOYMENT.md` numbers it: new DNS record → `SITE_ADDRESS` and
`PUBLIC_BASE_URL` in the box's `.env` → `PUBLIC_BASE_URL` variable in the GitHub Environment
→ both OAuth callback URLs re-registered → `docker compose up -d`. Caddy requests a
certificate for the new name on the next request. Total downtime: none, if the old record is
left in place until the new certificate is issued.

## 14. Acceptance criteria

Verified against the running public deployment before the work is called done. Evidence, not
assertion: each row names the command and what its output must show.

| #   | Criterion                                                | How it is proven                                                                                                                                                                               |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A push to `main` reaches production with no human action | Change a string in a client component, push, watch CI → build → deploy chain, then load `https://vinyl.is-a.dev` and see the new string                                                        |
| 2   | A bad deploy rolls back and the site stays up            | `workflow_dispatch` with a SHA whose digest is corrupted; the job fails, `.images.prev` is restored, and a `curl` loop running throughout records no failed request                            |
| 3   | TLS is correct and renews unattended                     | `curl -I http://vinyl.is-a.dev` returns 308 to `https://`; `openssl s_client` shows a valid Let's Encrypt chain; Caddy's log shows the renewal timer                                           |
| 4   | Nothing is listening that should not be                  | `nmap -Pn -p- <ip>` **from another machine** shows 22, 80, 443 and nothing else — specifically not 5432 and not 4000                                                                           |
| 5   | Both providers sign in; the cookie is right              | Complete both flows on the public host; DevTools shows `sid` with `Secure`, `HttpOnly`, `SameSite=Lax`                                                                                         |
| 6   | No secret in the repo, an image layer, or a log          | `gitleaks detect` over full history exits clean; `docker save` each image and grep the layers for the session secret, both client secrets and the database password; read the deploy job's log |
| 7   | The proxy chain reports real client addresses            | `docker compose logs server` shows a public IPv4 in the `combined` line, not `172.x` — proving `TRUST_PROXY_HOPS=2` and therefore that the per-IP limiters are per-IP                          |
| 8   | The CSP is correct and the fonts load                    | Every route in a browser with the console open: zero CSP violations, and `getComputedStyle(document.body).fontFamily` resolves to Geist — the §5.4.2 bug fixed                                 |

Criteria 7 and 8 come from the prompt's body rather than its numbered list; they are the two
that would otherwise pass unnoticed, because both failure modes are silent.

There is no restore drill. It went with the backups (§11).

## 15. Open questions

1. **Does `vinyl.is-a.dev` survive review?** Availability could not be confirmed
   programmatically — the register repository's layout did not answer the probe and `is-a.dev`
   wildcards its DNS, so both signals were useless. Short dictionary words are also the ones
   most likely to be on the reserved list. Have `groovesanddust` ready as a fallback; §13.2
   makes the swap cheap either way.
2. **Will `eu-frankfurt-1` have A1 capacity?** Unknowable until tried, and frequently no. The
   answer is retry, another region, or Hetzner. Nothing in the repository changes.
3. **How long do the scanners stay non-blocking?** `continue-on-error: true` is deliberate and
   temporary (§8.1). Someone has to decide when to remove it; the suggestion is after one
   week and one triage pass.
4. ~~**Does `read_only: true` fight the Postgres image?**~~ **Resolved 2026-08-23: it does
   not.** Brought up with the tmpfs set in §3.2 (`/var/run/postgresql`, `/tmp`) and `db`
   reports healthy. The `server` container was also confirmed to run read-only with all
   capabilities dropped as a non-root user, and to run `prisma migrate deploy` under those
   conditions. No fallback needed; `read_only` stays on all four services.
5. **Should the pre-migration dump survive at all?** It is the one piece of dump-taking left
   after §11. It is retained because §10.2's manual recovery has nothing to restore without
   it. Worth a second look if the operator wants the box to hold no database copies at all.

## 16. Risks

**The instance is reclaimed and the data is gone.** The largest risk in this design, accepted
knowingly (§11.1). Everything except the data is reproducible in about twenty minutes.

**A migration is not backward-compatible and the automatic rollback restores a broken image.**
Handled by procedure rather than by machinery (§10.2), which means it depends on the two-deploy
rule being remembered. `DEPLOYMENT.md` states it where the migration commands are, not in an
appendix.

**Something silently regresses `TRUST_PROXY_HOPS`.** Removing the variable from a compose
`environment:` list — the landmine this codebase has already been bitten by twice — makes it
fall back to `1`, and every per-IP limit quietly reverts to one shared bucket. Nothing errors.
Criterion 7 is the check; the plan adds a unit test on the parsed value so the regression has
two chances to be caught.

**`caddy-data` is destroyed and Let's Encrypt's duplicate limit is reached.** Recovery is
waiting up to a week with no certificate. The mitigation is a named volume and a warning in
the runbook next to every `down -v`.

**Docker group membership on the `deploy` user is root-equivalent.** Structural, not
incidental (T5, §8.4). The forced command is what contains it, so any future change that
relaxes the `authorized_keys` restriction — for convenience, during an incident, at 2am —
converts a deploy credential into a root credential. Worth remembering that the restriction
is load-bearing.

**A free tier changes under the deployment.** Three of the tiers relied on here changed in the
last eighteen months, one of them without announcement and with terminations following two
months later. §12 dates every figure so the next reader knows how much to trust them.
