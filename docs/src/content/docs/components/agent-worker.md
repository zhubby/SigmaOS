---
title: Agent 与 Worker
description: Pi agent、只读 fallback、job queue 和 approval 状态机。
type: explanation
status: current
audience: [developer]
sourceOfTruth: [apps/worker/src/processor.ts, packages/agent/src/pi-agent.ts, packages/agent/src/read-only-agent.ts, packages/db/src/repositories/jobs.ts]
sidebar:
  order: 3
---

API 只写入 message 和 queued job。worker 负责 claim、取消检测、provider session、事件持久化和最终 job 状态；它不会直接绕过 approval 执行文件变更。

Pi 工具按 `read`、`grep`、`find`、`ls`、`bash`、`edit`、`write` 分组，策略可配置。没有 provider key 时，正式 Pi turn 失败；开发环境可显式启用 model-free read-only fallback。
