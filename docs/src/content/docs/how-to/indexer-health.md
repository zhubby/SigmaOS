---
title: 索引与健康检查
description: 运行索引、查看 freshness、mount readiness 和健康告警。
type: how-to
status: current
audience: [developer, operator]
sourceOfTruth: [apps/indexer/src/run.ts, apps/scheduler/src/scheduler.ts, apps/api/src/routes/indexer.ts, apps/api/src/routes/health-status.ts]
sidebar:
  order: 3
---

Indexer 周期性遍历每个配置的 NAS root，不跟随符号链接，按 size 和 modification time 增量处理，并把正文写入 SQLite FTS5。文件读取失败保留最近一次成功索引；遍历不完整时跳过 stale cleanup。

通过 `/api/indexer/status`、`/api/roots/readiness` 和 `/api/system/health` 检查运行计数、失败路径、mount 身份、freshness 和告警。索引是最终一致的，timer 默认每 30 分钟运行一次。
