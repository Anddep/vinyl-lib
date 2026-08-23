#!/usr/bin/env bash
#
# The SSH forced-command target. CI never gets a shell on this box; it gets
# this script, and this script only runs what the pattern below allows.
#
# Installed as the deploy user's only way in:
#
#   command="/opt/vinyl-lib/remote-deploy.sh",no-agent-forwarding,
#   no-port-forwarding,no-pty,no-X11-forwarding,no-user-rc ssh-ed25519 AAAA...
#
# Why a forced command rather than the usual from= address restriction:
# GitHub-hosted runners have no stable, narrow IP range — the ranges published
# at api.github.com/meta are enormous and change without notice — so a from=
# listing them would be theatre with a maintenance burden.
#
# And this restriction is load-bearing in a way from= would not have been. The
# deploy user is in the docker group, which is root-equivalent without
# qualification: a member can bind-mount / into a privileged container. So the
# blast radius of a leaked SSH_KEY is defined by what the key can INVOKE. With a
# shell, a leaked key is root on this box. With this, it can deploy an
# already-built image digest and read this script's output. If you ever relax
# the authorized_keys line "just for a minute", you have converted one into the
# other.
#
# Invoked as:
#   ssh deploy@host "deploy <sha> <client-digest> <server-digest>" < config.tar

set -euo pipefail

DEPLOY_DIR=/opt/vinyl-lib
IMAGES_FILE="${DEPLOY_DIR}/.images"
IMAGES_PREV="${DEPLOY_DIR}/.images.prev"
ENV_FILE="${DEPLOY_DIR}/.env"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.deploy.yml"
PRE_MIGRATE_DIR="${DEPLOY_DIR}/pre-migrate"
KEEP_DUMPS=5
HEALTH_ATTEMPTS=30
HEALTH_INTERVAL=2

CLIENT_REPO=ghcr.io/anddep/vinyl-lib-client
SERVER_REPO=ghcr.io/anddep/vinyl-lib-server

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

compose() {
  docker compose --env-file "${ENV_FILE}" --env-file "${IMAGES_FILE}" \
    -f "${COMPOSE_FILE}" --project-directory "${DEPLOY_DIR}" "$@"
}

# ---------------------------------------------------------------------------
# 1. Validate the request. This is the whole security boundary.
# ---------------------------------------------------------------------------
REQUEST="${SSH_ORIGINAL_COMMAND:-}"

if [[ ! "${REQUEST}" =~ ^deploy\ [0-9a-f]{40}\ sha256:[0-9a-f]{64}\ sha256:[0-9a-f]{64}$ ]]; then
  # Logged so an attempt is visible in the journal, but never echoed back in a
  # way that would help someone probe for what the pattern accepts.
  logger -t vinyl-deploy "rejected command: ${REQUEST:0:120}"
  die "this key may only deploy. Expected:
    deploy <40-hex-sha> <sha256:...client> <sha256:...server>"
fi

read -r _ SHA CLIENT_DIGEST SERVER_DIGEST <<< "${REQUEST}"

log "Deploying ${SHA}"
info "client ${CLIENT_DIGEST}"
info "server ${SERVER_DIGEST}"

[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} is missing. It is written by hand, once — see DEPLOYMENT.md."

# ---------------------------------------------------------------------------
# 2. Install the topology from stdin.
# ---------------------------------------------------------------------------
# A forced command still receives stdin, which is how the compose file and the
# Caddyfile ship with the deploy while the key still cannot open a shell.
#
# Only the two expected names are accepted, and only as plain files in the
# archive root — a member called ../../etc/cron.d/anything would otherwise be a
# straightforward path to arbitrary root code via the docker group.
log "Installing configuration"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

# Buffered to a file rather than extracted straight from the pipe, so the member
# list can be inspected BEFORE anything is written. Extracting first and checking
# afterwards would be no check at all: a member named ../../etc/cron.d/anything
# is already on disk by the time you look, and this user is in the docker group.
ARCHIVE="${STAGE}/config.tar"
cat > "${ARCHIVE}"
[[ -s "${ARCHIVE}" ]] || die "no configuration archive arrived on stdin"

while IFS= read -r member; do
  case "${member}" in
    docker-compose.deploy.yml|Caddyfile) ;;
    *) die "unexpected member in the configuration archive: ${member}" ;;
  esac
done < <(tar -tf "${ARCHIVE}" || die "could not read the configuration archive")

tar -xf "${ARCHIVE}" -C "${STAGE}"
rm -f "${ARCHIVE}"

[[ -f "${STAGE}/docker-compose.deploy.yml" ]] || die "archive has no docker-compose.deploy.yml"
[[ -f "${STAGE}/Caddyfile" ]] || die "archive has no Caddyfile"

# Write the new digests before validating, because `compose config` resolves
# ${CLIENT_IMAGE} and would fail on an unset variable otherwise.
cat > "${STAGE}/.images" <<EOF
CLIENT_IMAGE=${CLIENT_REPO}@${CLIENT_DIGEST}
SERVER_IMAGE=${SERVER_REPO}@${SERVER_DIGEST}
EOF

