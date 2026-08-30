#!/usr/bin/env bash
#
# Harden a fresh Ubuntu 24.04 box and install everything the deployment needs.
#
# Run as root, on the VM, once — and again whenever you want. Every step is
# idempotent, because this script is also how the box gets rebuilt after a
# reclaim, and a script that only works on a pristine system is a script nobody
# dares run twice.
#
#   sudo ./bootstrap.sh
#
# Deliberately host-agnostic. Nothing here knows it is on Oracle except step 8,
# which clears a ruleset Oracle's images ship and does nothing anywhere else.
# The same script prepares a Hetzner box, or any Ubuntu machine with SSH.
#
# What it does NOT do, on purpose:
#   - create or touch .env. That is yours, by hand, mode 0600.
#   - install the deploy key. Also yours — see DEPLOYMENT.md for the
#     authorized_keys line, which carries a forced command that matters.
#   - open the cloud provider's own firewall. On OCI the VCN security list is a
#     separate layer this script cannot reach.

set -euo pipefail

DEPLOY_USER=deploy
DEPLOY_HOME=/opt/vinyl-lib
SWAP_FILE=/swapfile
SWAP_SIZE_MB=4096
TIMEZONE=Europe/Kyiv
# The cloud image's default sudo user, kept in AllowUsers so you do not lock
# yourself out. Override if your image calls it something else.
ADMIN_USER="${ADMIN_USER:-ubuntu}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
skip() { printf '    (already done: %s)\n' "$*"; }
warn() { printf '\033[33m    warning: %s\033[0m\n' "$*"; }
die()  { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

[[ ${EUID} -eq 0 ]] || die "run this as root: sudo $0"

if ! grep -q 'VERSION_ID="24.04"' /etc/os-release 2>/dev/null; then
  warn "not Ubuntu 24.04 — continuing, but this is only tested there"
fi

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
log "1/12  Base packages"
# ---------------------------------------------------------------------------
apt-get update -qq
# Note what is NOT here: iptables-persistent. On Ubuntu 24.04 it cannot be
# installed alongside ufw — ufw pulls the nftables-backed iptables stack and
# iptables-persistent wants the legacy one, so apt refuses the transaction with
# "held broken packages" and the whole bootstrap dies at step 1. Confirmed by
# bisecting the package set: every pair installs except `ufw
# iptables-persistent`.
#
# Nothing is lost. It only saves rules across reboots, and nothing here depends
# on that: the DOCKER-USER rules are reinstated by vinyl-docker-firewall.service
# after every Docker start (step 9), and ufw persists its own rules through its
# own service.
apt-get install -y -qq \
  ca-certificates curl gnupg \
  ufw fail2ban unattended-upgrades

# ---------------------------------------------------------------------------
log "2/12  Docker CE"
# ---------------------------------------------------------------------------
# Docker's own repository, not Ubuntu's docker.io: the distribution package lags
# badly and ships no compose v2, which is the thing this whole deployment is
# built on.
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
else
  skip "docker apt key"
fi

if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
else
  skip "docker apt source"
fi

apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# ---------------------------------------------------------------------------
log "3/12  Timezone"
# ---------------------------------------------------------------------------
# So the unattended-upgrades reboot window in step 11 means what it says.
if [[ "$(timedatectl show -p Timezone --value)" != "${TIMEZONE}" ]]; then
  timedatectl set-timezone "${TIMEZONE}"
else
  skip "timezone is ${TIMEZONE}"
fi

# ---------------------------------------------------------------------------
log "4/12  The deploy user"
# ---------------------------------------------------------------------------
# Membership of the docker group is ROOT-EQUIVALENT. A member can run
#   docker run -v /:/host --privileged ...
# and own the machine. There is no way to grant "may restart containers" without
# granting that, short of a socket proxy that is more moving parts than it is
# worth here.
#
# What contains it is the forced command on this user's authorized_keys entry
# (see DEPLOYMENT.md): the CI key can invoke remote-deploy.sh and nothing else,
# so a leaked key is a deploy credential rather than a root credential. If you
# ever relax that restriction "just for a minute", you have converted one into
# the other.
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${DEPLOY_HOME}" --shell /bin/bash "${DEPLOY_USER}"
else
  skip "user ${DEPLOY_USER} exists"
fi
# -f so this is a no-op when docker-ce has already created it. Without the
# group the usermod below aborts the whole script under `set -e`, which would
# make a half-finished Docker install unrecoverable by re-running.
groupadd -f docker
usermod -aG docker "${DEPLOY_USER}"

install -d -m 0755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_HOME}"
install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_HOME}/pre-migrate"
install -d -m 0700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh"

