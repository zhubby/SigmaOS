#!/bin/sh
set -eu

CONFIG_PATH=${SIGMAOS_CONFIG:-/etc/sigmaos/config.toml}
DROPIN_DIR=/etc/systemd/system/sigmaos-player-helper.service.d
DROPIN_PATH="$DROPIN_DIR/identity.conf"

[ "$(id -u)" -eq 0 ] || {
  printf 'sigmaos-player: must run as root\n' >&2
  exit 1
}

player_user=${SIGMAOS_PLAYER_USER:-sigmaos}
if [ -f "$CONFIG_PATH" ] && [ -z "${SIGMAOS_PLAYER_USER:-}" ]; then
  player_user=$(awk '
    $0 == "[player]" { in_player = 1; next }
    in_player && /^\[/ { in_player = 0 }
    in_player && $0 ~ /^[[:space:]]*user[[:space:]]*=/ {
      value = $0
      sub(/^[[:space:]]*user[[:space:]]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^"|"[[:space:]]*$/, "", value)
      print value
      exit
    }
  ' "$CONFIG_PATH")
  player_user=${player_user:-sigmaos}
fi

case "$player_user" in
  *[!a-zA-Z0-9._-]*) printf 'sigmaos-player: invalid player user\n' >&2; exit 1 ;;
esac
getent passwd "$player_user" >/dev/null || {
  printf 'sigmaos-player: player user does not exist: %s\n' "$player_user" >&2
  exit 1
}
getent group sigmaos >/dev/null || {
  printf 'sigmaos-player: sigmaos group does not exist\n' >&2
  exit 1
}

supplementary_groups=""
for group in video render audio; do
  if getent group "$group" >/dev/null 2>&1; then
    supplementary_groups="$supplementary_groups $group"
  fi
done

install -d -m 0755 "$DROPIN_DIR"
tmp_path=$(mktemp "$DROPIN_DIR/.identity.XXXXXX")
trap 'rm -f "$tmp_path"' EXIT HUP INT TERM
{
  printf '[Service]\n'
  printf 'User=%s\n' "$player_user"
  printf 'Group=sigmaos\n'
  if [ -n "$supplementary_groups" ]; then
    printf 'SupplementaryGroups=%s\n' "${supplementary_groups# }"
  fi
} > "$tmp_path"
chmod 0644 "$tmp_path"
mv -f "$tmp_path" "$DROPIN_PATH"
trap - EXIT HUP INT TERM

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
