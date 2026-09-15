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

share-helper 以 root 运行，但只接受固定 HTTP Unix socket 路径、allowlist 命令和配置目标。terminal-helper 以配置的非 root 用户运行 tmux，并通过 attach PTY 提供终端。session 名称由 NAS root 和客户端 session ID 稳定生成，因此 API 或 WebSocket 重连只会重新 attach，不会重复创建 shell；tmux socket 位于终端用户 home 下。helper 限制 frame、输出和并发 session，并通过 systemd drop-in 绑定用户 home；空闲 session 会按配置回收。

API 通过 Unix socket 调用 helper；浏览器永远不直接连接宿主机 socket。