# ---------------------------------------------------------------------------
log "5/12  Docker daemon configuration"
# ---------------------------------------------------------------------------
# live-restore keeps containers running while the daemon itself restarts, which
# turns a Docker package upgrade from an outage into a non-event.
#
# Log rotation is not housekeeping, it is a data-integrity control. morgan
# writes a line per request in 'combined' format, the default json-file driver
# has NO rotation at all, and the boot volume is shared with the Postgres data
# volume. An unrotated log grows until the disk is full, and a full disk does
# not stop nginx — it stops Postgres writing, mid-transaction.
DAEMON_JSON=/etc/docker/daemon.json
DAEMON_WANT='{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}'
install -d -m 0755 /etc/docker
if [[ ! -f "${DAEMON_JSON}" ]] || ! diff -q <(echo "${DAEMON_WANT}") "${DAEMON_JSON}" >/dev/null 2>&1; then
  echo "${DAEMON_WANT}" > "${DAEMON_JSON}"
  systemctl restart docker
else
  skip "daemon.json already correct"
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
log "5b/12  Reclaim memory on a small host"
# ---------------------------------------------------------------------------
# Only on machines small enough for it to matter. On anything with 2 GB or more
# these services cost nothing worth having, so leave them alone.
#
# On a 1 GB always-free instance they are a meaningful share of the machine:
# measured on a stock GCP Ubuntu 24.04 image, these four total roughly 140 MB of
# the 955 MB available, which is the difference between the stack fitting and
# the stack swapping.
#
# google-guest-agent is deliberately NOT touched: it propagates SSH keys from
# the cloud metadata service, and disabling it locks you out at the next key
# change.
TOTAL_MB="$(free -m | awk '/^Mem:/{print $2}')"
if [[ "${TOTAL_MB}" -lt 2048 ]]; then
  echo "    ${TOTAL_MB} MB of RAM — trimming services this deployment does not use"

  # Patch management from the cloud provider, duplicating unattended-upgrades.
  if systemctl list-unit-files google-osconfig-agent.service >/dev/null 2>&1; then
    systemctl disable --now google-osconfig-agent.service >/dev/null 2>&1 || true
    echo "      google-osconfig-agent disabled (~50 MB)"
  fi

  # Multipath SCSI. One disk, one path.
  if systemctl list-unit-files multipathd.service >/dev/null 2>&1; then
    systemctl disable --now multipathd.service multipathd.socket >/dev/null 2>&1 || true
    echo "      multipathd disabled (~27 MB)"
  fi

  # Hook dispatcher for network events. Nothing here subscribes to them.
  if systemctl list-unit-files networkd-dispatcher.service >/dev/null 2>&1; then
    systemctl disable --now networkd-dispatcher.service >/dev/null 2>&1 || true
    echo "      networkd-dispatcher disabled (~20 MB)"
  fi

  # snapd, plus whatever snaps the image shipped. Everything this deployment
  # needs comes from apt or from a container, and the cloud CLI is not run here.
  if command -v snap >/dev/null 2>&1; then
    for snap_name in $(snap list 2>/dev/null | awk 'NR>1{print $1}' | grep -v '^snapd$'); do
      snap remove --purge "${snap_name}" >/dev/null 2>&1 || true
    done
    snap remove --purge snapd >/dev/null 2>&1 || true
    systemctl disable --now snapd.service snapd.socket snapd.seeded.service >/dev/null 2>&1 || true
    apt-get purge -y -qq snapd >/dev/null 2>&1 || true
    rm -rf /var/cache/snapd /root/snap
    echo "      snapd removed (~42 MB, plus disk)"
  fi
else
  skip "${TOTAL_MB} MB of RAM — no need to trim services"
fi

# ---------------------------------------------------------------------------
log "6/12  Swap"
# ---------------------------------------------------------------------------
# Neither OCI's nor Hetzner's images configure any.
#
# This is not for builds — nothing builds here, that is the whole point of
# building in CI. It is for Postgres. Under a burst of concurrent requests
# Postgres allocates work memory per connection, and on a box with no swap the
# kernel's answer to exhaustion is the OOM killer, which reliably picks the
# largest process. That is Postgres. Swap turns a kill into a slowdown.
#
# swappiness=10 keeps it as the emergency it is rather than something the kernel
# reaches for casually.
if [[ ! -f "${SWAP_FILE}" ]]; then
  fallocate -l "${SWAP_SIZE_MB}M" "${SWAP_FILE}" 2>/dev/null || \
    dd if=/dev/zero of="${SWAP_FILE}" bs=1M count="${SWAP_SIZE_MB}" status=none
  chmod 600 "${SWAP_FILE}"
  mkswap "${SWAP_FILE}" >/dev/null
  swapon "${SWAP_FILE}"
