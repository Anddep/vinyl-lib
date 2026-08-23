# Public Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put `vinyl-lib` on the public internet at `https://vinyl.is-a.dev`, on free infrastructure, deploying automatically from `main`, hardened enough to survive being a public host with OAuth sign-in and file uploads.

**Architecture:** One Ubuntu 24.04 arm64 VM. Four containers under `docker compose`: Caddy terminates TLS and is the only service publishing ports, in front of the existing client nginx, which keeps proxying `/api/*` and `/uploads/*` to the server. Images are built on GitHub's arm64 runners, pushed to GHCR, and deployed by immutable digest over SSH by GitHub Actions. The deploy identity is an SSH key restricted to a forced command.

**Tech Stack:** Docker Compose, Caddy 2, nginx 1.27, Node 24, Express 4, Prisma 5, PostgreSQL 16, GitHub Actions, Ubuntu 24.04 (arm64), UFW, fail2ban, unattended-upgrades.

**Spec:** `docs/superpowers/specs/2026-08-23-deployment-design.md`

## Global Constraints

- **The repository becomes public before Phase 4 runs.** CodeQL, free secret scanning and 4-vCPU ARM runners all depend on it. The history was scanned clean (`gitleaks`, 37 commits, no findings) on 2026-08-23.
- Everything must be **host-agnostic**. Nothing in the repo may name Oracle, an IP address, or a region. The single exception is the commented step in `bootstrap.sh` that clears Oracle's shipped `netfilter-persistent` rules, written to be a no-op elsewhere.
- **arm64 only.** Every image builds for `linux/arm64`. Do not add `linux/amd64`.
- **No secret may enter the repository, an image layer, or a workflow log.** The application `.env` lives only on the box, mode 0600. No workflow reads it, writes it, or is given it.
- Shell scripts are `#!/usr/bin/env bash` with `set -euo pipefail`, are **idempotent**, and comment _why_ rather than _what_. They must be safe to run twice.
- Every environment variable added must be added to the `environment:` list of **every** compose file that needs it — `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.deploy.yml`. The base list is replaced by the override, not merged. This codebase has been bitten by this twice.
- **`docker compose up -d`, never `docker compose restart`.** `restart` reuses the old container environment.
- **`prisma migrate deploy`, never `migrate dev`.** Migrations run against real data.
- **Markdown code blocks go at column 0, never indented inside a list item.** Prettier 3.9.6 strips the backticks off an indented fence and `lint-staged` runs prettier on every `.md`, so an indented block is silently destroyed at commit time. The existing plans follow this convention; match them.
- ESLint must pass with zero warnings. `npm test` must pass at every commit.
- Commit messages: Conventional Commits, subject and body only. **No `Co-Authored-By` trailer.**
- Branch: `feat/deployment` (already created off `origin/main`; the spec commit is on it).
- Third-party GitHub Actions are pinned to a full commit SHA with the version in a trailing comment. First-party `actions/*` keep tags.
- Do not create the OCI account, open the `is-a.dev` pull request, register the OAuth apps, or add the GitHub secrets. Produce the values and the click-path in `DEPLOYMENT.md` and stop there.

---

## File Structure

```
deploy/
  bootstrap.sh                     NEW  idempotent host hardening, run as root on the VM
  remote-deploy.sh                 NEW  the SSH forced-command target
  Caddyfile                        NEW  TLS, security headers, the derived CSP

docker-compose.deploy.yml          NEW  the four production services, images by digest

.github/workflows/
  ci.yml                           MOD  permissions, pinned actions, audit + gitleaks jobs
  codeql.yml                       NEW  javascript-typescript, push/PR/weekly
  build.yml                        NEW  arm64 -> GHCR, SBOM, provenance, digests out
  deploy.yml                       NEW  ssh, migrate, up -d, health poll, auto-rollback
.github/dependabot.yml             NEW  npm, github-actions, docker

server/src/app.ts                  MOD  trust proxy from TRUST_PROXY_HOPS
server/src/config/env.ts           MOD  TRUST_PROXY_HOPS, parsed as a count
server/tests/config/env.test.ts    MOD  cover the new parse
server/prisma/schema.prisma        MOD  binaryTargets for linux-musl-arm64-openssl-3.0.x
server/Dockerfile                  MOD  npm ci; pruned prod install; USER node
server/package.json                MOD  prisma -> dependencies
client/Dockerfile                  MOD  npm ci
client/nginx.conf.template         MOD  CSP removed, pointer comment to the Caddyfile

docker-compose.yml                 MOD  TRUST_PROXY_HOPS in the server environment list
docker-compose.override.yml        MOD  TRUST_PROXY_HOPS in the server environment list
docker-compose.prod.yml            MOD  note that it is the laptop's prod mode, not the deploy

DEPLOYMENT.md                      NEW  the runbook
.env.example                       MOD  TRUST_PROXY_HOPS + a production block
README.md                          MOD  Deployment section; fix the stale CI paragraph
```

---

## Phase 1 — Make the application deployable

Nothing here touches infrastructure. Each task is a behaviour change the production topology needs, and every one is testable on the laptop.

### Task 1: `TRUST_PROXY_HOPS`

**Why:** `server/src/app.ts:26` hardcodes `app.set('trust proxy', 1)`. With Caddy in front of nginx there are two proxies. At `1`, `req.ip` resolves to Caddy's bridge address, which collapses every per-IP limiter in `server/src/lib/limiters.ts` into a single bucket for the entire internet, and makes `req.protocol` wrong so the `secure` session cookie is never sent and sign-in fails with no error anywhere. Both failures are silent. Spec §5.5.

