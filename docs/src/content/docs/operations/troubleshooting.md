---
title: 故障排查
description: API、静态资源、terminal、timer、indexer、backup 和 SQLite 故障排查入口。
type: operation
status: current
audience: [operator]
sourceOfTruth: [apps/api/src/routes/health-status.ts, apps/api/src/lib/docker-daemon.ts, apps/share-helper/src/helper.ts, packaging/systemd/sigmaos-api.service, packaging/systemd/sigmaos-indexer.service, apps/api/src/web-static.ts]
sidebar:
  order: 4
---

优先查看对应 service 的 journald，再检查 `/health`、`/api/system/health`、`/api/indexer/status`、`/api/roots/readiness` 和 `/api/backup/status`。`/health` 只代表 API liveness，不代表 NAS、索引或 backup 已就绪。

`SQLITE_BUSY` 通常表示 oneshot 任务并发；应停止相关 timers，确认任务退出后串行运行。静态页面停在 Loading 时，先确认 API 提供当前 Web asset，且不存在的 `/assets/*` 没有被 SPA fallback 返回。

## 服务目录所有权与启动顺序

root share-helper 只声明 `StateDirectory=sigmaos/docker-daemon`（`0700 root:root`），不声明共享的 `StateDirectory=sigmaos` 或 `LogsDirectory=sigmaos`。否则 systemd 启动 root helper 时可能重设共享父目录及子文件的所有权，导致非 root API/worker 无法打开 SQLite。不要用反复递归 chown 或赋予 API root 权限掩盖问题。

```bash
sudo systemctl show sigmaos-share-helper.service -p StateDirectory -p StateDirectoryMode -p LogsDirectory
sudo stat -c '%U:%G %a %n' /var/lib/sigmaos /var/lib/sigmaos/docker-daemon /var/log/sigmaos
sudo systemctl cat sigmaos-share-helper.service
```

共享父目录保持 `sigmaos:sigmaos`，Docker 恢复子目录保持 `root:root 700`。升级后检查现有 drop-in 不得重新引入共享父目录声明。CM5 上已有的 `deployment-state.conf` 如设置相同的嵌套目录，可保留；恢复文件无需迁移。修复权限前停止 timers 和所有数据库写入进程，先保存一致备份；仅修复核实错误的目标，不改变 Docker 恢复材料权限。

在维护窗口分别验证 helper→API/worker 和 API/worker→helper 两种启动顺序，以及 helper 单独重启后 API 仍可访问数据库。查看 `Permission denied`、`SQLITE_CANTOPEN` 和重启计数；不能只检查一次 `/health`。设备重启验收须另行安排，不能用服务重启代替。

## Docker 拉取与资源能力

分别检查设备到镜像源的 DNS/TLS、镜像代理 `/v2/` 和实际镜像拉取。`/v2/` 返回 `200` 或认证挑战 `401` 只能证明网络可达，不能证明镜像存在或凭证有效。Registry mirror 在 daemon JSON 中配置，例如 `https://docker.zhubby.com`；SigmaOS Registry 凭证匹配仍按镜像引用，而不是自动改为 mirror 地址。

检查 Engine `/info` 的 `MemoryLimit`、`SwapLimit`、`CpuCfsQuota`、`CpuCfsPeriod` 等属性及内核/cgroup 配置。能力未知或不支持时清空对应限制，不绕过 API 校验。修改 CM5 内核启动参数需备份原配置并有独立维护窗口；本功能不会自动更改宿主机。资源统计 `null` 与资源能力 `false` 是不同信号。

## Docker daemon 配置恢复

先分别检查 service 与 Engine socket，不要把两者混为一个故障：

```bash
sudo systemctl show docker.service -p LoadState -p ActiveState -p SubState -p Result
sudo journalctl -u docker.service -u sigmaos-share-helper.service -n 100 --no-pager
sudo dockerd --validate --config-file /etc/docker/daemon.json
curl -fsS http://127.0.0.1:3010/api/docker/summary
```

若界面报告自动回滚失败，停止继续保存，查看 `/var/lib/sigmaos/docker-daemon/transaction.json`。当其中 `baselineExists` 为 `true` 且 `baseline.json` 存在时，可人工恢复：

```bash
sudo install -o root -g root -m 0644 /var/lib/sigmaos/docker-daemon/baseline.json /etc/docker/daemon.json
sudo dockerd --validate --config-file /etc/docker/daemon.json
sudo systemctl restart docker.service
```

若 `baselineExists` 为 `false`，基线代表原先没有配置文件，应移走当前 `/etc/docker/daemon.json` 后再启动。确认 Docker 恢复前保留事务目录；恢复完成后再删除其中的 `transaction.json` 和 `baseline.json`。不要把这些文件的正文复制到日志或工单，它们可能包含 registry、proxy 或 credential 配置。
