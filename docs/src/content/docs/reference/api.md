---
title: HTTP、SSE 与 WebSocket 参考
description: API 传输面、端点分组和稳定契约。
type: reference
status: current
audience: [developer]
sourceOfTruth: [apps/api/src/routes/index.ts, apps/api/src/routes/files.ts, apps/api/src/routes/sessions.ts, apps/web/src/api.ts]
sidebar:
  order: 2
---

REST 路由按 roots、files/search、sessions/jobs/events、approvals/operations、indexer/readiness/health、backup、settings、system、storage、shares、Docker、VM 和 terminal 分组。

Agent 事件通过 session SSE stream 传递；terminal、Docker console 和 VM console 使用 WebSocket。写操作的 approval 要求以 route 实现和 `packages/shared/src/types.ts` 为准；本页不复制易漂移的完整 JSON schema。
