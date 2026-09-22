---
title: 状态、能力与限制
description: Job、approval、operation、index、backup 和可用能力的当前状态。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [packages/shared/src/types.ts, apps/api/src/lib/docker-daemon.ts, apps/api/src/lib/docker-registry.ts, apps/api/src/lib/network-manager.ts, packages/db/src/repositories/approval-status.ts, packages/db/src/repositories/index-run-status.ts, packages/db/src/repositories/backup-runs.ts]
sidebar:
  order: 4
---

Job 状态包括 `queued`、`running`、`waiting_approval`、`completed`、`failed`、`cancelled`；approval 包括 `pending`、`approved`、`rejected`、`expired`、`applied`、`failed`；文件 operation 记录 proposed、applied、rolled_back、failed。

当前已实现文件浏览、预览、上传、编辑、归档检查、搜索、照片时间线与基础管理、agent、approval、trash/restore、Docker/VM/share/terminal 控制、NetworkManager Wi-Fi/热点控制、indexer、restic backup 和健康 API。照片人脸识别、地图、智能搜索、手动相册、分享链接、编辑、RAW 与视频，及 OCR、实时 watcher、永久删除、静态地址、DNS、bridge、bond、VLAN 等通用网络写配置仍不支持。

## 网络后端与无线能力

接口、地址和路由始终来自内核 `ip` 数据；网络配置后端单独检测。NetworkManager 正常运行时，`canManageWifi` 要求 root `sigmaos-hostd` 可用且至少存在一个无线设备；`canManageHotspot` 还要求设备声明 AP 能力。其他后端继续只读，界面不会把未知后端伪装为 `systemd-networkd`。

无线设备状态通过 `system.wifi.status` SSE 独立更新。SSE 断开时界面显示 `reconnecting`，不把旧状态当作实时状态。扫描是显式请求，保留 BSSID 级结果；界面按 SSID 和安全模式分组并默认使用最强 AP。

同一无线网卡不能同时作为客户端和热点；不同网卡互不影响。热点 autostart 默认关闭，停止热点会同时关闭 autostart 并尝试恢复启动热点前的客户端 profile。成功切换后不设置超时回滚，失败激活会执行即时恢复并公开恢复结果。

## Docker 的两个状态信号

Docker daemon 状态来自 systemd 的 `LoadState`、`ActiveState`、`SubState` 和 `Result`，归一化为 `running`、`starting`、`stopping`、`stopped`、`failed`、`not_installed`；Web SSE 断线时显示 `reconnecting`。即使 SigmaOS 的 Docker 管理开关关闭，daemon 状态仍会采集。

Docker Engine readiness 独立来自配置的 Unix socket。daemon 可以是 `running`，但 socket 因路径、权限或 API 协商问题不可访问；此时界面继续显示 daemon 为 Running，同时展示 Engine 异常并禁用容器、Compose 和控制台操作。不要用 `/api/docker/summary` 中的 Engine `ready` 代替 systemd service 状态，也不要用 daemon Running 推断容器 API 一定可用。

镜像列表、拉取和删除同样依赖 Engine readiness；Engine 不可用时界面保留镜像区域的错误状态并禁用这些操作。Registry 凭证是 SigmaOS 本地设置，不依赖 daemon 或 Engine，可在 Docker 管理关闭时继续新增、轮换和删除。镜像删除是直接管理操作，需要 UI 二次确认和服务端 `confirmed: true`，但不进入 approval；容器生命周期与 Compose 动作仍保持原有 approval 规则。

Registry 凭证会自动用于手动拉取、容器创建时的 `always/missing` 拉取，以及 Compose `pull/up`。首期不支持 push、tag、prune、导入导出、credential helper、自定义 CA、客户端证书、identity token 或逐层拉取进度。

## Docker 资源与镜像占用

Engine ready 不代表内核支持全部资源控制。资源区和创建向导显示 CPU quota/shares、cpuset、内存、swap、PID 能力的可用、不支持、未知状态；只有明确可用的限制才能填写和提交。内存统计可能为 `null`，不应推断容器停止或使用量为零。CM5 上的缺失能力需要单独检查内核/cgroup 配置，不能靠填写容器内存值解决，也不会由 SigmaOS 自动修改启动参数或重启设备。

镜像占用按容器 ImageID 统计，包括停止的容器；镜像 tag 变化不解除引用。ImageID 元数据不完整时保留 Engine 的计数，未知计数会禁用 UI 删除。服务端删除仍重新检查实时容器引用，Engine 的最终非强制删除是并发变化时的保护边界。
