#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ARCH=$(dpkg --print-architecture 2>/dev/null || true)
NODE_MAJOR_REQUIRED=22
NODE_SOURCE_FINGERPRINT=6F71F525282841EEDAF851B42F59B5F99B1BE0B4
NGINX_ENABLED=${SIGMAOS_ENABLE_NGINX:-1}
DOCKER_ENABLED=${SIGMAOS_ENABLE_DOCKER:-0}
VM_ENABLED=${SIGMAOS_ENABLE_VM:-0}
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

case "$NGINX_ENABLED" in
  0|1) ;;
  *) die "SIGMAOS_ENABLE_NGINX must be 0 or 1" ;;
esac
case "$DOCKER_ENABLED" in
  0|1) ;;
  *) die "SIGMAOS_ENABLE_DOCKER must be 0 or 1" ;;
esac
case "$VM_ENABLED" in
  0|1) ;;
  *) die "SIGMAOS_ENABLE_VM must be 0 or 1" ;;
esac

install_build_dependencies() {
  log "installing build prerequisites"
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg build-essential debhelper dpkg-dev fakeroot rsync
}

install_optional_runtime() {
  runtime_packages=""
  if [ "$DOCKER_ENABLED" = "1" ]; then
    runtime_packages="$runtime_packages docker.io docker-compose"
  fi
  if [ "$VM_ENABLED" = "1" ]; then
    case "$ARCH" in
      arm64) runtime_packages="$runtime_packages libvirt-daemon-system libvirt-clients qemu-system-arm qemu-utils virtinst" ;;
      amd64) runtime_packages="$runtime_packages libvirt-daemon-system libvirt-clients qemu-system-x86 qemu-utils virtinst" ;;
    esac
  fi
  if [ -n "$runtime_packages" ]; then
    log "installing optional runtime components:$runtime_packages"
    apt-get update
    # shellcheck disable=SC2086
    apt-get install -y --no-install-recommends $runtime_packages
  fi
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
install_optional_runtime

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
SIGMAOS_DOCKER_ENABLED="$DOCKER_ENABLED" \
SIGMAOS_VM_ENABLED="$VM_ENABLED" \
  /usr/lib/sigmaos/scripts/sigmaos-first-boot.sh

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  /usr/lib/sigmaos/scripts/sigmaos-refresh-groups.sh
  if [ "$DOCKER_ENABLED" = "1" ]; then
    systemctl enable --now docker.service
  fi
  if [ "$VM_ENABLED" = "1" ]; then
    for vm_unit in libvirtd.service virtqemud.socket; do
      if systemctl list-unit-files "$vm_unit" --no-legend 2>/dev/null | grep -q "$vm_unit"; then
        systemctl enable --now "$vm_unit" || true
      fi
    done
  fi
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

if [ "$NGINX_ENABLED" = "1" ]; then
  log "installing Nginx reverse proxy"
  apt-get install -y --no-install-recommends nginx
  SIGMAOS_NGINX_PORT=${SIGMAOS_NGINX_PORT:-80} \
    /usr/lib/sigmaos/scripts/sigmaos-nginx.sh
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable nginx
    systemctl restart nginx
  fi
  log "installed successfully; web UI is available on http://<host>:${SIGMAOS_NGINX_PORT:-80}"
else
  log "installed successfully; Nginx reverse proxy disabled"
  log "API listens on http://127.0.0.1:3010"
fi
