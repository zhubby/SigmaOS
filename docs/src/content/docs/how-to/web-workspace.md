---
title: Web 工作区使用指南
description: 文件浏览、搜索、预览、上传、agent 对话和审批操作的完整流程。
type: how-to
status: current
audience: [user, operator]
sourceOfTruth: [apps/web/src/App.tsx, apps/web/src/components/workspace/WorkspacePane.tsx, apps/web/src/components/workspace/LocalTerminalPanel.tsx, apps/web/src/components/workspace/DockerImageManagement.tsx, apps/web/src/components/chat/ChatPane.tsx, apps/web/src/components/preview/PreviewContent.tsx, apps/web/src/api.ts]
sidebar:
  order: 1
---

## 选择存储范围

打开 Web UI 后，应用会读取 `/api/roots` 并选择第一个可用 root。若主机暴露多个磁盘或 storage pool，在文件面板的 storage pool 切换器中选择目标卷；所有浏览、搜索和写操作都会携带 root 与 storage pool 范围。

如果 root readiness 是 `not_ready`、`offline` 或 `unknown`，先处理挂载问题，不要尝试通过 URL 绕过 root 限制。生产环境的 `mount_policy = "required"` 会阻止未就绪 root 被当成普通目录使用。

## 浏览、搜索和预览

文件面板支持：

- 使用面包屑和返回按钮在目录间移动；
- 按名称、大小和修改时间排序；
- 在当前目录范围内进行文件名/索引搜索；
- 查看文本、图片、音频、视频、PDF、Office 文件等受支持预览；
- 对小于编辑上限的文本文件打开编辑器并保存；
- 查看 Git repository、branch 和 dirty 状态（如果目录位于 Git 仓库内）。

预览是受限读取：超过大小上限的文件不会被完整载入浏览器，视频可能先经过 API 的 FFmpeg cache。预览失败时先检查文件类型、大小和 API 日志。

## 上传文件

点击上传文件或上传目录，也可以把文件拖到文件面板。上传目标是当前目录，单次请求最大为 4 GiB；界面会显示 queued、uploading、completed、failed 或 cancelled 状态。

上传是直接写入目标目录的文件传输，不经过 agent approval。对重要目录，上传前先确认 storage pool 和面包屑路径，完成后刷新列表核对文件大小。

## 使用 Agent

1. 点击新建 agent session，session 会绑定当前 root 和目录。
2. 在输入框描述任务；点击文件路径可以把路径带入消息上下文。
3. 发送后观察事件时间线。API 使用 SSE 推送 agent、tool call、approval 和 job 状态。
4. 需要长时间运行时可以点击停止；取消只影响 queued/running/waiting approval 的 job。

只读请求可以询问目录内容、文件路径和索引结果。Agent 不应被当作绕过路径安全的 shell：所有工具都在配置的 NAS root 内解析。

## 审批与可逆操作

创建目录、移动、复制、重命名、trash、tag、Docker 生命周期/Compose、VM/share/storage 操作以及危险 Pi tool call 会显示 approval 卡片。卡片至少包含操作类型、目标路径、风险和可逆性。Docker 面板中的容器、卷、网络创建在最终确认后直接执行，并写入 operation/job 历史；容器启动失败时会保留已创建容器并显示部分成功警告。

- 点击 **Approve** 后 API 才会执行对应操作；
- 点击 **Reject** 不改变文件系统；
- 文件移除进入 SigmaOS trash，而不是永久删除；
- 已应用的文件操作可在 Activity 中执行 rollback；
- trash 项可通过 restore 恢复，恢复失败时保留原条目并查看 API 错误。

审批前不要根据 agent 的文字回复判断“已经完成”；以 approval 状态和 operation 记录为准。

## 终端与管理面板

Workspace 的 Terminal 使用 terminal-helper 和 tmux 承载受限 PTY。每个 NAS root 有独立的顶部标签列表；标签名称、创建顺序和活动项保存在 SQLite，并在浏览器之间共享。首次打开会自动创建“终端 1”；旧版浏览器保存的会话 ID 会在首次访问时导入。新建标签受整机 `terminal.maxSessions` 限制，默认上限为 32。

切换标签时浏览器保留已经打开标签的本地显示缓冲，但只有活动标签连接 WebSocket。刷新页面、断开浏览器或重启 API/helper 不会终止已登记标签的 tmux shell；重启标签或确认关闭标签会终止其中的 shell 和所有子进程。关闭最后一个标签后保持空状态，不会立即自动创建新标签。未登记的旧客户端会话仍使用原有空闲回收策略。

同一标签同时只允许一个控制端。另一个浏览器连接时，原连接会显示“会话已在其他位置打开”并停止自动重连；点击重新接管会把控制权取回。整机重启后 SQLite 中的标签、名称、顺序和活动项仍保留，但 tmux 进程和 scrollback 不会恢复，首次重新连接会启动新的 shell。连接失败时检查 `tmux`、`sigmaos-terminal-helper.service` 和终端用户 drop-in。

Downloads 面板使用独立 `sigmaos-downloader.service`，支持公网 HTTP/HTTPS 地址、目录选择、排队、暂停/继续、取消、重试和历史；失败任务保留 `.part` 文件，取消任务清理临时文件，同名目标不会覆盖。Docker、VM、Shares、Storage 面板只在配置和宿主机能力可用时展示完整操作；Docker 资源创建是直接执行的管理流程，生命周期和 Compose 变更仍通过 approval。

Docker 面板的镜像区域可以搜索本地镜像、查看完整 ID/tags/digests/占用信息、拉取镜像和删除未被容器引用的具体 tag。删除需要在详情弹窗中再次确认，不会强制删除，也不进入 agent approval。多标签镜像必须先选择要删除的具体 tag；无标签镜像使用完整 ID。

已停止容器仍占用镜像，tag 改名不改变 ImageID 引用。占用数未知时删除按钮也不可用，应刷新并检查 Engine 元数据，不要将未知当作零。

资源区及创建向导显示宿主机资源控制能力。不支持或未知的 CPU、内存、swap、PID 控制会禁用对应输入；留空仍可继续创建。若编辑期间能力变化，原输入不会被静默删除，点击“清除不可用限制”后再继续。是否支持内存限制与是否收到内存统计是不同判断；统计缺失时显示未知，而不是零。

Registry 凭证入口即使 Engine 离线或 Docker 管理关闭也可使用。每个规范化 Registry 只保存一组用户名与密码/access token；编辑时密码字段始终为空，留空表示保留已有凭证。未限定 Registry 的镜像使用 Docker Hub 凭证，显式私有 Registry 只做精确匹配。手动拉取、容器创建的自动拉取以及 Compose `pull/up` 都在执行时读取当前凭证。

设置面板可以修改 model provider、Pi tool policy、Docker 配置、语言、主题、预览大小和编辑器字体。保存 provider secret 后 UI 只显示是否已配置，不会回显密钥。

## 常见状态判断

页面顶部的 API 状态只说明浏览器能否访问 API。遇到索引或备份问题，应同时检查：

```bash
curl -fsS http://127.0.0.1:3010/health
curl -fsS http://127.0.0.1:3010/api/system/health
curl -fsS http://127.0.0.1:3010/api/roots/readiness
curl -fsS http://127.0.0.1:3010/api/indexer/status
curl -fsS http://127.0.0.1:3010/api/backup/status
```
