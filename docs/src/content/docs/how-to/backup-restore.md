---
title: 备份与恢复
description: 使用 restic 完成校验、初始化、日常备份、检查和 staging 恢复。
type: how-to
status: current
audience: [operator]
sourceOfTruth: [apps/backup/src/index.ts, apps/backup/src/backup.ts, packaging/systemd/sigmaos-backup-daily.timer]
sidebar:
  order: 2
---

备份是显式 opt-in 能力。先配置 repository 和受保护的 password file，再执行 validate 和一次性的 init。daily/weekly timer 永远不会隐式初始化仓库。

备份包括 NAS roots、SQLite 在线快照、trash 状态和 manifest。恢复首先写入新的 0700 staging 目录，校验 root 映射与 SHA-256；v1 不会覆盖活动 NAS root、数据库目录或备份仓库。