**Files:** `server/src/config/env.ts`, `server/src/app.ts`, `server/tests/config/env.test.ts`, `docker-compose.yml`, `docker-compose.override.yml`, `.env.example`

- [x] **Step 1: Write the failing test**

In `server/tests/config/env.test.ts`, add a describe block for `trustProxyHops()` covering: unset returns `1`; `'2'` returns `2`; `''` returns `1` (Compose substitutes an empty string for an unset variable — the caution `parseCount` already documents); `'0'` returns `1`, because zero proxies is not a meaningful production value and reads as a typo; `'abc'` throws.

- [x] **Step 2: Run it to confirm it fails**

```bash
npm test -w server -- env.test
```

- [x] **Step 3: Implement**

Add to `server/src/config/env.ts`, following the shape of the existing `maxSignupsPerHour()` — read at call time rather than frozen onto `env`, so a test can vary it with `vi.stubEnv`:

```ts
/**
 * How many reverse proxies sit in front of Express.
 *
 * A count, never `true`. With `trust proxy: true` Express believes the leftmost
 * X-Forwarded-For entry unconditionally, and that entry is a header the client
 * writes — which hands any visitor the ability to forge their own address and
 * walk straight through the per-IP limiters that exist to bound them.
 *
 * Laptop prod mode has one proxy (nginx). The deployment has two (Caddy, then
 * nginx), so this is configuration rather than a constant.
 */
export function trustProxyHops(): number {
  return parseCount(process.env.TRUST_PROXY_HOPS, 1);
}
```

- [x] **Step 4: Use it**

In `server/src/app.ts`, replace the hardcoded `1` with `trustProxyHops()` and rewrite the comment to name both proxies and say why it is a count rather than `true`.

- [x] **Step 5: Thread it through Compose**

Add `- TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS}` to the `server` `environment:` list in **both** `docker-compose.yml` and `docker-compose.override.yml`. The override replaces the base list rather than extending it, so both need it. Add it to `.env.example` with a comment naming the dev value (1) and the deployed value (2).

- [x] **Step 6: Verify**

```bash
npm test -w server
```

Then confirm the variable actually arrives, which is the check that catches the whitelist landmine:

```bash
docker compose up -d && docker compose exec server printenv TRUST_PROXY_HOPS
```

- [x] **Step 7: Commit**

`fix: count both proxies when resolving the client address`

### Task 2: Prisma engine for Alpine arm64

**Why:** `schema.prisma` declares no `binaryTargets`, so the engine matches whatever generated it. Production is Alpine on arm64 against OpenSSL 3. A mismatch does not fail the build and does not fail the container's start — it fails the first query, which means the deploy's health poll discovers it with the site already down. Spec §4.3.

**Files:** `server/prisma/schema.prisma`

- [x] **Step 1: Add the target**

```prisma
generator client {
  provider      = "prisma-client-js"
  // The deployed image is Alpine on arm64 against OpenSSL 3. Without this the
  // engine is generated for whatever built it, the container starts happily,
  // and the first query fails. `native` stays so local generation still works.
  binaryTargets = ["native", "linux-musl-arm64-openssl-3.0.x"]
}
```

- [x] **Step 2: Confirm nothing broke locally**

```bash
npm run prisma:generate -w server && npm test -w server
```

- [x] **Step 3: Verify on the real target — not by reading the config**

Deferred to Task 4 Step 6, where the built arm64 image runs and `/api/health` must answer `db: connected`. That response is the first thing that actually loads the query engine, so it is the only honest test. Note the dependency in the commit body.

- [x] **Step 4: Commit**

`fix: generate the query engine for the deployed platform`

### Task 3: `prisma` becomes a runtime dependency

**Why:** Task 4 prunes dev dependencies out of the production image. `prisma migrate deploy` _is_ the `prisma` CLI, and the deploy runs it from the server image. Spec §4.2.

**Files:** `server/package.json`, `package-lock.json`

- [x] **Step 1: Move it**

`prisma` from `devDependencies` to `dependencies` in `server/package.json`, same version range.

- [x] **Step 2: Refresh the lockfile**

```bash
npm install
```

- [x] **Step 3: Verify**

```bash
npm ls prisma -w server && npm test -w server
```

- [x] **Step 4: Commit**

`chore: keep the prisma CLI in the production dependency tree`

In the body, record the rejected alternative — a separate migrate image built from the same Dockerfile — and why moving one package beat a third artifact to build, push, pin by digest and roll back.

### Task 4: Reproducible, pruned, non-root images

**Why:** Both Dockerfiles run `npm install`, so a build is not reproducible against the lockfile and an image digest means less than it appears. Worse, `server/Dockerfile`'s prod stage copies `/app/node_modules` wholesale — shipping typescript, vitest, supertest, eslint, ts-node-dev and every `@types/*` package into the container that faces the internet. Spec §4.2.

**Files:** `server/Dockerfile`, `client/Dockerfile`

- [x] **Step 1: Record the baseline**

```bash
docker build -f server/Dockerfile --target prod -t vinyl-server:before . && docker image ls vinyl-server
```

That number is the verification for Step 5.

- [x] **Step 2: `npm ci` in both deps stages**