docker compose --env-file "${ENV_FILE}" --env-file "${STAGE}/.images" \
  -f "${STAGE}/docker-compose.deploy.yml" --project-directory "${DEPLOY_DIR}" config -q \
  || die "the compose file in this archive is not valid — nothing has changed"

# ---------------------------------------------------------------------------
# 3. Record what is running now, before anything changes.
# ---------------------------------------------------------------------------
# This file is what the rollback in step 9 reads. It has to be written before
# the pull, not after, or a failed deploy has nothing to go back to.
if [[ -f "${IMAGES_FILE}" ]]; then
  cp "${IMAGES_FILE}" "${IMAGES_PREV}"
  info "previous digests recorded"
else
  # First deploy: there is no previous. Roll back to the new ones, i.e. nothing.
  cp "${STAGE}/.images" "${IMAGES_PREV}"
  info "first deploy — no previous digests to record"
fi

install -m 0644 "${STAGE}/docker-compose.deploy.yml" "${COMPOSE_FILE}"
install -m 0644 "${STAGE}/Caddyfile" "${DEPLOY_DIR}/Caddyfile"
install -m 0644 "${STAGE}/.images" "${IMAGES_FILE}"

# ---------------------------------------------------------------------------
# 4. Pull.
# ---------------------------------------------------------------------------
# Failing here means a bad digest or a registry problem, and nothing has changed
# yet — so exit without rolling back. There is nothing to roll back to.
log "Pulling images"
compose pull --quiet || die "pull failed — the running stack is untouched"

# ---------------------------------------------------------------------------
# 5. Database up first, so the migration has something to talk to.
# ---------------------------------------------------------------------------
log "Bringing the database up"
compose up -d --wait db

# ---------------------------------------------------------------------------
# 6. Dump before migrating.
# ---------------------------------------------------------------------------
# THIS IS NOT A BACKUP. It lives on the same disk as the database it dumps, it
# captures nothing between deploys, and it does not include the uploads volume.
# It exists so that a migration which cannot be rolled back by restoring the
# previous image (see DEPLOYMENT.md) has something to restore instead.
log "Dumping the database before migrating"
mkdir -p "${PRE_MIGRATE_DIR}"
DUMP="${PRE_MIGRATE_DIR}/$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:8}.sql.gz"
# shellcheck disable=SC1090
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "${ENV_FILE}" | cut -d= -f2-)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' "${ENV_FILE}" | cut -d= -f2-)"
compose exec -T db pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${DUMP}"
info "$(du -h "${DUMP}" | cut -f1) -> ${DUMP}"

# Keep the newest few; this directory is on the boot volume with everything else.
# shellcheck disable=SC2012  # names are generated above: timestamp + sha prefix
ls -1t "${PRE_MIGRATE_DIR}"/*.sql.gz 2>/dev/null | tail -n +$((KEEP_DUMPS + 1)) | xargs -r rm -f

# ---------------------------------------------------------------------------
# 7. Migrate, before the new server starts.
# ---------------------------------------------------------------------------
# `migrate deploy`, never `migrate dev`: dev is interactive, can generate a
# migration from a schema diff, and can reset the database.
log "Applying migrations"
compose run --rm --no-deps server npx prisma migrate deploy \
  || die "migration failed — the previous server is still running against the old schema"

# ---------------------------------------------------------------------------
# 8. Up.
# ---------------------------------------------------------------------------
# `up -d`, never `restart`. restart reuses the container's existing environment,
# so a changed .env or a changed image appears to deploy and changes nothing.
log "Starting the new containers"
compose up -d --remove-orphans

# ---------------------------------------------------------------------------
# 9. Health gate, and the rollback if it does not answer.
# ---------------------------------------------------------------------------
# Through the public URL rather than localhost: that path exercises DNS, Caddy,
# TLS, nginx, Express and Postgres, which is the thing being claimed to work.
PUBLIC_BASE_URL="$(grep -E '^PUBLIC_BASE_URL=' "${ENV_FILE}" | cut -d= -f2-)"

healthy() {
  local i
  for ((i = 1; i <= HEALTH_ATTEMPTS; i++)); do
    if curl -fsS --max-time 5 "${PUBLIC_BASE_URL}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
      info "healthy after ${i} attempt(s)"
      return 0
    fi
    sleep "${HEALTH_INTERVAL}"
  done
  return 1
}

log "Waiting for ${PUBLIC_BASE_URL}/api/health"
if healthy; then
  log "Deployed ${SHA}"
  exit 0
fi

# ---------------------------------------------------------------------------
log "UNHEALTHY — rolling back"
# ---------------------------------------------------------------------------
info "restoring $(grep SERVER_IMAGE "${IMAGES_PREV}" | cut -d@ -f2)"
cp "${IMAGES_PREV}" "${IMAGES_FILE}"
compose up -d --remove-orphans

if healthy; then
  die "deploy of ${SHA} failed its health check; rolled back and the site is up"
fi

die "deploy of ${SHA} failed AND the rollback did not come back healthy.
    The site is down. Check:  docker compose -f ${COMPOSE_FILE} logs --tail 100"
