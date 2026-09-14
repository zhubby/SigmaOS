---
title: 安全与信任模型
description: SigmaOS 的 loopback、NAS root、审批和宿主机权限边界。
type: explanation
status: current
audience: [developer, operator]
sourceOfTruth: [apps/api/src/server.ts, packages/nas-tools/src/path-safety.ts, apps/api/src/lib/storage-scope.ts, apps/share-helper/src/index.ts, apps/terminal-helper/src/index.ts]
sidebar:
  order: 3
---

v1 假设可信的单用户设备，没有多用户认证边界。API 强制绑定 loopback；Nginx 可以把它代理到局域网，但这不等于增加了认证。

所有 NAS 路径都相对于已配置 root 解析，拒绝 traversal、绝对路径和不安全的符号链接逃逸。Pi 的 `read/ls/find/grep` 使用受限 wrapper；`bash/edit/write` 需要 approval。trash 是可恢复隔离区，v1 不永久删除。

Docker socket 近似 root 权限。share-helper 通过受限 root Unix socket 修改 allowlist 配置；terminal-helper 使用配置的非 root passwd 用户运行 PTY，并阻止 sudo 提权。systemd 使用 `ProtectSystem=strict`、`NoNewPrivileges` 和最小 capability 集合。
