#!/bin/sh
set -eu

DROPIN_DIR=/etc/systemd/system/sigmaos-api.service.d
DROPIN_PATH="$DROPIN_DIR/optional-groups.conf"

optional_groups=""
for optional_group in docker libvirt kvm; do
  if getent group "$optional_group" >/dev/null 2>&1; then
    optional_groups="$optional_groups $optional_group"
  fi
done

if [ -n "$optional_groups" ]; then
  install -d -m 0755 "$DROPIN_DIR"
  printf '[Service]\nSupplementaryGroups=%s\n' "${optional_groups# }" > "$DROPIN_PATH"
else
  rm -f "$DROPIN_PATH"
  rmdir "$DROPIN_DIR" 2>/dev/null || true
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
