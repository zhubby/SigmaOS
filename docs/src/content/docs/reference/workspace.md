---
title: Workspace 与服务矩阵
description: SigmaOS monorepo、应用、包和运行进程的对应关系。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [package.json, apps/api/package.json, apps/web/package.json, packages/db/package.json]
sidebar:
  order: 1
---

| 区域 | 责任 |
| --- | --- |
| `apps/web` | React/Vite 工作区与预览 |
| `apps/api` | Fastify REST、SSE、WebSocket 和静态服务 |
| `apps/worker` | agent job claim 与事件持久化 |
| `apps/indexer` | NAS 扫描与 FTS5 索引 |
| `apps/scheduler` / `apps/backup` | 报告、维护、restic |
| `apps/hostd` / `apps/terminal-helper` | Rust 特权宿主机操作与非 root 终端隔离 |
| `packages/db` / `nas-tools` / `agent` / `shared` | 共享持久化、安全、agent 和配置契约 |
