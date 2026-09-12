# SigmaOS Appliance Image Scaffold

This directory contains the v1 appliance image scaffold. It builds a minimal systemd rootfs, installs the SigmaOS Debian package, and enables the runtime services and timers.

Inputs:

- `SIGMAOS_DEB`: path to the built `sigmaos` Debian package.
- `SIGMAOS_IMAGE_OUT`: output directory, default `.sigmaos/appliance`.
- `SIGMAOS_BASE_SUITE`: Debian suite, default `bookworm`.
- `SIGMAOS_TARGET_ARCH`: target architecture, default `arm64`.
- `SIGMAOS_APT_MIRROR`: Debian mirror used by `mmdebstrap`, default `https://mirrors.aliyun.com/debian`.
- `SIGMAOS_NODE_MIRROR`: Node.js release mirror, default `https://mirrors.aliyun.com/nodejs-release`.
- `SIGMAOS_NODE_VERSION`: Node.js version to place in the image, default `22.23.2`.

Required host tools:

- `mmdebstrap`
- `systemd-nspawn`
- `tar`

The manifest records required runtime components: Node, Pi, SQLite, Nginx, Docker, libvirt/QEMU, systemd units, OCR helpers, media helpers, archive helpers, and NAS health tooling. Docker and VM management remain disabled by default in first-boot configuration; enable them explicitly when the appliance is intended to manage containers or virtual machines. The image builder uses the configured domestic mirror for the base rootfs; pass `SIGMAOS_APT_MIRROR` to use an internal mirror. The resulting rootfs tarball is the handoff point for board-specific image tooling.
