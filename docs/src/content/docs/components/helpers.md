---
title: 宿主机 Helpers
description: share-helper 和 terminal-helper 的 Unix socket 权限隔离。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [apps/share-helper/src/index.ts, apps/share-helper/src/helper.ts, apps/terminal-helper/src/index.ts, packaging/systemd/sigmaos-share-helper.service]
sidebar:
  order: 6
---

share-helper 以 root 运行，但只接受固定 HTTP Unix socket 路径、allowlist 命令和配置目标。terminal-helper 为配置的非 root 用户创建 PTY，限制 frame、输出和并发 session，并通过 systemd drop-in 绑定用户 home。

API 通过 Unix socket 调用 helper；浏览器永远不直接连接宿主机 socket。
