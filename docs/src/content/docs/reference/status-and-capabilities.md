---
title: 状态、能力与限制
description: Job、approval、operation、index、backup 和可用能力的当前状态。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [packages/shared/src/types.ts, packages/db/src/repositories/approval-status.ts, packages/db/src/repositories/index-run-status.ts, packages/db/src/repositories/backup-runs.ts]
sidebar:
  order: 4
---

Job 状态包括 `queued`、`running`、`waiting_approval`、`completed`、`failed`、`cancelled`；approval 包括 `pending`、`approved`、`rejected`、`expired`、`applied`、`failed`；文件 operation 记录 proposed、applied、rolled_back、failed。

当前已实现文件浏览、预览、上传、编辑、归档检查、搜索、agent、approval、trash/restore、Docker/VM/share/terminal 控制、indexer、restic backup 和健康 API。OCR、实时 watcher、永久删除和网络/存储 host 写配置仍不是通用能力。
