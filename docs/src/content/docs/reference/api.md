---
title: HTTP、SSE 与 WebSocket 参考
description: API 传输面、端点分组和稳定契约。
type: reference
status: current
audience: [developer]
sourceOfTruth: [apps/api/src/routes/index.ts, apps/api/src/routes/files.ts, apps/api/src/routes/sessions.ts, apps/api/src/routes/downloads.ts, apps/api/src/routes/docker.ts, apps/api/src/routes/system.ts, apps/api/src/routes/terminal.ts, apps/api/src/lib/docker-daemon.ts, apps/api/src/lib/docker-registry.ts, apps/api/src/lib/network-manager.ts, apps/web/src/api.ts]
sidebar:
  order: 2
---

REST 路由按 roots、files/search、sessions/jobs/events、approvals/operations、indexer/readiness/health、backup、settings、system、storage、shares、Docker、VM 和 terminal 分组。

Agent 事件通过 session SSE stream 传递；terminal、Docker console 和 VM console 使用 WebSocket。写操作的 approval 要求以 route 实现和 `packages/shared/src/types.ts` 为准；本页不复制易漂移的完整 JSON schema。

## Wi-Fi 与热点

- `GET /api/system/network` 同时返回内核接口/路由和 NetworkManager 无线摘要。`capabilities.backend` 为 `NetworkManager`、`systemd-networkd` 或 `unknown`；只有 NetworkManager 与 hostd 同时可用时才开放写操作。
- `POST /api/system/network/wifi/scan|connect|disconnect` 分别扫描、连接和断开；`PUT /api/system/network/wifi/radio` 切换全局 Wi-Fi radio。
- `PATCH/DELETE /api/system/network/wifi/profiles/:id` 只允许修改或遗忘 SigmaOS 创建的 profile。外部 profile 可以通过 `connect` 使用，但更新或删除返回 `409`。
- `PUT /api/system/network/wifi/hotspot` 保存 WPA2 热点；`POST .../hotspot/start|stop` 启停，`DELETE .../hotspot` 删除。热点使用 NetworkManager `ipv4.method=shared`，没有默认上行时仍提供本地网络。
- `GET /api/system/network/wifi/events` 是状态 SSE：立即发送 `system.wifi.status`，每秒采样、仅变化时推送，每 15 秒 heartbeat，重连提示 2 秒。扫描结果不进入 SSE。

写请求最多 64 KiB。SSID 为 1–32 字节；Personal 密码为 8–63 个可打印字符或 64 位十六进制。首期新连接只支持开放、WPA2 Personal 和 WPA3 Personal；WEP、802.1X 和隐藏网络返回 `400`。管理链路切换及破坏性操作要求 `confirmed: true`，它表示 UI 已完成二次确认而不是身份认证。

输入错误为 `400`，缺少设备/profile 为 `404`，外部配置或 revision 冲突为 `409`，NetworkManager 操作或恢复失败为 `502`，后端、hostd 或依赖不可用为 `503`。所有公开响应、日志和通知禁止包含 Wi-Fi 或热点密码。

## Terminal 标签与 WebSocket

- `GET /api/terminal/tabs?rootId=...` 返回指定 NAS root 的初始化状态、按创建顺序排列的标签、活动标签 ID 和整机会话上限。
- `POST /api/terminal/tabs/initialize` 接收 `rootId` 和可选的旧 `legacySessionId`，事务性地完成首次创建或旧会话导入；重复请求不会重复创建同一旧会话。
- `POST /api/terminal/tabs` 新建并激活标签；`PATCH /api/terminal/tabs/:id` 更新可空自定义名称；`POST /api/terminal/tabs/:id/activate` 更新整机共享的活动项。
- `POST /api/terminal/tabs/:id/restart` 销毁对应 tmux shell 但保留标签；`DELETE /api/terminal/tabs/:id` 先销毁 shell，再删除标签。销毁失败返回 `503` 且不修改标签元数据，客户端可以重试。

标签 ID 和旧会话 ID 必须是 UUID；名称去除首尾空格后为 1–64 个字符，也可传 `null` 恢复默认名称。无效 root、ID 或名称返回 `400/404`，会话上限或旧 ID 冲突返回 `409`。删除活动标签时优先激活右侧标签，其次左侧；删除最后一个标签后活动项为 `null`。

