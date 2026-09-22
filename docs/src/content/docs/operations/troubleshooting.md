---
title: 故障排查
description: API、静态资源、terminal、timer、indexer、backup 和 SQLite 故障排查入口。
type: operation
status: current
audience: [operator]
sourceOfTruth: [apps/api/src/routes/health-status.ts, apps/api/src/lib/docker-daemon.ts, apps/api/src/lib/network-manager.ts, apps/hostd/src/docker_daemon.rs, apps/hostd/src/network_manager.rs, packaging/systemd/sigmaos-hostd.service, packaging/systemd/sigmaos-api.service, packaging/systemd/sigmaos-indexer.service, apps/api/src/web-static.ts]
sidebar:
  order: 4
---

优先查看对应 service 的 journald，再检查 `/health`、`/api/system/health`、`/api/indexer/status`、`/api/roots/readiness` 和 `/api/backup/status`。`/health` 只代表 API liveness，不代表 NAS、索引或 backup 已就绪。

`SQLITE_BUSY` 通常表示 oneshot 任务并发；应停止相关 timers，确认任务退出后串行运行。静态页面停在 Loading 时，先确认 API 提供当前 Web asset，且不存在的 `/assets/*` 没有被 SPA fallback 返回。

## 照片扫描与 HEIC

照片面板长时间停在 queued/scanning 或出现 degraded 时，先检查 worker、库状态和目录挂载：

```bash
sudo systemctl status sigmaos-photo-worker.service --no-pager
sudo journalctl -u sigmaos-photo-worker.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3010/api/photos/status
command -v heif-convert
```

`offline` 表示照片设置对应的 root、storage pool 或目录当前不可用；先恢复相同挂载，不要把其他目录挂到原路径伪装成照片库。单个 HEIC/HEIF 失败时确认 `libheif-examples` 已安装并验证源文件；JPEG/PNG 等全部失败时检查 `/var/lib/sigmaos/photos` 与照片目录对 `sigmaos` 用户的读写权限。完整遍历失败不会清理未确认的旧资源。

## 服务目录所有权与启动顺序

root hostd 只声明 `StateDirectory=sigmaos/docker-daemon` 和 `StateDirectory=sigmaos/network-manager`（均为 `0700 root:root`），不声明共享的 `StateDirectory=sigmaos` 或 `LogsDirectory=sigmaos`，`ReadWritePaths` 也不得包含 `/var/lib/sigmaos` 父目录或 `/var/log/sigmaos`。否则 hostd 可能改动共享状态，或 systemd 在启动时重设父目录及子文件的所有权，导致非 root API/worker 无法打开 SQLite。动态共享账号需要 `useradd` 原子更新账号数据库，因此 unit 会显式放行 `/etc`；Samba 的 `smbpasswd` 还需要 `/run/samba`、`/var/lib/samba`、`/var/cache/samba` 和 `/var/log/samba` 可写。不要用反复递归 chown 或赋予 API root 权限掩盖问题。

```bash
sudo systemctl show sigmaos-hostd.service -p StateDirectory -p StateDirectoryMode -p LogsDirectory
sudo stat -c '%U:%G %a %n' /var/lib/sigmaos /var/lib/sigmaos/docker-daemon /var/lib/sigmaos/network-manager /var/log/sigmaos
sudo systemctl cat sigmaos-hostd.service
```

共享父目录保持 `sigmaos:sigmaos`，Docker 与 NetworkManager 恢复子目录保持 `root:root 700`。升级后检查现有 drop-in 不得重新引入共享父目录声明。CM5 上已有的 `deployment-state.conf` 如设置相同的嵌套目录，可保留；恢复文件无需迁移。修复权限前停止 timers 和所有数据库写入进程，先保存一致备份；仅修复核实错误的目标，不改变恢复材料权限。

在维护窗口分别验证 hostd→API/worker 和 API/worker→hostd 两种启动顺序，以及 hostd 单独重启后 API 仍可访问数据库。查看 `Permission denied`、`SQLITE_CANTOPEN` 和重启计数；不能只检查一次 `/health`。设备重启验收须另行安排，不能用服务重启代替。

## 下载目录权限

下载服务以 `sigmaos` 用户运行。新建存储池挂载后会将池根目录归属设为 `sigmaos:sigmaos`，但已有存储池及其子目录的所有权不会自动更改。若下载任务报 `EACCES`，先确认实际挂载和目标目录权限：

```bash
findmnt -T /srv/nas/pool1/Downloads
namei -l /srv/nas/pool1/Downloads
sudo -u sigmaos test -w /srv/nas/pool1/Downloads
```

仅在确认目标目录应由 SigmaOS 管理后，针对报错的目录修复所有权，例如 `sudo chown sigmaos:sigmaos /srv/nas/pool1/Downloads`。不要递归更改整个存储池或绕过挂载检查；如果目录由共享用户管理，应先核对共享访问策略，再为 `sigmaos` 授予所需的目录写入权限。修复后在下载面板重试失败任务。

## Wi-Fi 与热点

界面显示只读或没有无线设备时，先区分后端、radio、驱动与 hostd：

```bash
nmcli -t -f RUNNING,STATE,CONNECTIVITY,WIFI-HW,WIFI general
nmcli device status
iw dev
sudo systemctl status NetworkManager.service sigmaos-hostd.service --no-pager
sudo journalctl -u NetworkManager.service -u sigmaos-hostd.service -n 100 --no-pager
```

非 NetworkManager 主机不会自动迁移。`wlan0` 为 unmanaged 时检查 NetworkManager 配置和已有 Netplan renderer，不要直接删除外部 profile。扫描失败但状态可读通常表示 hostd、radio 或权限异常；确认 `/run/sigmaos/hostd.sock`、unit 的 `/etc/NetworkManager/system-connections` 写路径以及 `iw` 是否安装。

热点启动失败时，检查 `/var/lib/sigmaos/network-manager/state.json` 和 NetworkManager journal。该文件只记录待恢复 profile UUID，不含密码；不要手工编辑正在使用的状态。若自动恢复失败，使用 `nmcli connection up uuid <uuid> ifname <device>` 恢复，确认客户端连接后再移除对应状态。Wi-Fi/热点密码位于 root-only `.nmconnection` 文件中，不要把文件正文复制到日志或工单。

## Docker 拉取与资源能力

分别检查设备到镜像源的 DNS/TLS、镜像代理 `/v2/` 和实际镜像拉取。`/v2/` 返回 `200` 或认证挑战 `401` 只能证明网络可达，不能证明镜像存在或凭证有效。Registry mirror 在 daemon JSON 中配置，例如 `https://docker.zhubby.com`；SigmaOS Registry 凭证匹配仍按镜像引用，而不是自动改为 mirror 地址。

检查 Engine `/info` 的 `MemoryLimit`、`SwapLimit`、`CpuCfsQuota`、`CpuCfsPeriod` 等属性及内核/cgroup 配置。能力未知或不支持时清空对应限制，不绕过 API 校验。修改 CM5 内核启动参数需备份原配置并有独立维护窗口；本功能不会自动更改宿主机。资源统计 `null` 与资源能力 `false` 是不同信号。

## Docker daemon 配置恢复

先分别检查 service 与 Engine socket，不要把两者混为一个故障：

```bash
sudo systemctl show docker.service -p LoadState -p ActiveState -p SubState -p Result
sudo journalctl -u docker.service -u sigmaos-hostd.service -n 100 --no-pager
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