Replace `RUN npm install` in `server/Dockerfile` and `client/Dockerfile`. `npm ci` requires the lockfile to agree with the manifests and fails loudly when it does not, which is the point.

- [x] **Step 3: Add a pruned stage to `server/Dockerfile`**

```dockerfile
# ---- prod-deps: runtime dependencies only ----
FROM node:24-alpine AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev
```

- [x] **Step 4: Rewrite the final stage**

Copy from `prod-deps` rather than `build`, and bring the generated Prisma client across — a pruned install never ran `prisma generate`, so `.prisma` does not exist in it:

```dockerfile
FROM node:24-alpine AS prod
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
# The pruned tree has @prisma/client but not the generated engine, because
# `prisma generate` never ran there.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/package.json ./server/package.json
# Created and owned before anything mounts over it, so a fresh named volume
# inherits node ownership and the non-root process can write uploads.
RUN mkdir -p /app/server/uploads && chown -R node:node /app
USER node
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

- [x] **Step 5: Verify the prune actually pruned**

```bash
docker run --rm --entrypoint sh vinyl-server:after -c 'ls node_modules/typescript 2>&1 | head -1'
```

`typescript` must be absent. Compare the image size against Step 1.

- [x] **Step 6: Verify arm64 end to end — this also verifies Task 2**

```bash
docker buildx build --platform linux/arm64 -f server/Dockerfile --target prod -t vinyl-server:arm64 --load .
```

Run it against a Postgres container and poll `/api/health` until it answers `{"status":"ok","db":"connected"}`. Anything less does not exercise the query engine.

- [x] **Step 7: Verify uploads still write as non-root**

With the stack up, upload a cover through the UI, or:

```bash
docker compose exec server sh -c 'touch /app/server/uploads/probe && rm /app/server/uploads/probe'
```

A permission error here means the `chown` ordering in Step 4 is wrong.

- [x] **Step 8: Commit**

`build: install from the lockfile and ship only runtime dependencies`

---

## Phase 2 — The edge

Everything in this phase is verifiable on the laptop, before any VM exists, by running the deploy compose file with `SITE_ADDRESS=localhost` and letting Caddy use its internal CA.

### Task 5: The Caddyfile

**Why:** Caddy terminates TLS, redirects, sets the security headers, and holds the single definition of the CSP. Spec §5.

**Files:** `deploy/Caddyfile`

- [x] **Step 1: Write it**

```caddyfile
# The site address is the only thing that changes when the domain does. Set it
# to `localhost` and Caddy issues from its internal CA, which makes this whole
# edge — TLS, headers, CSP, proxy chain — testable without a VM.
{$SITE_ADDRESS} {
	encode zstd gzip

	# helmet already sets a policy on API responses. Two policies would be
	# enforced as their intersection, for no benefit and one confusing
	# debugging session later.
	@document not path /api/*
	header @document Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests"

	header {
		# A year, subdomains included. No `preload`: submitting to the preload
		# list is close to a one-way door, and a year of HSTS is the same
		# protection for every visitor past their first request.
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		# Record cards link out. The path they were left from should not travel.
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
		-Server
	}

	reverse_proxy client:80
}
```

- [x] **Step 2: Check the CSP against the built output, do not trust the derivation**

```bash
npm run build -w client && grep -c '<style\|<script[^>]*>[^<]' client/dist/index.html
```

Confirm there is still no inline `<script>` and no inline `<style>`, and that the only external hosts are `fonts.googleapis.com` and `fonts.gstatic.com`. If a future dependency adds an inline script, this is where it is caught.

- [x] **Step 3: Commit**

`feat: terminate TLS and set the security headers at the edge`

### Task 6: One CSP, not two

**Why:** Two definitions are enforced as their intersection and get discovered months later as a feature that does not work. This is also where the existing bug dies: the policy shipping today lists no font host in `style-src` and has no `font-src` at all, so Geist and Instrument Serif have never loaded in prod mode. Spec §5.4.

**Files:** `client/nginx.conf.template`

- [x] **Step 1: Remove the policy**

Delete the `add_header Content-Security-Policy` line and its comment block from the `location /` block.

- [x] **Step 2: Leave a pointer**

So the next reader does not conclude it was forgotten:

```nginx
# The Content-Security-Policy is set at the edge, in deploy/Caddyfile, so there
# is exactly one definition — two would be enforced as their intersection. Note
# the consequence: `npm run prod` does not run Caddy and therefore serves no
# CSP. Verify policy changes against docker-compose.deploy.yml with
# SITE_ADDRESS=localhost.
```

- [x] **Step 3: Commit**

`refactor: keep the content security policy in one place`

### Task 7: `docker-compose.deploy.yml`

**Why:** The running topology should be reviewable in version control. Spec §3.

**Files:** `docker-compose.deploy.yml`

- [x] **Step 1: Write the four services**

Key points, each with a reason in the spec:

- `caddy` is the **only** service with `ports:` — `80:80` and `443:443`. `client` publishes nothing, which is the change from `docker-compose.prod.yml`.
- `image:` everywhere, never `build:`. `client` and `server` take `${CLIENT_IMAGE}` / `${SERVER_IMAGE}`, which `.images` supplies as full `name@sha256:…` references.
- Every variable from `docker-compose.yml`'s `server` environment list repeated here, **plus `TRUST_PROXY_HOPS`**. The list is not inherited.
- Volumes `caddy-data`, `caddy-config`, `db-data`, `uploads`. `caddy-data` is a named volume, not a bind mount — losing it means re-issuing into Let's Encrypt's five-duplicates-per-week limit.
- The Caddyfile bind-mounted read-only.

- [x] **Step 2: Harden every service**

`restart: unless-stopped`, `security_opt: ["no-new-privileges:true"]`, `cap_drop: [ALL]`, `read_only: true` with tmpfs, and a memory limit. Per-service, from spec §3.2:

| Service | `cap_add`                                                | tmpfs                                                       | mem_limit |
| ------- | -------------------------------------------------------- | ----------------------------------------------------------- | --------- |
| caddy   | `NET_BIND_SERVICE`                                       | `/tmp`                                                      | 256m      |
| client  | `CHOWN`, `SETGID`, `SETUID`                              | `/var/cache/nginx`, `/var/run`, `/tmp`, `/etc/nginx/conf.d` | 256m      |
| server  | none — `USER node` from Task 4                           | `/tmp`                                                      | 1g        |
| db      | `CHOWN`, `DAC_READ_SEARCH`, `FOWNER`, `SETGID`, `SETUID` | `/var/run/postgresql`, `/tmp`                               | 2g        |

- [x] **Step 3: Add healthchecks**

On `server` (curl `/api/health`), keeping the existing `pg_isready` on `db`, so `up -d --wait` has something to wait for.

- [x] **Step 4: Validate**

```bash
docker compose -f docker-compose.deploy.yml config -q
```

- [x] **Step 5: Verify `read_only` against reality**

This is spec §15 open question 4. Bring the stack up and watch every container reach a steady state. Postgres is the one expected to fight. If it does, read the actual error and add the missing tmpfs; only if that fails, drop `read_only` for `db` alone and record why in a comment. Do not drop it for the others.

- [x] **Step 6: Commit**

`feat: describe the deployed topology in version control`

### Task 8: Prove the edge on the laptop

**Why:** Every part of Phase 2 is testable before a VM exists, and finding a CSP mistake here costs minutes rather than a failed production deploy.

**Files:** none — a verification task. Record the results in the Task 7 commit body.

- [x] **Step 1: Bring up the real topology locally**

Build both images locally, tag them, point `CLIENT_IMAGE`/`SERVER_IMAGE` at those tags, then:

```bash
SITE_ADDRESS=localhost docker compose -f docker-compose.deploy.yml up -d
```

- [x] **Step 2: Verify the headers**

```bash
curl -kI https://localhost/
```

Shows HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, the CSP, and **no** `Server` header. Then `curl -kI https://localhost/api/health` shows the security headers but **not** the Caddy CSP.

- [x] **Step 3: Verify the redirect**

```bash
curl -I http://localhost/
```

Returns 308 to `https://`.

- [x] **Step 4: Verify the CSP in a browser, on every route**

`/`, `/u/:slug`, `/admin` and each admin screen. **Zero CSP violations in the console.**

- [x] **Step 5: Verify the bug is dead**

In the console, `getComputedStyle(document.body).fontFamily` must resolve to Geist, and the Network tab must show `fonts.googleapis.com` and `fonts.gstatic.com` loading rather than blocked. This is the §5.4.2 fix, confirmed.

- [x] **Step 6: Verify nothing else listens**

```bash
docker compose -f docker-compose.deploy.yml ps
```

Published ports on `caddy` only.

---

## Phase 3 — The host scripts

Both scripts are the operator's, not CI's. They live in the repo so they are reviewable and version-controlled, and are copied to the box.

### Task 9: `deploy/bootstrap.sh`

**Why:** The box must be hardened the same way every time, including the time it is rebuilt after a reclaim. A script that only works on a pristine system is a script nobody dares run twice. Spec §7.

**Files:** `deploy/bootstrap.sh`

- [ ] **Step 1: Preamble**

`set -euo pipefail`, require root, require Ubuntu 24.04 (warn and continue elsewhere — it is a portability contract, not a lock), and echo a plan of what will happen.

- [ ] **Step 2: Packages and Docker**

`ca-certificates`, `curl`, `gnupg`, `ufw`, `fail2ban`, `unattended-upgrades`, `iptables-persistent`. Then Docker CE from Docker's own apt repository (arm64) with the compose plugin — Ubuntu's `docker.io` lags and ships no compose v2.

- [ ] **Step 3: Timezone**

`timedatectl set-timezone Europe/Kyiv`, so the reboot window in Step 11 means what it says.

- [ ] **Step 4: The `deploy` user**

Create if absent, home `/opt/vinyl-lib`, add to `docker`. Comment the consequence explicitly: docker group membership is root-equivalent — a member can `docker run -v /:/host --privileged` and own the machine — and the only thing containing it is the forced command in Task 10.

- [ ] **Step 5: Docker daemon config**

```json
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

Comment that rotation is a data-integrity control rather than housekeeping: `morgan('combined')` writes a line per request, the default driver never rotates, and a full boot volume does not stop nginx — it stops Postgres writing, mid-transaction. Restart the daemon only if the file changed.

- [ ] **Step 6: Swap**

4 GB at `/swapfile` if absent, `vm.swappiness=10` via `/etc/sysctl.d/`, an `fstab` entry added idempotently. Comment that this is for Postgres under memory pressure and not for builds — nothing builds here — and that without it the OOM killer reliably picks the largest process, which is Postgres.

- [ ] **Step 7: SSH hardening, with the guard that prevents a lockout**

First, verify `~deploy/.ssh/authorized_keys` exists and is non-empty. **Abort with a clear message if not.** Disabling password authentication on a box with no working key installed is the single most common way to permanently lose a server, and it is entirely preventable with one check.

Then write a drop-in — not an edit to the main file, so a distribution upgrade cannot silently revert it — at `/etc/ssh/sshd_config.d/99-hardening.conf`:

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
AllowUsers deploy ubuntu
```

Run `sshd -t` before reloading. Reload, never restart.

- [ ] **Step 8: Firewall, both layers**

UFW: default deny incoming, allow outgoing, allow 22, 80, 443, `--force enable`.

Detect the external interface from the default route. **Do not hardcode `ens3` or `eth0`** — the name differs between Oracle's images and Hetzner's.

Then the `DOCKER-USER` rules, rebuilt rather than appended so re-running is safe: flush a dedicated chain, add `RETURN` for `RELATED,ESTABLISHED`, `RETURN` for tcp dports 80 and 443, then `DROP`, and ensure `DOCKER-USER` jumps to it exactly once. Order is the whole thing here.

Comment why UFW alone is not enough: Docker writes its own iptables rules and they are evaluated first, so a published port is reachable from the internet with a UFW `deny` sitting right there looking like it works.

Persist with `netfilter-persistent save`.

- [ ] **Step 9: Clear the rules Oracle's image ships**

Oracle's Ubuntu images arrive with a populated `netfilter-persistent` ruleset whose `INPUT` chain ends in `REJECT`, ahead of anything UFW adds. Clear it and let UFW own `INPUT`.

Comment the symptom so it is recognisable: `curl localhost` works on the box, `curl` from outside hangs, and `ufw status` shows 80 and 443 allowed. Write the step so it finds nothing and does nothing on a host without it.

- [ ] **Step 10: fail2ban**

`/etc/fail2ban/jail.d/sshd.local` with `backend = systemd`, `maxretry = 5`, `bantime = 1h`. Comment that with password authentication off this is not stopping a credential guess — it is stopping the background noise of the internet from filling the journal and eating the CPU of a two-core box.

- [ ] **Step 11: unattended-upgrades**

Security origins only, `Unattended-Upgrade::Automatic-Reboot "true"`, `Automatic-Reboot-Time "04:30"`. Comment that the automatic reboot is deliberate — a kernel update downloaded but never activated is a patch that was not applied — and that `restart: unless-stopped` brings the stack back without help.

- [ ] **Step 12: Directory layout**

`/opt/vinyl-lib` owned by `deploy`, plus `pre-migrate/`. Do **not** create or touch `.env`: that is the operator's, by hand, at mode 0600.

- [ ] **Step 13: Closing summary**

Print what was done and what the operator must still do by hand — install the deploy key with its forced-command restrictions, write `.env`, open 80/443 in the OCI security list.

- [ ] **Step 14: Verify idempotency, which is the point of the whole task**

Run it twice on a scratch VM. The second run must change nothing and must not error.

```bash
ufw status verbose
docker info --format '{{.LiveRestoreEnabled}}'
swapon --show
sshd -T | grep -i passwordauthentication
iptables -S DOCKER-USER
```

- [ ] **Step 15: Commit**

`feat: harden the host from a script that can be run twice`

### Task 10: `deploy/remote-deploy.sh`

**Why:** The SSH forced-command target. It is what makes a leaked deploy key a deploy credential rather than a root credential. Spec §8.4, §8.5.

**Files:** `deploy/remote-deploy.sh`

- [ ] **Step 1: Validate the request**

Read `SSH_ORIGINAL_COMMAND`. Accept **only** a strict match:

```
^deploy [0-9a-f]{40} sha256:[0-9a-f]{64} sha256:[0-9a-f]{64}$
```

Anything else: log it and exit non-zero. Comment that this is the whole security boundary — the `deploy` user is in the `docker` group and therefore root-equivalent, so what the key can _invoke_ is what defines the blast radius.

- [ ] **Step 2: Install the config from stdin**

Read a tar — a forced command still receives stdin — extract to a temp directory, and accept **only** the filenames `docker-compose.deploy.yml` and `Caddyfile`. Reject any other member, and reject absolute paths and `..`. Validate with `docker compose -f <tmp> config -q` before installing. This is what lets the topology ship with the deploy while the key still cannot open a shell.

- [ ] **Step 3: Record the previous digests**

Copy `.images` to `.images.prev` **before anything changes**, then write the new digests to `.images`.

- [ ] **Step 4: Pull**

`docker compose pull`. Failing here means a bad digest or a registry problem and nothing has changed yet, so exit without rolling back — there is nothing to roll back to.

- [ ] **Step 5: Bring the database up**

`docker compose up -d db --wait`.

- [ ] **Step 6: Pre-migration dump**

`pg_dump` to `pre-migrate/<utc-timestamp>.sql.gz`, pruned to the newest five. Comment honestly, per spec §11.2: **this is rollback machinery, not a backup** — same disk as the database it dumps, nothing captured between deploys, and no uploads.

- [ ] **Step 7: Migrate**

`docker compose run --rm server npx prisma migrate deploy`. A one-shot container, **before** the new server starts. Never `migrate dev`, which is interactive, can generate a migration from a schema diff, and can reset the database.

- [ ] **Step 8: Up**

`docker compose up -d --remove-orphans`. Comment: `up -d`, never `restart` — `restart` reuses the container's existing environment, so a changed `.env` or image appears to deploy and changes nothing.

- [ ] **Step 9: Health poll**

`curl -fsS "$PUBLIC_BASE_URL/api/health"` expecting `"status":"ok"`, roughly 30 attempts at 2-second intervals. Through the **public URL**, not localhost: that path exercises DNS, Caddy, TLS, nginx, Express and Postgres, which is the thing being claimed to work.

- [ ] **Step 10: Roll back on failure**

Restore `.images.prev`, `up -d`, re-poll, and exit non-zero either way so the workflow fails loudly. Log every step — this output is all the operator gets.

- [ ] **Step 11: Verify locally before it ever runs remotely**

Drive the script by hand on the laptop with a fake `SSH_ORIGINAL_COMMAND` and locally built images. Test four cases: the happy path; a malformed command is refused; a tar containing `../evil` is refused; a bad digest rolls back and the site stays up.

- [ ] **Step 12: Commit**

`feat: deploy by digest, with a health gate and an automatic rollback`

---

## Phase 4 — CI/CD

**Prerequisite: the repository is public.** CodeQL, free secret scanning and 4-vCPU ARM runners all depend on it. Confirm before starting Task 12.

### Task 11: Extend `ci.yml`

**Why:** The existing job is fine and stays. What is missing is a permissions floor, pinned third-party actions, and two scanners. Spec §8.1.

**Files:** `.github/workflows/ci.yml`

- [ ] **Step 1: Add a permissions floor**

`permissions: { contents: read }` at the top level. The default token is read/write across the repository and a lint job needs neither.

- [ ] **Step 2: Pin third-party actions**

To a full commit SHA, with the version in a trailing comment. First-party `actions/*` keep their tags.

- [ ] **Step 3: Add the `audit` job**

`npm ci` then `npm audit --audit-level=high`. `continue-on-error: true`.

- [ ] **Step 4: Add the `secrets` job**

gitleaks over full history. **`fetch-depth: 0` is not optional** — the default shallow checkout scans one commit and reports clean, which is worse than not running it at all. `continue-on-error: true`.

- [ ] **Step 5: Comment the `continue-on-error` flags as temporary**

With the reason: a new scanner that blocks `main` on day one teaches everyone to bypass it. Record the removal as a follow-up in `DEPLOYMENT.md`.

- [ ] **Step 6: Verify**

Push the branch; confirm every job runs and the two new ones report. gitleaks must report 0 findings — it did on 2026-08-23, so anything else means something new landed.

- [ ] **Step 7: Commit**

`ci: add dependency, secret and permission hygiene`

### Task 12: `codeql.yml`

**Why:** Free now that the repository is public, and findings land in the Security tab with dataflow traces. Spec §8.2.

**Files:** `.github/workflows/codeql.yml`

- [ ] **Step 1: Write it**

Language `javascript-typescript`. Triggers: push to `main`, pull requests, and a weekly schedule — the schedule matters because the rule packs improve, so the same code is worth re-scanning. `runs-on: ubuntu-latest`: this analyses source, and the analysis has no architecture. `permissions: { security-events: write, contents: read, actions: read }`.

- [ ] **Step 2: Verify**

Push; confirm the run completes and results appear under Security → Code scanning.

- [ ] **Step 3: Triage what it finds**

Do not silence anything without reading it. Record every dismissal with a reason.

- [ ] **Step 4: Commit**

`ci: scan the source with codeql`

### Task 13: `build.yml`

**Why:** Build once, on ARM, for ARM, and hand the deploy a digest rather than a tag. Spec §4, §8.3.

**Files:** `.github/workflows/build.yml`

- [ ] **Step 1: Triggers**

`workflow_run` of CI completing on `main`, plus tags. Gate the job on `github.event.workflow_run.conclusion == 'success'`.

- [ ] **Step 2: Check out the right commit**

`ref: ${{ github.event.workflow_run.head_sha }}`. **A `workflow_run` job checks out the default branch by default, not the commit that triggered it.** Getting this wrong produces a pipeline that looks fine and deploys the wrong commit whenever two pushes land close together.

- [ ] **Step 3: Runner**

`runs-on: ubuntu-24.04-arm`. Native, not QEMU: a cross-build of Vite plus `tsc` plus `prisma generate` takes upwards of fifteen minutes for no benefit.

- [ ] **Step 4: Permissions**

`contents: read`, `packages: write`, `id-token: write`, `attestations: write`.

- [ ] **Step 5: Build and push both images**

`docker/login-action` to GHCR with `GITHUB_TOKEN`; `docker/setup-buildx-action`; `docker/build-push-action` with `platforms: linux/arm64`, `cache-from` and `cache-to` of `type=gha,mode=max`, tags `sha-<commit>` and `latest`, `sbom: true`, `provenance: mode=max`. All SHA-pinned.

- [ ] **Step 6: Output the digests**

As job outputs. Not the tags — spec §4.4.

- [ ] **Step 7: Verify**

Temporarily widen the trigger and push. Confirm both images appear in GHCR, that the SBOM and provenance attachments exist, and that the digests are in the job summary. Restore the trigger.

- [ ] **Step 8: Verify no secret reached a layer**

Half of acceptance criterion 6:

```bash
docker save ghcr.io/anddep/vinyl-lib-server:latest | tar -xO | strings | grep -c '<the session secret>'
```

Repeat for both OAuth client secrets and the database password, on both images. Every count must be 0.

- [ ] **Step 9: Commit**

`ci: build arm64 images and publish them by digest`

### Task 14: `deploy.yml`

**Why:** Spec §8.4, §8.5.

**Files:** `.github/workflows/deploy.yml`

- [ ] **Step 1: Triggers**

`workflow_run` of Build succeeding on `main`, plus `workflow_dispatch` with a `sha` input. That input is the entire rollback interface.

- [ ] **Step 2: Environment**

`environment: production`. Holds the secrets, and records every deployment against its commit.

- [ ] **Step 3: Resolve the SHA and its digests**

From `workflow_run.head_sha` or the dispatch input, then resolve that SHA's digests from GHCR with `docker buildx imagetools inspect`. This is what lets any previously built commit be deployed, not only the last one.

- [ ] **Step 4: SSH setup**

Write `SSH_KEY` to a mode-600 temp file. Write `SSH_KNOWN_HOSTS` to a known_hosts file and use it. **Never `StrictHostKeyChecking=no`** — that turns a pinned host key into trust-on-first-use on every run, which discards exactly the protection being paid for.

- [ ] **Step 5: Invoke the forced command**

Piping the config tar on stdin:

```bash
tar -cf - docker-compose.deploy.yml -C deploy Caddyfile |
  ssh -o UserKnownHostsFile=known_hosts -i key \
    "$SSH_USER@$SSH_HOST" "deploy $SHA $CLIENT_DIGEST $SERVER_DIGEST"
```

- [ ] **Step 6: Fail loudly**

A non-zero exit fails the job. Do not swallow it and do not retry — the script has already rolled back, and a retry would repeat a known-bad deploy.

- [ ] **Step 7: Verify the happy path**

Acceptance criterion 1.

- [ ] **Step 8: Verify the rollback**

Acceptance criterion 2. Dispatch with a SHA whose digest is deliberately corrupted, running this throughout:

```bash
while true; do curl -s -o /dev/null -w '%{http_code}\n' https://vinyl.is-a.dev/api/health; sleep 1; done
```

Confirm **no failed request**.

- [ ] **Step 9: Verify no secret reached the log**

The other half of criterion 6. Read the deploy job's log end to end.

- [ ] **Step 10: Commit**

`ci: deploy to the host over a restricted ssh key`

### Task 15: `dependabot.yml`

**Files:** `.github/dependabot.yml`

- [ ] **Step 1: Three ecosystems**

`npm` at `/` (workspaces are covered from the root), `github-actions` at `/`, and `docker` at `/` for the base images in both Dockerfiles and the compose files. Weekly, grouped so a single PR carries patch bumps rather than one PR per package.

- [ ] **Step 2: Verify**

Confirm Dependabot runs and either opens a PR or reports no updates needed.

- [ ] **Step 3: Commit**

`ci: keep dependencies, actions and base images current`

---

## Phase 5 — Documentation

### Task 16: `DEPLOYMENT.md`

**Why:** The four things that cannot be automated need exact values and click-paths, and everything that can go wrong at 2am needs a procedure. Spec §13.

**Files:** `DEPLOYMENT.md`

Written in `RUNNING.md`'s register: plain instructions, one command per block, no cleverness. Each bullet below is a section to write.

- [ ] **First-time provisioning, end to end**

OCI signup (card for identity verification, not charged). Instance at `VM.Standard.A1.Flex`, **2 OCPU / 12 GB** — state that the old 4/24 figure is dead and that over-limit instances have been terminated since 18 Aug 2026. Ubuntu 24.04, `eu-frankfurt-1`, and what to do when it says out of capacity. **Opening 80/443 in the VCN security list**, with the diagnostic stated plainly: `curl` working on the box and hanging from outside means the security list, not the app.

- [ ] **The DNS records for the `is-a.dev` pull request**

The exact `domains/vinyl.json` content, and **that the operator opens the PR by hand** because the maintainers reject AI-generated pull requests. State the ordering trap: DNS must resolve **before** Caddy first starts, because that is when it requests the certificate.

- [ ] **The OAuth callback registration**

At both providers, with the exact URLs.

- [ ] **The GitHub secrets and variables to create**

In the `production` Environment: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_KNOWN_HOSTS`, and the variable `PUBLIC_BASE_URL`. How to capture the known-hosts value with `ssh-keyscan`, and why `StrictHostKeyChecking=no` is not the shortcut.

- [ ] **Making the repository public**

And enabling secret scanning with push protection.

- [ ] **The generated values**

Session secret, database password, SSH deploy key — the command that generates each and **where each half goes**. Include the `authorized_keys` line verbatim with its forced command and restrictions, and say what it buys: a leaked key can deploy, and cannot get a shell.

- [ ] **Deploying**

Automatic on push; `workflow_dispatch` for a manual run.

- [ ] **Rolling back, and the sharp edge**

Dispatch with an older SHA. In the same section rather than an appendix, spec §10.2: an image rollback does not roll back a migration. State the two-deploy rule for any migration that drops or renames — one deploy stops using the column, a later one removes it — and give the manual recovery for when it was not followed: restore the newest `pre-migrate/*.sql.gz`, then deploy the previous SHA.

- [ ] **Rotating the session secret**

Edit `.env`, `up -d` (**not** `restart`). Everyone is signed out, which is the intended effect.

- [ ] **Rotating the deploy key**

Add the new key, update the secret, **prove it with a dispatch, then** remove the old line. In that order: removing first is how a pipeline locks itself out of its own server.

- [ ] **Changing the domain later**

A numbered procedure: new DNS record → `SITE_ADDRESS` and `PUBLIC_BASE_URL` in the box's `.env` → the `PUBLIC_BASE_URL` variable in the GitHub Environment → both OAuth callbacks re-registered → `up -d`. Leaving the old record in place until the new certificate is issued means no downtime.

- [ ] **Troubleshooting, in `RUNNING.md`'s style**

Symptom as the heading. Cover: the security-list hang; no certificate (DNS ordering, or Let's Encrypt's five-duplicates-per-week after repeated `down -v`); sign-in failing silently (`TRUST_PROXY_HOPS`); and `docker compose exec server printenv` for the whitelist landmine.

- [ ] **What has no backup**

Plainly, not buried. The collection exists in one place; an Oracle reclaim is the most likely way this deployment ends; and the `pre-migrate` dumps are rollback machinery rather than backups — same disk, nothing between deploys, no uploads. Point at spec §11.3 for the hour of work that would change it.

- [ ] **The follow-up task**

Removing `continue-on-error` from the scanner jobs once triaged.

- [ ] **Verify**

Read it start to finish as if provisioning from nothing. Every value present, every command copy-pasteable, no step assuming knowledge from elsewhere.

- [ ] **Commit**

`docs: write the deployment runbook`

### Task 17: `.env.example` and `README.md`

**Files:** `.env.example`, `README.md`, `docker-compose.prod.yml`

- [ ] **Step 1: `.env.example`**

Add `TRUST_PROXY_HOPS` with both values explained, and a production block covering `SITE_ADDRESS`, `CLIENT_IMAGE`, `SERVER_IMAGE` and what changes in production: `NODE_ENV`, `PUBLIC_BASE_URL`, a fresh `SESSION_SECRET`, `SIGNUP_MODE` staying `invite`, and `BOOTSTRAP_OWNER_EMAIL` set before first sign-in. Keep the existing register — every variable carries a comment saying why.

- [ ] **Step 2: `README.md`**

A short **Deployment** section linking to `DEPLOYMENT.md` rather than duplicating it.

- [ ] **Step 3: Fix the stale CI paragraph**

The README says CI "installs dependencies, then runs `npm run lint` and `npm run build`". It also tests, audits, scans for secrets and runs CodeQL, and now feeds a build-and-deploy chain. Rewrite it.

- [ ] **Step 4: Label `docker-compose.prod.yml`**

Note that it is the laptop's production mode and **not** what is deployed — `docker-compose.deploy.yml` is — so nobody edits the wrong file.

- [ ] **Step 5: Verify**

Every link resolves and every referenced variable exists.

- [ ] **Step 6: Commit**

`docs: point the readme at the deployment runbook`

---

## Phase 6 — Provision and prove

Nothing here is code. It is the live run-through, and it is where the acceptance criteria are actually met. Do not call the work done before this phase completes.

### Task 18: Provision

- [ ] Operator: create the OCI account, provision the instance, open 80/443 in the security list.
- [ ] Operator: open the `is-a.dev` pull request by hand, and wait for it to merge.
- [ ] Operator: register both OAuth callbacks.
- [ ] Operator: make the repository public and enable push protection.
- [ ] Operator: create the GitHub Environment secrets and variable.
- [ ] Install the deploy key with its forced-command restrictions, run `bootstrap.sh`, and write `/opt/vinyl-lib/.env` at mode 0600.
- [ ] Confirm DNS resolves **before** the first deploy, so Caddy's first certificate request succeeds.

### Task 19: Verify all eight acceptance criteria

Each needs evidence recorded, not a claim. Spec §14.

- [ ] **1 — automatic deploy.** Change a string in a client component, push to `main`, watch CI → build → deploy, load the site, see the string.
- [ ] **2 — automatic rollback.** Deliberately bad digest. The job fails, the previous digests are restored, and a `curl` loop running throughout records no failed request.
- [ ] **3 — TLS.** `curl -I http://vinyl.is-a.dev` returns 308 to `https://`; `openssl s_client` shows a valid Let's Encrypt chain; Caddy's log shows the renewal timer scheduled.
- [ ] **4 — ports.** `nmap -Pn -p- <ip>` **from another machine**: 22, 80, 443 and nothing else. Specifically not 5432 and not 4000.
- [ ] **5 — sign-in.** Both providers, end to end, on the public host. DevTools shows `sid` with `Secure`, `HttpOnly`, `SameSite=Lax`.
- [ ] **6 — no secrets.** `gitleaks` over full history clean; `docker save` both images and grep the layers for all four secret values; read the deploy log end to end.
- [ ] **7 — real client IPs.** `docker compose logs server` shows a public IPv4 in the `combined` line, not `172.x`. This is the only proof that the per-IP limiters are per-IP.
- [ ] **8 — CSP and fonts.** Every route, console open, zero violations; `getComputedStyle(document.body).fontFamily` resolves to Geist.
- [ ] **Record the evidence** in the PR description. A criterion without its output pasted underneath is not verified.

### Task 20: Finish the branch

- [ ] Use superpowers:requesting-code-review before merging.
- [ ] Open the PR with the eight criteria and their evidence.
- [ ] Merge to `main`, and watch the merge itself deploy — the last and best proof of criterion 1.
