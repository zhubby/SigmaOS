---
title: systemd 服务与 Timer
description: 服务身份、周期和关键 hardening 配置。
type: reference
status: current
audience: [operator]
sourceOfTruth: [packaging/systemd/sigmaos-api.service, packaging/systemd/sigmaos-worker@.service, packaging/systemd/sigmaos-downloader.service, packaging/systemd/sigmaos-indexer.timer, packaging/systemd/sigmaos-backup-daily.timer]
sidebar:
  order: 3
---

核心服务默认以 `sigmaos` 身份运行并使用 `ProtectSystem=strict`、`NoNewPrivileges=yes` 和资源上限。`sigmaos-hostd` 是唯一的 root daemon；为原子创建可配置的 Unix 共享账号，它显式放行 `/etc`、ACL 备份目录和 Samba 私有密码库。terminal-helper 固定以 `sigmaos` 身份启动，使用独立家目录 `/var/lib/sigmaos-terminal`；它对配置、数据库与日志路径的屏蔽仅防误操作，同 UID 终端不是后台服务的安全隔离边界。downloader 只写 `/var/lib/sigmaos`、日志和配置的 NAS roots。

Indexer 每 30 分钟运行，scheduler 每 6 小时，health 每 15 分钟，maintenance 每日，backup daily/weekly 分别按日历运行。oneshot 任务完成后显示 `inactive (dead)` 是正常状态，成功与否要看退出码和 journal。

查看全部运行状态：

```bash
systemctl --no-pager --type=service --type=timer 'sigmaos-*'
journalctl -u sigmaos-api.service -u sigmaos-worker@1.service -u sigmaos-downloader.service -n 100 --no-pager
journalctl -u sigmaos-indexer.service -u sigmaos-health.service -n 100 --no-pager
```

手动运行一次任务时启动对应 oneshot service，而不是直接运行 systemd timer：

```bash
sudo systemctl start sigmaos-indexer.service
sudo systemctl start sigmaos-scheduler.service
sudo systemctl start sigmaos-maintenance.service
sudo systemctl start sigmaos-health.service
```

修改 unit、drop-in 或 `/etc/sigmaos/config.toml` 后执行 `systemctl daemon-reload`，再重启受影响的常驻服务。停用 timer 前确认没有正在执行的同类 oneshot，避免 SQLite 写入并发。