`GET /api/terminal?rootId=...` 使用 `sigmaos-terminal-v1` 和 `sigmaos-session.<uuid>` WebSocket subprotocol。已登记标签以 persistent 模式打开；未登记 ID 保持旧客户端兼容并按空闲策略回收。一个标签只允许一个控制连接，新连接建立后旧连接收到 `{ "type": "taken_over" }`。`open` broker 请求的 `persistent` 字段可选，省略时等同旧版非持久会话。

## HTTP 下载

- `POST /api/downloads` 接收 HTTP/HTTPS 地址、`rootId`、`storagePoolId`、目标目录和文件名；只接受无凭据的公网下载地址，目标同名或重复任务返回 `409`。
- `GET /api/downloads` 返回全局历史；`POST /api/downloads/:id/pause|resume|cancel|retry` 按任务状态执行控制，`DELETE /api/downloads/:id` 只移除非运行任务。
- `GET /api/downloads/events` 是按变化推送任务快照的 SSE stream。`GET/PATCH /api/settings/downloads` 管理 `1–3` 的并发数，降低并发不会终止已经运行的任务。
- `sigmaos-downloader.service` 从 SQLite 领取队列任务，使用 NAS 路径安全校验、隐藏 `.part` 文件和无覆盖原子发布；服务重启后过期租约会恢复为队列。

## Docker daemon

- `GET /api/docker/daemon/config` 返回固定路径、正文、内容 revision、文件是否存在和是否等待重启。
- `PUT /api/docker/daemon/config` 接收 `content`、`expectedRevision`、`restart` 和 `confirmed`。正文最多 256 KiB；revision 冲突返回 `409`，JSON 或 dockerd 校验失败返回 `400`，hostd 不可用返回 `503`，重启或回滚异常返回 `502` 并携带回滚结果。
- `GET /api/docker/daemon/events` 是独立 SSE stream。连接后立即发送 `docker.daemon.status`，服务端每秒采样 `docker.service`、仅在状态变化时推送，并每 15 秒发送 heartbeat。客户端重连提示为 2 秒。

配置正文、代理凭据和恢复基线不得写入日志或通知。`confirmed: true` 表示 UI 已完成二次确认，不是身份认证机制。

## Docker 镜像与 Registry

- `GET /api/docker/summary` 的 `images` 来自与镜像计数相同的一次 Engine 查询，包含 ID、tags、digests、创建时间、大小、共享大小和容器引用数。容器列表包含 `imageId`；元数据完整时，引用数按 ImageID 汇总全部容器（包括已停止容器），不按可变 tag 匹配。旧 Engine/适配器未提供完整 ImageID 时保留 Engine 计数，未知为 `null`，不是零。
- `POST /api/docker/images/pull` 接收 `reference`，同步等待 Engine 完成拉取。SigmaOS 按镜像引用选择匹配凭证，没有匹配项时匿名拉取。
- `POST /api/docker/images/remove` 接收 `reference` 和 `confirmed: true`。删除固定使用 `force=false`、`noprune=true`；被容器引用或存在多引用冲突时返回 `409`，不创建 approval 或 Docker operation。
- `GET /api/docker/registries` 返回凭证摘要；`POST /api/docker/registries`、`PATCH /api/docker/registries/:id`、`DELETE /api/docker/registries/:id` 管理单条记录。创建/更新正文最多 64 KiB，所有响应只包含 `credentialConfigured`，不会返回密码或 access token。

Registry 地址只接受 hostname/IP 和可选端口；Docker Hub 别名归一化为 `docker.io`。未限定 Registry 的镜像和 Docker Hub 别名匹配 `docker.io`；包含点号、端口、`localhost` 或 IP 的首段按私有 Registry 精确匹配。无效地址/引用返回 `400`，重复 Registry 或镜像占用返回 `409`，不存在返回 `404`，Engine 不可用返回脱敏后的 `502`。Registry CRUD 不依赖 Docker 管理开关或 Engine 状态。

## Docker 资源限制

`summary.engine.resourceCapabilities` 包含可空布尔字段 `memoryLimit`、`swapLimit`、`cpuQuota`、`cpuShares`、`cpuset`、`pidsLimit`，来自 Engine `/info`。CPU quota 要求 `CpuCfsQuota` 和 `CpuCfsPeriod` 同时为真；缺失或非布尔属性作为未知处理。

容器创建只接受宿主机明确支持的非空限制。内存硬限制和 reservation 要求 `memoryLimit`；swap 要求内存与 swap 均可用；CPU、cpuset、PID 限制要求各自能力。显式不支持或未知时返回 `400`，不创建容器、approval 或 operation。留空表示不请求该限制，仍可创建容器；不要把缺失内存统计解释成零使用量。
