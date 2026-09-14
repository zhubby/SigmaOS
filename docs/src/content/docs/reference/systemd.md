---
title: systemd 服务与 Timer
description: 服务身份、周期和关键 hardening 配置。
type: reference
status: current
audience: [operator]
sourceOfTruth: [packaging/systemd/sigmaos-api.service, packaging/systemd/sigmaos-worker@.service, packaging/systemd/sigmaos-indexer.timer, packaging/systemd/sigmaos-backup-daily.timer]
sidebar:
  order: 3
---

核心服务默认以 `sigmaos` 身份运行并使用 `ProtectSystem=strict`、`NoNewPrivileges=yes` 和资源上限。share-helper 是唯一的 root helper；terminal-helper 通过 drop-in 绑定非 root 终端用户。

Indexer 每 30 分钟运行，scheduler 每 6 小时，health 每 15 分钟，maintenance 每日，backup daily/weekly 分别按日历运行。oneshot 任务完成后显示 inactive 是正常状态。
