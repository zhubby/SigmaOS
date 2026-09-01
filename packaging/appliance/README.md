# SigmaOS Appliance Image Scaffold

This directory contains the v1 appliance image scaffold. It builds a minimal systemd rootfs, installs the SigmaOS Debian package, and enables the runtime services and timers.

Inputs:

- `SIGMAOS_DEB`: path to the built `sigmaos` Debian package.
- `SIGMAOS_IMAGE_OUT`: output directory, default `.sigmaos/appliance`.
- `SIGMAOS_BASE_SUITE`: Debian suite, default `bookworm`.
- `SIGMAOS_TARGET_ARCH`: target architecture, default `arm64`.

Required host tools:

- `mmdebstrap`
- `systemd-nspawn`
- `tar`

The manifest records required runtime components: Node, Pi, SQLite, systemd units, OCR helpers, media helpers, archive helpers, and NAS health tooling. The resulting rootfs tarball is the handoff point for board-specific image tooling.
