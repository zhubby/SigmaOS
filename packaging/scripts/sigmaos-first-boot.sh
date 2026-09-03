#!/bin/sh
set -eu

CONFIG_PATH="${SIGMAOS_CONFIG:-/etc/sigmaos/config.toml}"
DATA_DIR="${SIGMAOS_DATA_DIR:-/var/lib/sigmaos}"
DATABASE_PATH="${SIGMAOS_DATABASE_PATH:-$DATA_DIR/sigmaos.sqlite}"
ADMIN_DISPLAY_NAME="${SIGMAOS_ADMIN_DISPLAY_NAME:-}"
NAS_ROOT_ID="${SIGMAOS_NAS_ROOT_ID:-primary}"
NAS_ROOT_NAME="${SIGMAOS_NAS_ROOT_NAME:-Primary NAS}"
NAS_ROOT_PATH="${SIGMAOS_NAS_ROOT_PATH:-}"
MODEL_PROVIDER="${SIGMAOS_MODEL_PROVIDER:-pi}"
PI_COMMAND="${SIGMAOS_PI_COMMAND:-pi}"
LOCAL_ENDPOINT="${SIGMAOS_LOCAL_ENDPOINT:-}"

ask_default() {
  prompt="$1"
  default="$2"
  if [ -t 0 ]; then
    printf "%s [%s]: " "$prompt" "$default" >&2
    read -r answer || answer=""
    if [ -n "$answer" ]; then
      printf "%s" "$answer"
      return
    fi
  fi
  printf "%s" "$default"
}

if [ -z "$ADMIN_DISPLAY_NAME" ]; then
  ADMIN_DISPLAY_NAME="$(ask_default "Admin display name" "SigmaOS Admin")"
fi

if [ -z "$NAS_ROOT_PATH" ]; then
  NAS_ROOT_PATH="$(ask_default "NAS root path" "/srv/nas")"
fi

install -d -m 0750 "$DATA_DIR" "$DATA_DIR/trash" "$DATA_DIR/pi-sessions" "$DATA_DIR/reports" "$DATA_DIR/backup-staging" /srv/backup
install -d -m 0755 "$(dirname "$CONFIG_PATH")" "$NAS_ROOT_PATH"

umask 077
cat > "$CONFIG_PATH" <<EOF_CONFIG
data_dir = "$DATA_DIR"

[api]
host = "127.0.0.1"
port = 3010
allowed_origins = []

[worker]
poll_ms = 750

[admin]
display_name = "$ADMIN_DISPLAY_NAME"
auth_mode = "local-only"

[model]
provider = "$MODEL_PROVIDER"
pi_command = "$PI_COMMAND"
local_endpoint = "$LOCAL_ENDPOINT"

[docker]
enabled = false
socket_path = "/var/run/docker.sock"
compose_command = "docker"
operation_timeout_ms = 120000
console_shells = ["/bin/sh", "/bin/bash"]

[shares]
enabled = false
helper_socket_path = "/run/sigmaos/share-helper.sock"
account_username = "sigma-share"

[[nas_roots]]
id = "$NAS_ROOT_ID"
name = "$NAS_ROOT_NAME"
path = "$NAS_ROOT_PATH"
mount_policy = "required"

[backup]
enabled = false
repository_path = "/srv/backup/restic"
password_file = "/etc/sigmaos/restic-password"
staging_path = "$DATA_DIR/backup-staging"
require_mount = true
retry_count = 2
timeout_ms = 300000
keep_daily = 7
keep_weekly = 4

[health]
stale_index_warning_ms = 7200000
stale_index_critical_ms = 21600000
stalled_run_ms = 900000
consecutive_failure_threshold = 2
backup_stale_ms = 93600000
EOF_CONFIG

if id sigmaos >/dev/null 2>&1; then
  chown -R sigmaos:sigmaos "$DATA_DIR" "$NAS_ROOT_PATH"
  chown sigmaos:sigmaos "$CONFIG_PATH"
fi

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DATABASE_PATH" <<EOF_SQL
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO users (id, display_name, created_at)
VALUES ('local-admin', '$ADMIN_DISPLAY_NAME', datetime('now'));
EOF_SQL
  if id sigmaos >/dev/null 2>&1; then
    chown sigmaos:sigmaos "$DATABASE_PATH" "$DATABASE_PATH"-* 2>/dev/null || true
  fi
fi

printf "SigmaOS first boot initialized %s with NAS root %s\n" "$CONFIG_PATH" "$NAS_ROOT_PATH"
