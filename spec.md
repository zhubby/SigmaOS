# SigmaOS 项目规格说明

## Summary

SigmaOS 是一个原生 Linux NAS appliance 系统：通过网页提供文件浏览、AI 对话、文件整理建议、审批式文件操作、索引搜索和自动化维护能力。Pi 作为后端 agent 执行内核，不直接暴露给浏览器；系统以 `systemd` 服务部署，使用 SQLite 作为唯一数据库，未来可裁剪为自有 Linux 发行版。

本文档是 SigmaOS v1 的产品和技术规格，目标是让工程实现可以直接按此拆分和落地。

## Product Defaults

- 产品定位：v1 面向个人单机 NAS appliance，不做团队/企业多租户。
- v1 AI 权限：允许 AI 提出文件移动、重命名、归档、建目录等方案；所有写操作必须经用户审批后执行。
- 模型策略：云模型优先，通过 Pi 支持的 provider 接入；本地模型作为后续能力预留。
- 部署策略：不使用 Docker；使用 systemd services/timers，与系统强绑定。
- 数据策略：SQLite-only；不引入 Postgres、Redis、BullMQ。
- 删除策略：v1 不支持永久删除，只移动到 SigmaOS 管理的 trash/quarantine。
- 安全策略：浏览器只访问 SigmaOS API；Pi worker 只运行在受限系统用户和受限路径下。

## Technical Architecture

```text
Browser UI
  -> SigmaOS API service
  -> SQLite job/event/session store
  -> Agent worker service
  -> Pi SDK or pi --mode rpc
  -> Safe NAS tool layer
  -> NAS filesystem + SQLite FTS index
```

推荐技术栈：

- Frontend：React + Vite + TypeScript
- API：Fastify + TypeScript
- Agent Worker：TypeScript 独立进程，优先 SDK，必要时 fallback 到 `pi --mode rpc`
- DB：SQLite + WAL + FTS5
- Query layer：Drizzle 或 Kysely，性能敏感查询保留手写 SQL
- Realtime：SSE 优先；需要双向实时控制时再加 WebSocket
- Services：systemd units + timers
- Packaging：先 `.deb`，再 appliance image，最后裁剪发行版

系统目录约定：

```text
/usr/lib/sigmaos/        packaged api, worker, web assets
/etc/sigmaos/            config.toml, prompts, policy
/var/lib/sigmaos/        sigmaos.sqlite, index, thumbnails, pi-sessions, trash
/run/sigmaos/            Unix sockets and runtime state
/var/log/sigmaos/        optional file logs; journald is primary
```

systemd 单元：

- `sigmaos-api.service`：HTTP API、静态前端、SSE/WebSocket。
- `sigmaos-worker@.service`：Pi agent worker 模板实例。
- `sigmaos-indexer.service`：文件 watcher、hash、metadata、FTS index。
- `sigmaos-scheduler.service`：自动化任务调度。
- `sigmaos-maintenance.timer`：SQLite checkpoint/vacuum、trash cleanup、健康检查。

systemd hardening 默认：

- `User=sigmaos`
- `Group=sigmaos`
- `StateDirectory=sigmaos`
- `RuntimeDirectory=sigmaos`
- `WorkingDirectory=/var/lib/sigmaos`
- `ProtectSystem=strict`
- `ReadWritePaths=/var/lib/sigmaos <configured NAS roots>`
- `NoNewPrivileges=yes`
- `PrivateTmp=yes`
- `CapabilityBoundingSet=`
- `MemoryMax=`, `CPUQuota=`, `TasksMax=` 按硬件配置设置

## Public Interfaces

最小 HTTP API：

- `POST /api/sessions`：创建 AI 会话，绑定 NAS root 和当前目录。
- `POST /api/sessions/:id/messages`：发送用户任务。
- `GET /api/sessions/:id/events`：SSE 订阅 agent 事件、tool calls、审批状态、最终结果。
- `POST /api/jobs/:id/cancel`：取消运行中的任务。
- `GET /api/files?rootId=&path=`：文件浏览。
- `GET /api/search?q=&rootId=`：SQLite FTS 搜索。
- `POST /api/approvals/:id/approve`：执行待审批文件操作。
- `POST /api/approvals/:id/reject`：拒绝待审批操作。
- `POST /api/trash/:id/restore`：恢复 SigmaOS trash 中的文件。

Pi/NAS 工具层：

