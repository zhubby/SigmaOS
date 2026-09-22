#!/bin/sh
set -eu

CONFIG_PATH=${SIGMAOS_CONFIG:-/etc/sigmaos/config.toml}
DROPIN_DIR=/etc/systemd/system/sigmaos-terminal-helper.service.d
DROPIN_PATH="$DROPIN_DIR/identity.conf"

[ "$(id -u)" -eq 0 ] || {
  printf 'sigmaos-terminal: must run as root\n' >&2
  exit 1
}

terminal_user=${SIGMAOS_TERMINAL_USER:-sigmaos}
helper_socket_path=${SIGMAOS_TERMINAL_HELPER_SOCKET_PATH:-/run/sigmaos/terminal-helper.sock}
session_idle_timeout_ms=${SIGMAOS_TERMINAL_SESSION_IDLE_TIMEOUT_MS:-1800000}
max_sessions=${SIGMAOS_TERMINAL_MAX_SESSIONS:-32}
if [ -f "$CONFIG_PATH" ] && [ -z "${SIGMAOS_TERMINAL_HELPER_SOCKET_PATH:-}" ]; then
  helper_socket_path=$(awk '
    $0 == "[terminal]" { in_terminal = 1; next }
    in_terminal && /^\[/ { in_terminal = 0 }
    in_terminal && $0 ~ /^[[:space:]]*helper_socket_path[[:space:]]*=/ {
      value = $0
      sub(/^[[:space:]]*helper_socket_path[[:space:]]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^"|"[[:space:]]*$/, "", value)
      print value
      exit
    }
  ' "$CONFIG_PATH")
  helper_socket_path=${helper_socket_path:-/run/sigmaos/terminal-helper.sock}
fi
if [ -f "$CONFIG_PATH" ] && [ -z "${SIGMAOS_TERMINAL_SESSION_IDLE_TIMEOUT_MS:-}" ]; then
  session_idle_timeout_ms=$(awk '
    $0 == "[terminal]" { in_terminal = 1; next }
    in_terminal && /^\[/ { in_terminal = 0 }
    in_terminal && $0 ~ /^[[:space:]]*session_idle_timeout_ms[[:space:]]*=/ {
      value = $0
      sub(/^[[:space:]]*session_idle_timeout_ms[[:space:]]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^"|"[[:space:]]*$/, "", value)
      print value
      exit
    }
  ' "$CONFIG_PATH")
  session_idle_timeout_ms=${session_idle_timeout_ms:-1800000}
fi
if [ -f "$CONFIG_PATH" ] && [ -z "${SIGMAOS_TERMINAL_MAX_SESSIONS:-}" ]; then
  max_sessions=$(awk '
    $0 == "[terminal]" { in_terminal = 1; next }
    in_terminal && /^\[/ { in_terminal = 0 }
    in_terminal && $0 ~ /^[[:space:]]*max_sessions[[:space:]]*=/ {
      value = $0
      sub(/^[[:space:]]*max_sessions[[:space:]]*=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^"|"[[:space:]]*$/, "", value)
      print value
      exit
    }
  ' "$CONFIG_PATH")
  max_sessions=${max_sessions:-32}
fi

[ "$terminal_user" = sigmaos ] || {
  printf 'sigmaos-terminal: terminal user must be sigmaos\n' >&2
  exit 1
}

case "$helper_socket_path" in
  /*)
    case "$helper_socket_path" in
      *[!a-zA-Z0-9_./-]*) printf 'sigmaos-terminal: helper socket path contains unsupported characters\n' >&2; exit 1 ;;
    esac
    ;;
  *) printf 'sigmaos-terminal: helper socket path must be absolute\n' >&2; exit 1 ;;
esac

case "$session_idle_timeout_ms" in ''|*[!0-9]*) printf 'sigmaos-terminal: invalid session idle timeout\n' >&2; exit 1 ;; esac
[ "$session_idle_timeout_ms" -gt 0 ] || { printf 'sigmaos-terminal: session idle timeout must be positive\n' >&2; exit 1; }
case "$max_sessions" in ''|*[!0-9]*) printf 'sigmaos-terminal: invalid maximum session count\n' >&2; exit 1 ;; esac
[ "$max_sessions" -gt 0 ] || { printf 'sigmaos-terminal: maximum session count must be positive\n' >&2; exit 1; }

passwd_entry=$(getent passwd "$terminal_user") || {
  printf 'sigmaos-terminal: user %s does not exist\n' "$terminal_user" >&2
  exit 1
}

uid=$(printf '%s\n' "$passwd_entry" | awk -F: '{print $3}')
home=$(printf '%s\n' "$passwd_entry" | awk -F: '{print $6}')
shell=$(printf '%s\n' "$passwd_entry" | awk -F: '{print $7}')
case "$uid" in ''|*[!0-9]*) printf 'sigmaos-terminal: invalid uid for %s\n' "$terminal_user" >&2; exit 1 ;; esac
[ "$uid" -gt 0 ] || { printf 'sigmaos-terminal: root terminal user is not allowed\n' >&2; exit 1; }
case "$home" in /*) ;; *) printf 'sigmaos-terminal: user home must be absolute\n' >&2; exit 1 ;; esac
case "$shell" in /*) ;; *) printf 'sigmaos-terminal: user shell must be absolute\n' >&2; exit 1 ;; esac
[ -d "$home" ] || { printf 'sigmaos-terminal: home is not a directory: %s\n' "$home" >&2; exit 1; }
[ -x "$shell" ] || { printf 'sigmaos-terminal: shell is not executable: %s\n' "$shell" >&2; exit 1; }
[ "$shell" != /usr/sbin/nologin ] && [ "$shell" != /bin/false ] || {
  printf 'sigmaos-terminal: sigmaos requires an interactive shell\n' >&2
  exit 1
}
[ "$home" = /var/lib/sigmaos-terminal ] || {
  printf 'sigmaos-terminal: unexpected sigmaos home: %s\n' "$home" >&2
  exit 1
}
getent group sigmaos >/dev/null || { printf 'sigmaos-terminal: sigmaos group does not exist\n' >&2; exit 1; }

nas_paths=$(awk '
  /^\[\[nas_roots\]\]/ { in_root = 1; next }
  in_root && /^\[/ { in_root = 0 }
  in_root && $0 ~ /^[[:space:]]*path[[:space:]]*=/ {
    value = $0
    sub(/^[[:space:]]*path[[:space:]]*=[[:space:]]*/, "", value)
    sub(/[[:space:]]+#.*$/, "", value)
    gsub(/^"|"[[:space:]]*$/, "", value)
    if (value ~ /^\//) print value
  }
' "$CONFIG_PATH" 2>/dev/null || true)

install -d -m 0755 "$DROPIN_DIR"
tmp_path=$(mktemp "$DROPIN_DIR/.identity.XXXXXX")
trap 'rm -f "$tmp_path"' EXIT HUP INT TERM
{
  printf '[Service]\n'
  printf 'User=%s\n' "$terminal_user"
  printf 'Group=sigmaos\n'
  printf 'Environment=SIGMAOS_TERMINAL_USER=%s\n' "$terminal_user"
  printf 'Environment=SIGMAOS_TERMINAL_HELPER_SOCKET_PATH=%s\n' "$helper_socket_path"
  printf 'Environment=SIGMAOS_TERMINAL_SESSION_IDLE_TIMEOUT_MS=%s\n' "$session_idle_timeout_ms"
  printf 'Environment=SIGMAOS_TERMINAL_MAX_SESSIONS=%s\n' "$max_sessions"
  printf 'Environment=HOME=%s\n' "$home"
  printf 'WorkingDirectory=%s\n' "$home"
  printf 'ReadWritePaths=%s\n' "$home"
  printf '%s\n' "$nas_paths" | while IFS= read -r nas_path; do
    [ -n "$nas_path" ] && printf 'ReadWritePaths=%s\n' "$nas_path"
  done
} > "$tmp_path"
chmod 0644 "$tmp_path"
mv -f "$tmp_path" "$DROPIN_PATH"
trap - EXIT HUP INT TERM

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
