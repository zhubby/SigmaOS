#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
BUILD_DIR="$ROOT_DIR/.sigmaos/deb-build"
SIGMAOS_NPM_REGISTRY=${SIGMAOS_NPM_REGISTRY:-https://registry.npmmirror.com}
export SIGMAOS_NPM_REGISTRY

rm -rf "$BUILD_DIR"
install -d "$BUILD_DIR"
rsync -a --exclude node_modules --exclude .git --exclude .sigmaos "$ROOT_DIR/" "$BUILD_DIR/"
cd "$BUILD_DIR"
cp -R packaging/debian debian
dpkg-buildpackage -us -uc -b

printf "Debian package artifacts written under %s\n" "$(dirname "$BUILD_DIR")"
