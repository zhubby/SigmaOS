---
title: 宿主机 Helpers
description: share-helper 和 terminal-helper 的 Unix socket 权限隔离。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [apps/share-helper/src/index.ts, apps/share-helper/src/helper.ts, apps/terminal-helper/src/index.ts, apps/terminal-helper/src/session-policy.ts, packages/shared/src/terminal-protocol.ts, packaging/systemd/sigmaos-share-helper.service, packaging/systemd/sigmaos-terminal-helper.service]
sidebar:
  order: 6
---

share-helper 以 root 运行，但只接受固定 HTTP Unix socket 路径、allowlist 命令和配置目标。terminal-helper 以配置的非 root 用户运行 tmux，并通过 attach PTY 提供终端。session 名称由 NAS root 和标签 ID 稳定生成，因此 API 或 WebSocket 重连只会重新 attach，不会重复创建 shell；tmux socket 位于终端用户 home 下。

API 在已登记标签的 broker `open` 请求中发送可选的 `persistent: true`。helper 把该状态写入 tmux session 的 `@sigmaos_persistent` 选项；空闲 reaper 和容量淘汰都会跳过这些 session。未携带标记的旧客户端 session 继续按配置的空闲时间回收。整机上所有持久与非持久 session 共同受 `terminal.maxSessions` 限制，容量不足时只可淘汰非持久 session。

关闭或重启标签时，API 使用稳定 session 名称向 helper 发送 destroy，即使当前没有 WebSocket 连接也会终止 tmux session。销毁失败时 API 保留 SQLite 标签，避免元数据宣称进程已结束。API/helper 进程重启不会影响仍由 tmux 承载的 shell；主机重启会终止 tmux，之后同一标签首次连接时创建新 shell，不恢复旧进程或 scrollback。

API 通过 Unix socket 调用 helper；浏览器永远不直接连接宿主机 socket。

## Docker daemon 配置边界

share-helper 还提供固定的 Docker daemon 配置操作。它只允许读写 `/etc/docker/daemon.json`，只允许重启 `docker.service`，请求不能传入路径、unit 或任意命令。API 进程仍以 `sigmaos` 用户运行，不获得 root 或 capabilities。

保存前 API 与 helper 都会解析 JSON 并要求顶层为对象；helper 随后运行 `dockerd --validate --config-file`。目标若为符号链接或非普通文件会被拒绝。写入使用 `/etc/docker` 同目录临时文件、`0644 root:root` 权限和原子 rename，并以内容 SHA-256 revision 防止覆盖 SSH 或其他进程的并发修改。

第一次保存待应用配置时，helper 在 root 专用的 `/var/lib/sigmaos/docker-daemon/`（`0700 root:root`）保存最后已生效的基线和事务元数据。继续保存只更新待应用版本，不覆盖基线。重启成功后事务材料会清理；重启失败时 helper 恢复基线并再次启动 Docker。若回滚启动也失败，恢复材料会保留供人工处理。
