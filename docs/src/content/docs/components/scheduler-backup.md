---
title: Scheduler、Backup 与 Health
description: 周期报告、restic、维护任务和健康告警。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [apps/scheduler/src/scheduler.ts, apps/backup/src/backup.ts, packaging/systemd/sigmaos-scheduler.timer, packaging/systemd/sigmaos-backup-daily.timer]
sidebar:
  order: 5
---

Scheduler 生成 duplicate、backup、provider 和 health 报告；maintenance 执行 SQLite checkpoint/optimize、历史裁剪和 restore staging 清理；health 评估 mount、index freshness、backup freshness、stalled run 和连续失败。

Backup CLI 与 daily/weekly timer 使用 restic。所有周期任务都是独立 Node 进程，通过 SQLite 记录 run、failure、alert 和 lock。
