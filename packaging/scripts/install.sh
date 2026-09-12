#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ARCH=$(dpkg --print-architecture 2>/dev/null || true)
NODE_MAJOR_REQUIRED=22
NODE_SOURCE_FINGERPRINT=6F71F525282841EEDAF851B42F59B5F99B1BE0B4
DEBIAN_FRONTEND=noninteractive
export DEBIAN_FRONTEND

log() {
  printf 'sigmaos-install: %s\n' "$*"
}

die() {
  printf 'sigmaos-install: error: %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "run as root (for example: sudo $0)"
[ -f /etc/debian_version ] || die "a Debian-family host is required"

case "$ARCH" in
  arm64|amd64) ;;
  *) die "unsupported Debian architecture: ${ARCH:-unknown}; use arm64 or amd64" ;;
esac

install_build_dependencies() {
  log "installing build prerequisites"
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg build-essential debhelper dpkg-dev fakeroot rsync
}

node_major() {
  if ! command -v node >/dev/null 2>&1; then
    printf '0'
    return
  fi

  node --version | sed 's/^v//' | cut -d. -f1
}

install_node_22() {
  log "installing Node.js ${NODE_MAJOR_REQUIRED}"
  install_build_dependencies

  key_dir=$(mktemp -d)
  trap 'rm -rf "$key_dir"' EXIT HUP INT TERM
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$key_dir/nodesource.key"
  gpg --show-keys --with-colons "$key_dir/nodesource.key" | grep -Fq "$NODE_SOURCE_FINGERPRINT" \
    || die "NodeSource signing key fingerprint did not match"
  gpg --batch --yes --dearmor -o "$key_dir/nodesource.gpg" "$key_dir/nodesource.key"
  install -d -m 0755 /etc/apt/keyrings
  install -m 0644 "$key_dir/nodesource.gpg" /etc/apt/keyrings/nodesource.gpg
  printf '%s\n' \
    'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y --no-install-recommends nodejs
}

if [ "$(node_major)" -lt "$NODE_MAJOR_REQUIRED" ] 2>/dev/null; then
  install_node_22
fi

node --version | grep -Eq '^v22\.' || die "Node.js 22 is required; found $(node --version 2>/dev/null || printf 'none')"
install_build_dependencies

log "building the native ${ARCH} Debian package"
"$ROOT_DIR/packaging/scripts/build-deb.sh"

DEB_PATH=$(find "$ROOT_DIR/.sigmaos" -maxdepth 1 -type f \
  -name "sigmaos_*_${ARCH}.deb" ! -name '*dbgsym*' -print | sort | tail -n 1)
[ -n "$DEB_PATH" ] || die "could not find the ${ARCH} Debian package"

log "installing $DEB_PATH"
apt-get install -y --no-install-recommends "$DEB_PATH"

log "initializing SigmaOS configuration"
SIGMAOS_ADMIN_DISPLAY_NAME=${SIGMAOS_ADMIN_DISPLAY_NAME:-SigmaOS Admin} \
SIGMAOS_NAS_ROOT_PATH=${SIGMAOS_NAS_ROOT_PATH:-/srv/nas} \
  /usr/lib/sigmaos/scripts/sigmaos-first-boot.sh

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable --now \
    sigmaos-share-helper.service \
    sigmaos-api.service \
    sigmaos-worker@1.service
  systemctl enable \
    sigmaos-indexer.timer \
    sigmaos-scheduler.timer \
    sigmaos-maintenance.timer \
    sigmaos-backup-daily.timer \
    sigmaos-backup-weekly.timer \
    sigmaos-health.timer
fi

log "installed successfully; API listens on http://127.0.0.1:3010"
