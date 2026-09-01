#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
OUT_DIR="${SIGMAOS_IMAGE_OUT:-$ROOT_DIR/.sigmaos/appliance}"
SUITE="${SIGMAOS_BASE_SUITE:-bookworm}"
ARCH="${SIGMAOS_TARGET_ARCH:-arm64}"
DEB_PATH="${SIGMAOS_DEB:-$OUT_DIR/sigmaos_0.1.0_${ARCH}.deb}"
ROOTFS="$OUT_DIR/rootfs"
TARBALL="$OUT_DIR/sigmaos-rootfs-${ARCH}.tar"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "Missing required command: %s\n" "$1" >&2
    exit 1
  fi
}

need mmdebstrap
need systemd-nspawn
need tar

if [ ! -f "$DEB_PATH" ]; then
  printf "Missing SigmaOS deb at %s. Build it first with packaging/scripts/build-deb.sh or set SIGMAOS_DEB.\n" "$DEB_PATH" >&2
  exit 1
fi

rm -rf "$ROOTFS"
install -d "$OUT_DIR"

mmdebstrap \
  --architectures="$ARCH" \
  --variant=minbase \
  --include=systemd-sysv,ca-certificates,curl,nodejs,npm,sqlite3,git,rsync,gzip,unzip,libarchive-tools,unrar-free,tesseract-ocr,poppler-utils,ffmpeg,imagemagick,smartmontools,samba,apache2,apache2-utils,vsftpd,libpam-pwdfile,nfs-kernel-server,minidlna \
  "$SUITE" "$ROOTFS"

cp "$DEB_PATH" "$ROOTFS/tmp/sigmaos.deb"
systemd-nspawn -D "$ROOTFS" /bin/sh -eu -c "apt-get update && apt-get install -y /tmp/sigmaos.deb && rm /tmp/sigmaos.deb"
systemd-nspawn -D "$ROOTFS" systemctl enable sigmaos-share-helper.service sigmaos-api.service sigmaos-worker@1.service sigmaos-indexer.timer sigmaos-scheduler.timer sigmaos-maintenance.timer

tar --numeric-owner -C "$ROOTFS" -cpf "$TARBALL" .
printf "SigmaOS appliance rootfs written to %s\n" "$TARBALL"