else
  skip "swap file exists"
  swapon "${SWAP_FILE}" 2>/dev/null || true
fi

grep -q "^${SWAP_FILE} " /etc/fstab || echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-vinyl-swappiness.conf
sysctl -q -w vm.swappiness=10

# ---------------------------------------------------------------------------
log "7/12  SSH hardening"
# ---------------------------------------------------------------------------
# THE GUARD BELOW IS THE IMPORTANT PART. Turning off password authentication on
# a box with no working key installed is the single most common way to lose a
# server permanently, and one check prevents it.
AUTH_KEYS="${DEPLOY_HOME}/.ssh/authorized_keys"

# Fix the ownership before checking anything else. sshd drops to the target user
# to read this file, so a root-owned 0600 authorized_keys is unreadable by the
# very user it authorises — and the failure is reported as "Permission denied
# (publickey)", which looks like a wrong key rather than a wrong owner. Anyone
# who created it with `sudo nano` or `sudo tee` lands here.
if [[ -e "${AUTH_KEYS}" ]]; then
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${AUTH_KEYS}"
  chmod 600 "${AUTH_KEYS}"
fi

if [[ ! -s "${AUTH_KEYS}" ]]; then
  die "no key in ${AUTH_KEYS}.
    Install the deploy public key first (DEPLOYMENT.md has the exact line,
    including the forced command). Refusing to disable password authentication
    while there is no key that could get back in."
fi

# A drop-in, not an edit to sshd_config, so a distribution upgrade cannot
# quietly revert it.
SSHD_DROPIN=/etc/ssh/sshd_config.d/99-hardening.conf
cat > "${SSHD_DROPIN}" <<EOF
# Managed by deploy/bootstrap.sh. Edits here are overwritten on the next run.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
AllowUsers ${DEPLOY_USER} ${ADMIN_USER}
EOF
chmod 0644 "${SSHD_DROPIN}"

# Validate before reloading. A syntax error plus a restart is a locked door.
sshd -t || die "sshd config invalid — not reloading, your session is safe"
systemctl reload ssh 2>/dev/null || systemctl reload sshd

# ---------------------------------------------------------------------------
log "8/12  Clear the ruleset Oracle's images ship"
# ---------------------------------------------------------------------------
# The one Oracle-specific step. Their Ubuntu images arrive with a populated
# netfilter-persistent ruleset whose INPUT chain ends in REJECT, permitting
# little beyond 22, and it sits ahead of anything UFW adds.
#
# The symptom is unmistakable once you have seen it and baffling before:
#   curl localhost      on the box  -> works
#   curl http://<ip>    from anywhere else -> hangs
#   ufw status          -> shows 80 and 443 ALLOW
#
# Finds nothing and does nothing on an image that does not have it.
if iptables -S INPUT 2>/dev/null | grep -qE '^-A INPUT.*(REJECT|DROP)' ; then
  iptables -P INPUT ACCEPT
  iptables -F INPUT
  ip6tables -P INPUT ACCEPT 2>/dev/null || true
  ip6tables -F INPUT 2>/dev/null || true
  echo "    cleared pre-existing INPUT rules; UFW now owns this chain"
else
  skip "no pre-existing INPUT reject rules"
fi

# ---------------------------------------------------------------------------
log "9/12  Firewall"
# ---------------------------------------------------------------------------
ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp  >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# UFW is necessary and NOT sufficient, and this is the sharpest edge on the box.
#
# Docker does not go through UFW's chains. It writes its own iptables rules, and
# they are evaluated first. A container published as 0.0.0.0:5432->5432 is
# reachable from the internet with a UFW `deny 5432` sitting right there looking
# like it is working.
#
# Defence one is docker-compose.deploy.yml, which publishes nothing but Caddy's
# 80 and 443. Defence two is here, because "publishes nothing" depends on nobody
# ever adding a ports: line to debug something and forgetting it.
#
# Docker consults DOCKER-USER before its own rules and never modifies it, which
# makes it the right place for a policy that should outlive a compose edit.
EXT_IF="$(ip route show default 2>/dev/null | awk '{print $5; exit}')"
[[ -n "${EXT_IF}" ]] || die "could not detect the external interface from the default route"
echo "    external interface: ${EXT_IF}"

install_docker_firewall() {
  # Rebuild a dedicated chain rather than appending to DOCKER-USER, because rule
  # ORDER is the whole thing here and appending twice would put the DROP before
  # the RETURNs on the second run.
  iptables -N VINYL-EDGE 2>/dev/null || true
  iptables -F VINYL-EDGE
  # Replies to connections we started must come back, or the box has no network.
  iptables -A VINYL-EDGE -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
  iptables -A VINYL-EDGE -p tcp -m multiport --dports 80,443 -j RETURN
  iptables -A VINYL-EDGE -j DROP

  # Exactly one jump, however many times this runs.
  while iptables -C DOCKER-USER -i "${EXT_IF}" -j VINYL-EDGE 2>/dev/null; do
    iptables -D DOCKER-USER -i "${EXT_IF}" -j VINYL-EDGE
  done
  iptables -I DOCKER-USER 1 -i "${EXT_IF}" -j VINYL-EDGE
}

