---
title: HTTP、SSE 与 WebSocket 参考
description: API 传输面、端点分组和稳定契约。
type: reference
status: current
audience: [developer]
sourceOfTruth: [apps/api/src/routes/index.ts, apps/api/src/routes/files.ts, apps/api/src/routes/sessions.ts, apps/api/src/routes/docker.ts, apps/api/src/lib/docker-daemon.ts, apps/api/src/lib/docker-registry.ts, apps/web/src/api.ts]
sidebar:
  order: 2
---

REST 路由按 roots、files/search、sessions/jobs/events、approvals/operations、indexer/readiness/health、backup、settings、system、storage、shares、Docker、VM 和 terminal 分组。

Agent 事件通过 session SSE stream 传递；terminal、Docker console 和 VM console 使用 WebSocket。写操作的 approval 要求以 route 实现和 `packages/shared/src/types.ts` 为准；本页不复制易漂移的完整 JSON schema。

## Docker daemon

- `GET /api/docker/daemon/config` 返回固定路径、正文、内容 revision、文件是否存在和是否等待重启。
- `PUT /api/docker/daemon/config` 接收 `content`、`expectedRevision`、`restart` 和 `confirmed`。正文最多 256 KiB；revision 冲突返回 `409`，JSON 或 dockerd 校验失败返回 `400`，helper 不可用返回 `503`，重启或回滚异常返回 `502` 并携带回滚结果。
- `GET /api/docker/daemon/events` 是独立 SSE stream。连接后立即发送 `docker.daemon.status`，服务端每秒采样 `docker.service`、仅在状态变化时推送，并每 15 秒发送 heartbeat。客户端重连提示为 2 秒。

配置正文、代理凭据和恢复基线不得写入日志或通知。`confirmed: true` 表示 UI 已完成二次确认，不是身份认证机制。

## Docker 镜像与 Registry

- `GET /api/docker/summary` 的 `images` 来自与镜像计数相同的一次 Engine 查询，包含 ID、tags、digests、创建时间、大小、共享大小和容器引用数。
- `POST /api/docker/images/pull` 接收 `reference`，同步等待 Engine 完成拉取。SigmaOS 按镜像引用选择匹配凭证，没有匹配项时匿名拉取。
- `POST /api/docker/images/remove` 接收 `reference` 和 `confirmed: true`。删除固定使用 `force=false`、`noprune=true`；被容器引用或存在多引用冲突时返回 `409`，不创建 approval 或 Docker operation。
- `GET /api/docker/registries` 返回凭证摘要；`POST /api/docker/registries`、`PATCH /api/docker/registries/:id`、`DELETE /api/docker/registries/:id` 管理单条记录。创建/更新正文最多 64 KiB，所有响应只包含 `credentialConfigured`，不会返回密码或 access token。

Registry 地址只接受 hostname/IP 和可选端口；Docker Hub 别名归一化为 `docker.io`。未限定 Registry 的镜像和 Docker Hub 别名匹配 `docker.io`；包含点号、端口、`localhost` 或 IP 的首段按私有 Registry 精确匹配。无效地址/引用返回 `400`，重复 Registry 或镜像占用返回 `409`，不存在返回 `404`，Engine 不可用返回脱敏后的 `502`。Registry CRUD 不依赖 Docker 管理开关或 Engine 状态。
