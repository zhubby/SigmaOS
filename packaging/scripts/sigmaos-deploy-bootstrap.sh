#!/bin/sh
set -eu

DEPLOY_USER=${SIGMAOS_DEPLOY_USER:-sigmaos-deploy}
BASE_DIR=${SIGMAOS_DEPLOY_DIR:-/var/lib/sigmaos-deploy}
SUDOERS_PATH=/etc/sudoers.d/sigmaos-deploy

[ "$(id -u)" -eq 0 ] || {
  printf 'sigmaos-deploy-bootstrap: must run as root\n' >&2
  exit 1
}

case "$DEPLOY_USER" in
  ''|*[!a-zA-Z0-9._-]*|root|sigmaos)
    printf 'sigmaos-deploy-bootstrap: invalid deployment user\n' >&2
    exit 1
    ;;
esac

command -v adduser >/dev/null 2>&1 || {
  printf 'sigmaos-deploy-bootstrap: adduser is required\n' >&2
  exit 1
}
command -v addgroup >/dev/null 2>&1 || {
  printf 'sigmaos-deploy-bootstrap: addgroup is required\n' >&2
  exit 1
}
command -v visudo >/dev/null 2>&1 || {
  printf 'sigmaos-deploy-bootstrap: visudo is required\n' >&2
  exit 1
}
command -v passwd >/dev/null 2>&1 || {
  printf 'sigmaos-deploy-bootstrap: passwd is required\n' >&2
  exit 1
}
[ -x /usr/lib/sigmaos/scripts/sigmaos-deploy ] || {
  printf 'sigmaos-deploy-bootstrap: packaged deployment helper is missing\n' >&2
  exit 1
}

install -d -o root -g root -m 0755 /usr/local/sbin
ln -sfn /usr/lib/sigmaos/scripts/sigmaos-deploy /usr/local/sbin/sigmaos-deploy

if ! getent group "$DEPLOY_USER" >/dev/null 2>&1; then
  addgroup --system "$DEPLOY_USER"
fi
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --system --ingroup "$DEPLOY_USER" --home "$BASE_DIR" --shell /bin/sh "$DEPLOY_USER"
elif ! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -Fxq "$DEPLOY_USER"; then
  adduser "$DEPLOY_USER" "$DEPLOY_USER"
fi

install -d -o root -g "$DEPLOY_USER" -m 0750 "$BASE_DIR"
install -d -o root -g "$DEPLOY_USER" -m 0730 "$BASE_DIR/incoming"
install -d -o root -g root -m 0700 "$BASE_DIR/backups" "$BASE_DIR/releases"
install -d -o root -g root -m 0755 /etc/sudoers.d

tmp_sudoers=$(mktemp /etc/sudoers.d/.sigmaos-deploy.XXXXXX)
trap 'rm -f "$tmp_sudoers"' EXIT HUP INT TERM
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/sigmaos-deploy\n' "$DEPLOY_USER" > "$tmp_sudoers"
chmod 0440 "$tmp_sudoers"
visudo -cf "$tmp_sudoers"
mv -f "$tmp_sudoers" "$SUDOERS_PATH"
trap - EXIT HUP INT TERM

passwd -l "$DEPLOY_USER" >/dev/null 2>&1
printf 'sigmaos-deploy-bootstrap: configured %s with Tailscale SSH and constrained sudo\n' "$DEPLOY_USER"
