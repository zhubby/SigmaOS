---
title: 安全与信任模型
description: SigmaOS 的 loopback、NAS root、审批和宿主机权限边界。
type: explanation
status: current
audience: [developer, operator]
sourceOfTruth: [apps/api/src/server.ts, apps/api/src/lib/docker-registry.ts, apps/api/src/lib/docker-compose.ts, packages/db/src/repositories/docker-registry-credentials.ts, packages/nas-tools/src/path-safety.ts, apps/share-helper/src/index.ts, apps/terminal-helper/src/index.ts]
sidebar:
  order: 3
---

v1 假设可信的单用户设备，没有多用户认证边界。API 强制绑定 loopback；Nginx 可以把它代理到局域网，但这不等于增加了认证。

所有 NAS 路径都相对于已配置 root 解析，拒绝 traversal、绝对路径和不安全的符号链接逃逸。Pi 的 `read/ls/find/grep` 使用受限 wrapper；`bash/edit/write` 需要 approval。trash 是可恢复隔离区，v1 不永久删除。

Docker socket 近似 root 权限。share-helper 通过受限 root Unix socket 修改 allowlist 配置；terminal-helper 使用配置的非 root passwd 用户运行 PTY，并阻止 sudo 提权。systemd 使用 `ProtectSystem=strict`、`NoNewPrivileges` 和最小 capability 集合。

Docker Registry 密码和 access token 按产品选择以未加密形式保存在权限受限的 SQLite `system_settings` 记录中；数据库文件权限是静态保护边界，设备状态备份可能包含这些凭证。公开 API 只返回是否已配置，不回传明文；日志、operation metadata、错误与通知不得包含密码或认证头。

Engine 拉取使用内存中的 `X-Registry-Auth`，不会调用 `docker login`。Compose `pull/up` 在 systemd `PrivateTmp` 内创建 `0700` 临时目录和 `0600 config.json`，只通过子进程 `DOCKER_CONFIG` 注入，并在成功、失败或超时后清理；没有 Registry 记录时也注入空认证配置，避免继承宿主机的旧凭证。不要在故障报告中粘贴 SQLite 记录或临时认证配置正文。该能力不修改 share-helper、systemd capability 或 `/etc/docker/daemon.json` 的权限边界。

镜像删除必须显式确认。服务端先解析目标镜像 ID 并检查全部容器的引用，再以 `force=false`、`noprune=true` 请求 Engine；即使目标只是多标签镜像中的一个 tag，也拒绝操作被容器引用的镜像。
