# Deploying

This is the runbook. It assumes nothing exists yet and takes you to a site on
the public internet that redeploys itself when `main` moves.

Read [RUNNING.md](RUNNING.md) for day-to-day work on your laptop. This file is
only about the server.

**The short version, once everything is set up:** push to `main`. That is the
whole deployment procedure. Everything below is for the first time, and for the
days when something is wrong.

|            |                                                         |
| ---------- | ------------------------------------------------------- |
| Site       | https://vinyl.is-a.dev                                  |
| Host       | one Ubuntu 24.04 arm64 VM                               |
| Deploys    | automatically, on every push to `main`                  |
| Rolls back | automatically, if the new version is not healthy        |
| Backups    | **none.** See [What has no backup](#what-has-no-backup) |

---

## Before you start

Five things only you can do. They are in order, and later steps genuinely depend
on earlier ones.

1. [Make the repository public](#1-make-the-repository-public)
2. [Create the server](#2-create-the-server)
3. [Point the domain at it](#3-point-the-domain-at-it)
4. [Generate the secrets](#4-generate-the-secrets)
5. [Register the OAuth callbacks](#5-register-the-oauth-callbacks)

Then [set up the box](#6-set-up-the-box) and
[tell GitHub how to reach it](#7-tell-github-how-to-reach-it).

---

## 1. Make the repository public

This unlocks CodeQL, secret scanning with push protection, unlimited Actions
minutes and 4-vCPU arm64 runners — all of which cost money on a private
repository, and all of which this deployment uses.

The history was scanned before this was recommended: `.env` has never been
committed, and `gitleaks` over every commit finds nothing. Your commit author
address becomes publicly visible, which is normal for a public repository and
cannot be changed without rewriting history.

Go to **Settings → General → Danger Zone → Change repository visibility →
Make public**.

Then turn on push protection, which refuses a `git push` containing a
recognisable credential — a better defence than finding it afterwards:

**Settings → Advanced Security → Secret Protection → Push protection → Enable**

---

## 2. Create the server

### Sign up

Oracle Cloud's Always Free tier. A card is required to verify identity; it is
not charged, and nothing in this deployment can provision a resource outside the
free allowance.

https://www.oracle.com/cloud/free/

Choose the **Frankfurt** home region during signup. It cannot be changed later.

### Create the instance

**Compute → Instances → Create instance**

| Field       | Value                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| Image       | Canonical Ubuntu 24.04                                                     |
| Shape       | `VM.Standard.A1.Flex` (Ampere, arm64)                                      |
| OCPUs       | **2**                                                                      |
| Memory      | **12 GB**                                                                  |
| Boot volume | 50 GB is plenty                                                            |
| SSH keys    | paste your **personal** public key — not the deploy key, which comes later |

> **2 OCPU and 12 GB, not 4 and 24.** Oracle halved the Always Free Ampere
> allowance on 15 June 2026 and began terminating instances over the new limit
> on 18 August 2026. Older guides still say 4/24. Those instances are being
> deleted.

If it says **out of capacity**, that is routine for Ampere in Frankfurt. Retry
over a few hours, or try another region, or give up on Oracle — see
[If Oracle does not work out](#if-oracle-does-not-work-out).

### Open the ports at the tenancy level

This is separate from anything on the box, and forgetting it produces the single
most confusing failure in this whole setup.

**Networking → Virtual cloud networks →** your VCN **→ Security lists →**
the default list **→ Add ingress rules**

Add two, both stateless **off**, source CIDR `0.0.0.0/0`, IP protocol TCP:

| Destination port | For                                                   |
| ---------------- | ----------------------------------------------------- |
| 80               | HTTP, so Caddy can answer the Let's Encrypt challenge |
| 443              | HTTPS                                                 |

Port 22 is already open by default.

> **The symptom if you skip this:** `curl localhost` works when you are SSH'd
> into the box, `curl https://vinyl.is-a.dev` from your laptop hangs forever,
> and `sudo ufw status` on the box shows 80 and 443 as ALLOW. Everything looks
> correct because the block is one layer above everything you can see.

Note the instance's **public IPv4 address**. You need it twice below.

---

## 3. Point the domain at it

`vinyl.is-a.dev` is free, and you get it by opening a pull request against
[is-a-dev/register](https://github.com/is-a-dev/register).

> **Open this pull request yourself, by hand.** Their maintainers reject
> AI-generated pull requests. Everything you need is below; the writing has to
> be yours.

Fork the repository and add one file, `domains/vinyl.json`:

```json
{
  "owner": {
    "username": "Anddep",
    "email": "your@address.here"
  },
  "record": {
    "A": ["YOUR.INSTANCE.PUBLIC.IP"]
  }
}
```

If your instance has a public IPv6 address, add it too:

```json
{
  "owner": {
    "username": "Anddep",
    "email": "your@address.here"
  },
  "record": {
    "A": ["YOUR.INSTANCE.PUBLIC.IP"],
    "AAAA": ["YOUR:INSTANCE:PUBLIC:IPV6"]
  }
}
```

Check the name is actually free before you write the PR — open
`https://github.com/is-a-dev/register/blob/main/domains/vinyl.json` and confirm
it 404s. Short dictionary words are also the most likely to be on their reserved
list. `groovesanddust` is the fallback if `vinyl` is refused; if you use it,
substitute it everywhere below.

**Wait for the pull request to merge and for DNS to resolve before you deploy.**

```bash
dig +short vinyl.is-a.dev
```

That must print your instance's IP. Caddy requests its certificate on the first
request it receives, so deploying before DNS resolves burns an attempt against
Let's Encrypt's rate limit for nothing.

---

## 4. Generate the secrets

Run these on your laptop. Each value goes to exactly one place, and the halves
of the SSH key go to two different places — that is the part worth being careful
about.

### Session secret

```bash
openssl rand -hex 32
```

Hex rather than base64, because base64 can contain `$` and Docker Compose
interpolates `$` in an env file — a secret that silently loses its tail is worse
than one that is obviously wrong. Goes into the box's `.env` only.

### Database password

```bash
openssl rand -base64 24 | tr -d '/+=' | head -c 32; echo
```

Goes into the box's `.env` only, in two places: `POSTGRES_PASSWORD` and inside
`DATABASE_URL`.

### SSH deploy key

A key that exists only for this pipeline, separate from the one you log in with.

```bash
ssh-keygen -t ed25519 -C 'vinyl-lib github actions deploy' -f ~/.ssh/vinyl-deploy -N ''
```

That writes two files, and they go to opposite ends:

| File                               | Goes to                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `~/.ssh/vinyl-deploy` (private)    | GitHub → Environment `production` → secret `SSH_KEY` |
| `~/.ssh/vinyl-deploy.pub` (public) | the box, in `/opt/vinyl-lib/.ssh/authorized_keys`    |

Print the private half to copy it into GitHub:

```bash
cat ~/.ssh/vinyl-deploy
```

Copy the whole thing including the `BEGIN`/`END` lines.

---

## 5. Register the OAuth callbacks

Both providers need to know the public URL, exactly.

**Google** — Cloud Console → APIs & Services → Credentials → your OAuth client →
Authorised redirect URIs → add:

```
https://vinyl.is-a.dev/api/auth/google/callback
```

**GitHub** — Settings → Developer settings → OAuth Apps → your app →
Authorization callback URL:

```
https://vinyl.is-a.dev/api/auth/github/callback
```

Keep the existing `http://localhost:5173/...` entries. Google allows several
redirect URIs on one client, so development keeps working. GitHub allows only
one callback URL per app, so if you want both you need a second OAuth app for
production, with its own id and secret.

---

## 6. Set up the box

### Install the deploy key

SSH in as yourself:

```bash
ssh ubuntu@YOUR.INSTANCE.PUBLIC.IP
```

Create the directory the deploy user will own:

```bash
sudo install -d -m 0700 /opt/vinyl-lib/.ssh
```

Now the important line. Open the file:

```bash
sudo nano /opt/vinyl-lib/.ssh/authorized_keys
```

Paste **one line**: the restrictions, then a space, then the entire contents of
`~/.ssh/vinyl-deploy.pub` from your laptop.

```
command="/opt/vinyl-lib/remote-deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding,no-user-rc ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... vinyl-lib github actions deploy
```

> **What the `command=` part buys you.** The deploy user has to be in the
> `docker` group, and docker group membership is root-equivalent — a member can
> bind-mount the whole filesystem into a privileged container. There is no way
> to grant "may restart containers" without granting that.
>
> So the thing limiting the damage is not what the user _could_ do, it is what
> the key can _invoke_. With this line, a stolen `SSH_KEY` can deploy an
> already-built image and nothing else. Without it, a stolen `SSH_KEY` is root
> on this machine.
>
> If you ever find yourself removing it to debug something, put it back.

### Run the bootstrap script

Copy it up from your laptop:

```bash
scp deploy/bootstrap.sh deploy/remote-deploy.sh ubuntu@YOUR.INSTANCE.PUBLIC.IP:/tmp/
```

On the box:

```bash
sudo install -m 0755 -o deploy -g deploy /tmp/remote-deploy.sh /opt/vinyl-lib/remote-deploy.sh
```

```bash
sudo bash /tmp/bootstrap.sh
```

It installs Docker, sets up the firewall in both the places that matter, adds
swap, hardens SSH, and turns on automatic security updates. It is safe to run
again at any time, and it refuses to touch the SSH configuration unless the
deploy key is already in place — so if you skipped the previous step, it will
tell you rather than lock you out.

### Write the environment file

```bash
sudo -u deploy nano /opt/vinyl-lib/.env
```

Paste this, substituting the generated values:

```bash
NODE_ENV=production

SERVER_PORT=4000

POSTGRES_USER=vinyl_lib
POSTGRES_PASSWORD=THE_GENERATED_DATABASE_PASSWORD
POSTGRES_DB=vinyl_lib
DATABASE_URL=postgresql://vinyl_lib:THE_GENERATED_DATABASE_PASSWORD@db:5432/vinyl_lib?schema=public

SITE_ADDRESS=vinyl.is-a.dev
PUBLIC_BASE_URL=https://vinyl.is-a.dev

SESSION_SECRET=THE_GENERATED_SESSION_SECRET

# Two proxies: Caddy terminates TLS, then the client nginx. Not 1, or the
# per-IP rate limits all share one bucket and sign-in silently fails.
TRUST_PROXY_HOPS=2

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Set this to your own address BEFORE you sign in for the first time, or the
# existing collection stays unclaimed.
BOOTSTRAP_OWNER_EMAIL=your@address.here

# Stays invite. A public deployment is exactly the situation this gate is for.
SIGNUP_MODE=invite
```

Lock it down:

```bash
sudo chmod 600 /opt/vinyl-lib/.env
```

```bash
sudo chown deploy:deploy /opt/vinyl-lib/.env
```

This file never goes near GitHub. No workflow reads it, writes it, or is given
it — which means somebody who takes over your GitHub account can deploy
arbitrary images, but cannot read your OAuth client secrets or your session
secret.

---

## 7. Tell GitHub how to reach it

**Settings → Environments → New environment →** name it `production`.

Add four **secrets**:

| Secret            | Value                                             |
| ----------------- | ------------------------------------------------- |
| `SSH_HOST`        | your instance's public IPv4                       |
| `SSH_USER`        | `deploy`                                          |
| `SSH_KEY`         | the entire private key from `~/.ssh/vinyl-deploy` |
| `SSH_KNOWN_HOSTS` | see below                                         |

Get the known-hosts value by running this on your laptop:

```bash
ssh-keyscan -t ed25519 YOUR.INSTANCE.PUBLIC.IP
```

Paste the output line as `SSH_KNOWN_HOSTS`.

> Pinning the host key is why the deploy never uses
> `StrictHostKeyChecking=no`. That option accepts whatever key answers, on every
> run, which means anyone who can get between GitHub and your box gets handed
> your deploy key. Pinning it costs one command, once.

---

## Deploying

Push to `main`.

```bash
git push origin main
```

CI runs, then Build produces arm64 images and pushes them to GHCR, then Deploy
SSHes to the box, pulls the new images by digest, dumps the database, applies
migrations, restarts the containers, and waits for
`https://vinyl.is-a.dev/api/health` to answer. If it does not answer, it puts
the previous version back and fails loudly.

To deploy a specific commit by hand — this is also how you roll back:

**Actions → Deploy → Run workflow →** paste a 40-character commit SHA.

---

## Rolling back

```
Actions → Deploy → Run workflow → <the SHA of the last good commit>
```

Any commit that ever produced images can be deployed; the digests are looked up
in the registry rather than remembered anywhere.

### The part that rolling back does not fix

**An image rollback does not roll back a database migration.** Prisma migrations
are forward-only — there is no down migration and Prisma does not generate one —
so putting the old image back leaves it running against a newer schema.

That is fine when the migration only _added_ things: a new nullable column, a
new table, a new index. The old code simply does not know about them.

It is not fine when a migration **dropped or renamed** a column the old code
still selects. Then the rollback restores an image that errors on every request,
and the automatic health check fails too.

**So: any migration that drops or renames anything gets split across two
deploys.** First deploy stops using the column. A later deploy removes it. If
you follow that rule, the paragraph below never matters.

### If you did not follow that rule

On the box:

```bash
cd /opt/vinyl-lib
```

Find the dump taken immediately before the bad migration:

```bash
ls -lt pre-migrate/
```

Stop the application, leaving the database up:

```bash
sudo -u deploy docker compose -f docker-compose.deploy.yml stop server client
```

Restore it:

```bash
gunzip -c pre-migrate/THE_ONE_YOU_WANT.sql.gz | sudo -u deploy docker compose -f docker-compose.deploy.yml exec -T db psql -U vinyl_lib -d vinyl_lib
```

Then deploy the previous commit from the Actions tab.

> Those dumps are **not backups**. They live on the same disk as the database,
> they only exist from the moment of a deploy, and they do not contain your
> uploaded cover images. They exist so that this one recovery is possible.

---

## Rotating things

### The session secret

Do this if you ever think it has leaked. Everyone gets signed out, which is the
point.

```bash
openssl rand -hex 32
```

Put it in `/opt/vinyl-lib/.env`, then:

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml up -d server
```

> `up -d`, **not** `restart`. Compose reuses the old container environment on
> `restart`, so the rotation would appear to work and change nothing.

### The deploy key

Order matters here. Test the new key _before_ removing the old one, or the
pipeline locks itself out of the server it is supposed to deploy to.

Generate a replacement:

```bash
ssh-keygen -t ed25519 -C 'vinyl-lib deploy rotated' -f ~/.ssh/vinyl-deploy-new -N ''
```

Add its public half as a **second line** in `/opt/vinyl-lib/.ssh/authorized_keys`,
with the same `command="..."` restrictions as the first.

Update the `SSH_KEY` secret to the new private key.

Run a manual deploy from the Actions tab and confirm it succeeds.

**Only then** delete the old line from `authorized_keys`.

### The database password

Both statements, in this order — the running server holds a connection pool that
survives the `ALTER` and would otherwise hide the mistake until the next
restart.

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml exec db psql -U vinyl_lib -c "ALTER USER vinyl_lib WITH PASSWORD 'THE_NEW_ONE';"
```

Update both `POSTGRES_PASSWORD` and `DATABASE_URL` in `.env`, then:

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml up -d
```

### An OAuth client secret

Generate a new one at the provider first — both Google and GitHub let a new
secret exist before the old one is revoked, so there is no outage if you do it
in this order. Put it in `.env`, then `up -d`, then revoke the old one.

---

## Changing the domain

The public origin is one value in three places. Leave the old DNS record in
place until the new certificate is issued and there is no downtime at all.

1. **Create the new DNS record**, pointing at the same IP. Wait for it:

   ```bash
   dig +short newname.example.com
   ```

2. **Edit `/opt/vinyl-lib/.env`** — two lines:

   ```bash
   SITE_ADDRESS=newname.example.com
   PUBLIC_BASE_URL=https://newname.example.com
   ```

3. **Register the new callbacks** at Google and GitHub:

   ```
   https://newname.example.com/api/auth/google/callback
   https://newname.example.com/api/auth/github/callback
   ```

4. **Restart**, which is when Caddy requests the new certificate:

   ```bash
   cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml up -d
   ```

5. **Check it**:

   ```bash
   curl -I https://newname.example.com/api/health
   ```

6. **Then** remove the old DNS record and the old OAuth callback URLs.

---

## When something is wrong

### The site hangs from outside, but works on the box

`curl localhost` on the box succeeds, `curl https://vinyl.is-a.dev` from your
laptop hangs, and `sudo ufw status` shows 80 and 443 allowed.

It is the OCI security list, one layer above anything on the box. See
[Open the ports at the tenancy level](#open-the-ports-at-the-tenancy-level).

### No certificate / browser warns about HTTPS

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml logs caddy --tail 50
```

Two usual causes:

- **DNS did not resolve when Caddy first asked.** Confirm `dig +short
vinyl.is-a.dev` returns your IP, then restart Caddy.
- **You have hit Let's Encrypt's rate limit.** Five duplicate certificates per
  week for the same name. Running `docker compose down -v` repeatedly destroys
  the `caddy-data` volume and burns one attempt each time. The only cure is
  waiting for the window to roll.

> This is why `caddy-data` is a named volume. Do not `down -v` on this box
> casually — it deletes your database too.

### Sign-in does nothing, or bounces back with no error

Almost always `TRUST_PROXY_HOPS`. If it is not 2, Express thinks the request
arrived over plain HTTP, refuses to send a `Secure` cookie, and the sign-in
completes with the browser never receiving a session.

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml exec server printenv TRUST_PROXY_HOPS
```

Must print `2`. If it prints nothing, the variable is in `.env` but missing from
the `environment:` list in `docker-compose.deploy.yml` — that file whitelists
what reaches the container, and an unlisted variable never arrives.

`?error=state` in the URL instead means the callback URL registered at the
provider does not match `PUBLIC_BASE_URL` exactly.

### A variable in `.env` is not reaching the container

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml exec server printenv | sort
```

If it is absent, add it to the `environment:` list in
`docker-compose.deploy.yml`. Then `up -d`, never `restart`.

### The deploy failed

Read the job log in the Actions tab first — `remote-deploy.sh` logs each step
and says explicitly whether it rolled back.

On the box:

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml logs --tail 100
```

What is currently deployed:

```bash
cat /opt/vinyl-lib/.images
```

What was deployed before that:

```bash
cat /opt/vinyl-lib/.images.prev
```

### The disk is full

```bash
df -h /
```

```bash
docker system prune -a --volumes=false
```

`--volumes=false` matters: without it you delete the database.

Container logs are capped at 10 MB × 3 per container by the Docker daemon
configuration, so they are usually not the cause. The usual cause is old images.

---

## What has no backup

**There is no backup of your data.** This was a deliberate choice, and this
section exists so it is not a surprise.

Your records, wishlist, setup rows, accounts, and every uploaded cover image
exist in exactly one place: two Docker volumes on one virtual machine. If that
machine is lost, all of it is lost.

That matters more than usual here, because Oracle **reclaims Always Free
instances that sit idle**, and a personal vinyl site is by nature quiet. The
most likely way this deployment ends is Oracle reclaiming an idle instance, with
no copy of the data anywhere.

What _is_ reproducible: everything except the data. The scripts are in git, the
images are in GHCR, and rebuilding the host is `bootstrap.sh`, an `.env`, and
one manual deploy — about twenty minutes.

If you want a copy, the manual recipes still work. On the box:

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml exec -T db pg_dump -U vinyl_lib vinyl_lib | gzip > ~/vinyl-$(date -u +%F).sql.gz
```

The uploaded images are in a **different volume** and are not in that dump:

```bash
cd /opt/vinyl-lib && sudo -u deploy docker compose -f docker-compose.deploy.yml cp server:/app/server/uploads ~/vinyl-uploads
```

Then pull both to your laptop:

```bash
scp -r ubuntu@YOUR.INSTANCE.PUBLIC.IP:'~/vinyl-*' ./
```

Automating this properly is roughly an hour of work — a `pg_dump` plus a tar of
the uploads volume, `age`-encrypted, on a systemd timer, and a script to pull it
down. It needs no third-party account and no credentials on the box. Section
11.3 of the design document sketches it.

### Reducing the reclamation risk

Upgrading the Oracle account to **Pay As You Go** keeps every Always Free
resource free but exempts it from idle reclamation. It also puts a real card on
file, so anything provisioned beyond the free allowance becomes billable. That
trade was declined when this was designed; it remains the escape hatch if an
instance actually gets reclaimed.

---

## If Oracle does not work out

Nothing in this repository knows it is running on Oracle. The one Oracle-shaped
step in `bootstrap.sh` clears a firewall ruleset their images ship, and it does
nothing on a host that does not have it.

To move to Hetzner (a CAX11 is arm64 and about €4/month), or to any Ubuntu
24.04 box with SSH:

1. Create the server.
2. Update the DNS record.
3. Install the deploy key with the same `command="..."` line.
4. Run `bootstrap.sh`.
5. Write `/opt/vinyl-lib/.env`.
6. Update `SSH_HOST` and `SSH_KNOWN_HOSTS` in the `production` environment.
7. Run a manual deploy.

No file in this repository changes. Hetzner has no equivalent of the OCI
security list, so that step simply does not apply.

---

## Follow-ups

Things deliberately left for later, recorded so they are not forgotten.

- **Consider backups.** See [What has no backup](#what-has-no-backup).