# DOCKER-USER only exists once Docker has started at least once.
if iptables -S DOCKER-USER >/dev/null 2>&1; then
  install_docker_firewall
else
  warn "DOCKER-USER chain not present yet; it appears once Docker starts"
fi

# Reapplied after every Docker start, because Docker rebuilds its chains then
# and a rule saved to a file is not the same as a rule that is present.
cat > /usr/local/sbin/vinyl-docker-firewall <<EOF
#!/usr/bin/env bash
# Managed by deploy/bootstrap.sh.
set -euo pipefail
EXT_IF="\$(ip route show default | awk '{print \$5; exit}')"
iptables -N VINYL-EDGE 2>/dev/null || true
iptables -F VINYL-EDGE
iptables -A VINYL-EDGE -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A VINYL-EDGE -p tcp -m multiport --dports 80,443 -j RETURN
iptables -A VINYL-EDGE -j DROP
while iptables -C DOCKER-USER -i "\${EXT_IF}" -j VINYL-EDGE 2>/dev/null; do
  iptables -D DOCKER-USER -i "\${EXT_IF}" -j VINYL-EDGE
done
iptables -I DOCKER-USER 1 -i "\${EXT_IF}" -j VINYL-EDGE
EOF
chmod 0755 /usr/local/sbin/vinyl-docker-firewall

cat > /etc/systemd/system/vinyl-docker-firewall.service <<'EOF'
# Managed by deploy/bootstrap.sh.
#
# A saved iptables file is not enough: Docker rebuilds its chains on every
# start, so the DOCKER-USER jump has to be reinstated after it, not merely
# restored at boot.
[Unit]
Description=Restrict what Docker may publish to the internet
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/vinyl-docker-firewall

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now vinyl-docker-firewall.service >/dev/null 2>&1 || \
  warn "vinyl-docker-firewall did not start; check after Docker is up"

# ---------------------------------------------------------------------------
log "10/12  fail2ban"
# ---------------------------------------------------------------------------
# With password authentication off this is not stopping a credential guess —
# nobody can guess their way in. It stops the constant background noise of the
# internet from filling the journal and eating the CPU of a two-core box.
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
# Managed by deploy/bootstrap.sh.
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban >/dev/null 2>&1
systemctl reload fail2ban 2>/dev/null || systemctl restart fail2ban

# ---------------------------------------------------------------------------
log "11/12  Unattended security upgrades"
# ---------------------------------------------------------------------------
# The automatic reboot is deliberate. A kernel update that is downloaded but
# never activated is a patch that has not been applied. Every container carries
# restart: unless-stopped, so the stack comes back without help, and the cost is
# a few seconds of downtime on the occasional night at 04:30 local.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
# Managed by deploy/bootstrap.sh.
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

cat > /etc/apt/apt.conf.d/52unattended-upgrades-local <<'EOF'
# Managed by deploy/bootstrap.sh. Security origins only — this box should not
# take feature updates unattended, only fixes.
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
log "12/12  Done"
# ---------------------------------------------------------------------------
cat <<EOF

The box is hardened. What is running now:

  docker          $(docker --version 2>/dev/null | cut -d, -f1)
  compose         $(docker compose version --short 2>/dev/null)
  firewall        22, 80, 443 in; everything else dropped, including anything
                  Docker might publish on ${EXT_IF}
  swap            $(( SWAP_SIZE_MB / 1024 ))G at swappiness 10
  ssh             keys only, no root, ${DEPLOY_USER} and ${ADMIN_USER} only
  updates         security only, automatic, reboot at 04:30 ${TIMEZONE}

Still yours to do, by hand — see DEPLOYMENT.md:

  1. Write ${DEPLOY_HOME}/.env, owned by ${DEPLOY_USER}, mode 0600.
       chown ${DEPLOY_USER}:${DEPLOY_USER} ${DEPLOY_HOME}/.env
       chmod 600 ${DEPLOY_HOME}/.env
  2. Open 80 and 443 in the cloud provider's own firewall. On OCI that is the
     VCN security list or NSG, which this script cannot reach. If curl works on
     the box and hangs from outside, that is what it is.
  3. Point DNS at this host BEFORE the first deploy — Caddy requests its
     certificate on the first request, and a name that does not resolve yet
     burns an attempt.

EOF
