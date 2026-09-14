---
title: Debian 与 appliance 部署
description: 原生 Debian 包、systemd 服务、Nginx 和 appliance 构建。
type: operation
status: current
audience: [operator]
sourceOfTruth: [packaging/debian/rules, packaging/debian/install, packaging/systemd/sigmaos-api.service, packaging/appliance/manifest.toml]
sidebar:
  order: 1
---

生产部署使用 Debian package 和 Node.js 22，不把 SigmaOS 自身放入 Docker。API、worker、share-helper、terminal-helper 是常驻服务；indexer、scheduler、maintenance、health、backup 由 oneshot service 和 timer 驱动。

Nginx 只反向代理到 loopback API。运行时路径主要是 `/usr/lib/sigmaos`、`/etc/sigmaos`、`/var/lib/sigmaos`、`/run/sigmaos` 和配置的 `/srv` roots。API 静态提供 React Web 与 `/docs/` 文档站。