- Read：`list_dir`, `stat_path`, `read_text`, `preview_file`, `search_files`, `query_index`
- Metadata：`hash_file`, `extract_metadata`, `detect_duplicates`, `ocr_document`
- Mutation：`mkdir`, `move`, `copy`, `rename`, `tag`
- Safety：`propose_changes`, `apply_approved_changes`, `trash_path`, `restore_path`
- Lifecycle：`complete_task`

SQLite 核心表：

- `users`, `nas_roots`, `agent_sessions`, `agent_messages`, `agent_events`
- `jobs`, `tool_calls`, `pending_approvals`, `file_operations`
- `indexed_files`, `indexed_text`, `file_tags`, `trash_entries`

状态约定：

- Job：`queued`, `running`, `waiting_approval`, `completed`, `failed`, `cancelled`
- Approval：`pending`, `approved`, `rejected`, `expired`, `applied`, `failed`
- File operation：`proposed`, `applied`, `rolled_back`, `failed`

## Implementation Plan

### Phase 1 - Read-only MVP

- 建立 monorepo：`apps/web`, `apps/api`, `apps/worker`, `packages/db`, `packages/nas-tools`, `packages/agent`, `packages/shared`。
- 实现 SQLite schema、migration runner、WAL 初始化、基础 job/session/event 存储。
- 实现文件浏览、路径安全校验、只读 NAS tools。
- 接入 Pi worker，完成用户消息到 Pi session，再到 SSE 事件流。
- UI 提供文件浏览、chat、agent timeline。

### Phase 2 - Approval-based Mutations

- 增加 `propose_changes` 和审批模型。
- 实现 `mkdir/move/copy/rename/trash/restore`，所有写操作先记录 proposal。
- UI 展示拟执行操作、影响文件、风险提示和确认按钮。
- 执行后写入 `file_operations`，支持可逆操作 rollback。

### Phase 3 - Indexing

- `sigmaos-indexer.service` 扫描 NAS root，写入 `indexed_files` 和 FTS5。
- 支持文件名、路径、MIME、mtime、size、hash、基础文本抽取。
- Agent 优先通过 `query_index` 搜索，避免全盘扫描。

### Phase 4 - Native Packaging

- 生成 systemd unit/timer 文件和 `/etc/sigmaos/config.toml`。
- 打包 `.deb`，安装到 `/usr/lib/sigmaos`、`/etc/sigmaos`、`/var/lib/sigmaos`。
- first-boot 初始化管理员、NAS root、模型 provider 配置。

### Phase 5 - Appliance Evolution

- 加入调度任务：定期整理建议、备份检查、重复文件报告。
- 增加本地模型适配预留接口。
- 形成可构建系统镜像，预装 Node runtime、Pi、SQLite、systemd units、OCR/media helpers。
- 后续裁剪 Linux userspace，形成 SigmaOS 发行版。

## Test Plan

- Path safety：`../`、绝对路径、符号链接逃逸、Unicode 路径均被拒绝或规范化到允许 root 内。
- Read-only flow：用户询问某目录内容，Pi 只能调用只读工具，UI 收到按序 SSE 事件。
- Approval flow：AI 提出移动 3 个文件，审批前文件系统无变化，审批后才执行。
- Rejection flow：用户拒绝 proposal，job 回到可继续或完成状态，文件系统无变化。
- Trash flow：删除请求只创建 trash entry 并移动到 SigmaOS trash，支持 restore。
- Cancellation：运行中任务取消后 worker 停止继续调用工具，job 状态为 `cancelled`。
- SQLite concurrency：索引器读写期间 API 文件浏览和会话事件读取不阻塞异常。
- Event ordering：tool start/update/end、approval pending、job completion 在 UI 中顺序一致。
- systemd resilience：API/worker 崩溃后按策略重启，未完成 job 可恢复为 queued 或 failed。
- Agent parity：UI 可做的文件浏览、搜索、移动、重命名、trash/restore，agent 都有对应工具路径。
- Security regression：Pi worker 无法写 `/etc`、`/usr`、未授权 home 目录或未配置 NAS root。

## Assumptions

- 首版只支持个人设备，不做企业级 RBAC 和审计合规。
- 首版以云模型验证体验，本地模型后置。
- 首版不支持永久删除。
- SQLite 数据库位于本机磁盘，不放在 SMB/NFS 网络挂载。
- systemd 是目标系统基础设施，不支持非 systemd Linux 作为首版运行环境。
- Pi 不是公共 API；SigmaOS 自己定义 HTTP/SSE API。
