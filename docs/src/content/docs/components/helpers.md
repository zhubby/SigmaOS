---
title: 宿主机 Helpers
description: share-helper 和 terminal-helper 的 Unix socket 权限隔离。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [apps/share-helper/src/index.ts, apps/share-helper/src/helper.ts, apps/terminal-helper/src/index.ts, packaging/systemd/sigmaos-share-helper.service]
sidebar:
  order: 6
---

share-helper 以 root 运行，但只接受固定 HTTP Unix socket 路径、allowlist 命令和配置目标。terminal-helper 以配置的非 root 用户运行 tmux，并通过 attach PTY 提供终端。session 名称由 NAS root 和客户端 session ID 稳定生成，因此 API 或 WebSocket 重连只会重新 attach，不会重复创建 shell；tmux socket 位于终端用户 home 下。helper 限制 frame、输出和并发 session，并通过 systemd drop-in 绑定用户 home；空闲 session 会按配置回收。

API 通过 Unix socket 调用 helper；浏览器永远不直接连接宿主机 socket。

## Docker daemon 配置边界

share-helper 还提供固定的 Docker daemon 配置操作。它只允许读写 `/etc/docker/daemon.json`，只允许重启 `docker.service`，请求不能传入路径、unit 或任意命令。API 进程仍以 `sigmaos` 用户运行，不获得 root 或 capabilities。

保存前 API 与 helper 都会解析 JSON 并要求顶层为对象；helper 随后运行 `dockerd --validate --config-file`。目标若为符号链接或非普通文件会被拒绝。写入使用 `/etc/docker` 同目录临时文件、`0644 root:root` 权限和原子 rename，并以内容 SHA-256 revision 防止覆盖 SSH 或其他进程的并发修改。

第一次保存待应用配置时，helper 在 root 专用的 `/var/lib/sigmaos/docker-daemon/`（`0700 root:root`）保存最后已生效的基线和事务元数据。继续保存只更新待应用版本，不覆盖基线。重启成功后事务材料会清理；重启失败时 helper 恢复基线并再次启动 Docker。若回滚启动也失败，恢复材料会保留供人工处理。
