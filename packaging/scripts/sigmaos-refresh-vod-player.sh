#!/bin/sh
set -eu

CONFIG_PATH=${SIGMAOS_CONFIG:-/etc/sigmaos/config.toml}
DROPIN_DIR=/etc/systemd/system/sigmaos-vod-player.service.d
DROPIN_PATH="$DROPIN_DIR/identity.conf"

[ "$(id -u)" -eq 0 ] || {
  printf 'sigmaos-vod-player: must run as root\n' >&2
  exit 1
}

legacy_player_environment=$(env | awk -F= '$1 == "SIGMAOS_ENABLE_PLAYER" || $1 ~ /^SIGMAOS_PLAYER_/ { print $1; exit }')
if [ -n "$legacy_player_environment" ]; then
  printf '%s is no longer supported; use SIGMAOS_VOD_PLAYER_*\n' "$legacy_player_environment" >&2
  exit 1
fi

player_user=${SIGMAOS_VOD_PLAYER_USER:-sigmaos}
socket_path=${SIGMAOS_VOD_PLAYER_SOCKET_PATH:-/run/sigmaos/vod-player.sock}
state_path=${SIGMAOS_VOD_PLAYER_STATE_PATH:-/var/lib/sigmaos-vod-player/session.json}
if [ -f "$CONFIG_PATH" ] && [ -z "${SIGMAOS_VOD_PLAYER_USER:-}" ]; then
  player_user=$(awk '
    $0 ~ /^[[:space:]]*\[[[:space:]]*vod_player[[:space:]]*\][[:space:]]*(#.*)?$/ { in_player = 1; next }
    in_player && /^[[:space:]]*\[/ { in_player = 0 }
    in_player && $0 ~ /^[[:space:]]*user[[:space:]]*=/ {
      value = $0
      sub(/^[[:space:]]*user[[:space:]]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^\047.*\047$/)) value = substr(value, 2, length(value) - 2)
      print value
      exit
    }
  ' "$CONFIG_PATH")
  player_user=${player_user:-sigmaos}
fi
if [ -f "$CONFIG_PATH" ] && [ -z "${SIGMAOS_VOD_PLAYER_SOCKET_PATH:-}" ]; then
  socket_path=$(awk '
    $0 ~ /^[[:space:]]*\[[[:space:]]*vod_player[[:space:]]*\][[:space:]]*(#.*)?$/ { in_player = 1; next }
    in_player && /^[[:space:]]*\[/ { in_player = 0 }
    in_player && $0 ~ /^[[:space:]]*socket_path[[:space:]]*=/ {
      value = $0
      sub(/^[[:space:]]*socket_path[[:space:]]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^\047.*\047$/)) value = substr(value, 2, length(value) - 2)
      print value
      exit
    }
  ' "$CONFIG_PATH")
  socket_path=${socket_path:-/run/sigmaos/vod-player.sock}
fi
if [ -f "$CONFIG_PATH" ] && [ -z "${SIGMAOS_VOD_PLAYER_STATE_PATH:-}" ]; then
  state_path=$(awk '
    $0 ~ /^[[:space:]]*\[[[:space:]]*vod_player[[:space:]]*\][[:space:]]*(#.*)?$/ { in_player = 1; next }
    in_player && /^[[:space:]]*\[/ { in_player = 0 }
    in_player && $0 ~ /^[[:space:]]*state_path[[:space:]]*=/ {
      value = $0
      sub(/^[[:space:]]*state_path[[:space:]]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^\047.*\047$/)) value = substr(value, 2, length(value) - 2)
      print value
      exit
    }
  ' "$CONFIG_PATH")
  state_path=${state_path:-/var/lib/sigmaos-vod-player/session.json}
fi

case "$player_user" in
  *[!a-zA-Z0-9._-]*|root) printf 'sigmaos-vod-player: invalid VOD player user\n' >&2; exit 1 ;;
esac
getent passwd "$player_user" >/dev/null || {
  printf 'sigmaos-vod-player: user does not exist: %s\n' "$player_user" >&2
  exit 1
}
getent group sigmaos >/dev/null || {
  printf 'sigmaos-vod-player: sigmaos group does not exist\n' >&2
  exit 1
}
case "$socket_path" in /*) ;; *) printf 'sigmaos-vod-player: socket path must be absolute\n' >&2; exit 1 ;; esac
case "$state_path" in /*) ;; *) printf 'sigmaos-vod-player: state path must be absolute\n' >&2; exit 1 ;; esac
case "$socket_path" in /tmp|/tmp/*|/var/tmp|/var/tmp/*) printf 'sigmaos-vod-player: socket path cannot use a private temporary directory\n' >&2; exit 1 ;; esac
case "$state_path" in /tmp|/tmp/*|/var/tmp|/var/tmp/*) printf 'sigmaos-vod-player: state path cannot use a private temporary directory\n' >&2; exit 1 ;; esac

socket_parent=$(dirname "$socket_path")
state_parent=$(dirname "$state_path")

escape_systemd_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g'
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
  printf 'ReadWritePaths="%s"\n' "$(escape_systemd_value "$socket_parent")"
  if [ "$state_parent" != "$socket_parent" ]; then
    printf 'ReadWritePaths="%s"\n' "$(escape_systemd_value "$state_parent")"
  fi
} > "$tmp_path"
chmod 0644 "$tmp_path"
mv -f "$tmp_path" "$DROPIN_PATH"
trap - EXIT HUP INT TERM

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
