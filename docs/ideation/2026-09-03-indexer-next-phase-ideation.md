---
date: 2026-09-03
topic: indexer-next-phase
focus: Indexer 生产基线之后的功能推进
---

# Ideation: Indexer 生产基线之后的功能推进

## Codebase Context

SigmaOS 是严格 TypeScript npm monorepo，运行在 Node.js 22、Debian 和 systemd 上。核心链路为 React/Vite Web UI、Fastify API、SQLite WAL/FTS5、独立的 worker/indexer/scheduler，以及 root-relative 的 NAS 安全访问工具。

`apps/indexer` 已完成生产基线：不跟随 symlink，执行 root-relative 安全校验，按 `mtime + size` 增量索引，单文件失败时保留旧索引，遍历不完整时跳过 stale cleanup，多 root 独立运行，并通过 `/api/indexer/status` 暴露最近运行计数和失败路径。搜索已经支持目录边界和真实文件元数据，agent 的 `query_index` 也遵守当前 session 目录。

当前模型仍是 systemd 每 30 分钟一次的最终一致扫描。代码和文档显示的主要空白是：备份尚未执行、状态 API 缺少进度/耗时/趋势和主动告警、没有定向重索引入口、搜索过滤能力有限、root/mount 策略仍偏硬编码、API 默认假设可信本机、正文能力限于有界文本。仓库没有现成的 `docs/solutions/` 历史方案可复用，因此本次生产基线经验也应在后续沉淀。

## Ranked Ideas

### 1. 真实备份与恢复闭环
**Priority:** P0 生产安全
**Description:** 为每个 NAS root 配置本地、远端或对象存储目标，支持加密增量快照、校验、保留策略、失败重试、恢复验证和定期恢复演练。首版应先明确目标适配范围、密钥管理、manifest 格式和恢复验收标准。
**Rationale:** `scheduler` 目前只能报告 `no-backup-target-configured`，真实用户数据没有灾难兜底。这是 NAS 产品最大的生产风险，也决定后续索引数据库和配置能否可靠恢复。
**Downsides:** 外部目标、密钥和恢复演练会引入较大的运维面；错误的备份成功判定比明确失败更危险。
**Confidence:** 98%
**Complexity:** High
**Status:** Unexplored

### 2. Root 配置与挂载就绪管理
**Priority:** P0 生产安全
**Description:** 将 root、启停状态、忽略规则、扫描周期和资源上限迁移到可验证配置；运行前检查 mount/device identity，挂载缺失或切换到空目录时暂停扫描和 stale cleanup，恢复后执行补偿扫描并留下审计记录。
**Rationale:** 当前多 root 已存在，但策略仍有硬编码，NAS mount 生命周期又是 appliance 环境中的常见故障源。即使 indexer 已避免不完整遍历误删，明确的 readiness 状态仍能减少误操作并让管理员知道为何某个 root 没有更新。
**Downsides:** 需要配置迁移、UI/API 设计和平台差异处理；mount 身份判断必须兼容本地盘、网络盘和开发环境。
**Confidence:** 95%
**Complexity:** Medium-High
**Status:** Unexplored

### 3. Indexer 健康控制面与告警
**Priority:** P0 生产运维
**Description:** 扩展状态 API 和 Web 运维视图，提供当前进度、最近成功时间、耗时、扫描速率、索引文件/文本数量、数据库索引大小、失败率、连续失败次数和 freshness；写入结构化 journal，并对卡住、连续失败、mount 异常和过期 run 触发告警。
**Rationale:** 现有 status API 能回答“最后一轮统计是多少”，但不能回答“现在是否卡住、是否持续变慢、结果是否新鲜”。可观测性是定向重索引、事件队列和性能优化的共同基础。
**Downsides:** 指标定义、历史保留和告警降噪需要取舍；UI 不能只展示一堆计数而缺少可操作入口。
**Confidence:** 97%
**Complexity:** Medium
**Status:** Unexplored

### 4. 受控的定向重索引作业
**Priority:** P1 用户价值
**Description:** 支持按 root、目录或文件触发重索引，提供 API/CLI（后续再接 UI），使用 root 级锁、任务去重、排队、取消、超时、退避和进度反馈；与周期扫描共享同一 run/status 模型。
**Rationale:** 当前修改后的文件最多要等一个 30 分钟周期，漏索引或失败路径也只能等待下一轮。定向刷新可以低成本复用现有增量逻辑，直接改善用户体验和运维排障效率。
**Downsides:** 需要防止手动任务与 timer、未来 watcher 相互覆盖；触发类 API 必须先纳入认证和审计边界。
**Confidence:** 96%
**Complexity:** Medium
**Status:** Unexplored

### 5. Search 2.0：统一过滤、排序和分页
**Priority:** P1 用户价值
**Description:** 在 FTS 和文件名 fallback 上统一支持 path、扩展名、MIME、大小、修改时间过滤，提供稳定分页和匹配来源/相关性排序，并返回索引更新时间与 freshness 提示；保持现有响应字段兼容。
**Rationale:** 目录范围已经修复，真实元数据也已补齐，下一步应把“能搜到”提升为大 NAS 上可定位、可解释、可继续缩小的检索体验。统一查询模型还能同时服务 Web 和 agent。
**Downsides:** FTS 相关性和文件名匹配的排序规则需要产品决策；分页游标和过滤组合会增加 API/测试矩阵。
**Confidence:** 93%
**Complexity:** Medium
**Status:** Unexplored

### 6. API 安全边界与能力令牌
**Priority:** P1 生产安全
**Description:** 为文件、搜索、状态以及未来重索引/备份端点增加本地令牌或 Unix-socket ACL、按 root/操作授权、审计日志和反向代理/TLS 部署基线；保留本机单用户默认体验，但让网络暴露变成明确配置。
**Rationale:** README 当前明确假设可信单用户本机。随着状态控制面、定向任务和备份目标进入 API，继续依赖“不要暴露到网络”的运维约定会扩大数据泄露和误操作面。
**Downsides:** 认证失败、凭据轮换和救援访问会增加安装复杂度；必须避免破坏现有本地开发流程。
**Confidence:** 91%
**Complexity:** Medium-High
**Status:** Unexplored

### 7. 内容抽取器插件平台
**Priority:** P2 能力扩展
**Description:** 先定义 `detector -> extractor -> bounded content -> indexed_text` 的版本化契约，再按 MIME 注册 PDF、Office、OCR 等 extractor。每个 extractor 都要有大小上限、超时、资源配额、失败隔离、可观测性和按版本重抽取能力。
**Rationale:** 当前正文只覆盖有界文本，用户无法搜索大量文档和图片内容。插件化能把后续解析能力从核心 indexer 中隔离出来，避免第三方解析器拖垮扫描进程。
**Downsides:** 第三方依赖和解析质量会带来供应链、资源和兼容性风险；在没有索引健康指标之前很难判断投入是否值得。
**Confidence:** 87%
**Complexity:** High
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected or Folded |
|---|------|---------------------------|
| 1 | 独立的通用任务控制平面 | 先作为“定向重索引作业”的最小 root 级队列实现；过早抽象会同时绑住备份、抽取和 watcher。 |
| 2 | 实时 filesystem watcher | 依赖定向作业、去抖和持久队列；网络挂载事件丢失/重启补偿尚未验证，暂列为定向重索引之后的 P2。 |
| 3 | 有限并发读取/hash 与 checkpoint | 有价值但应先用可观测性确认瓶颈；当前串行写入是有意的安全基线，过早并发会增加 SQLite 锁和资源失控风险。 |
| 4 | 索引完整性检查与自动自愈 | 作为健康控制面和 maintenance 的检查项推进，不单独拆成首批产品面，避免重复状态模型。 |
| 5 | 内容寻址、版本化索引缓存 | 对未来大规模抽取有杠杆，但当前数据规模和 extractor 版本管理尚未证明需要，属于过早存储演进。 |
| 6 | 索引数据库/manifest 回滚 | 合并到备份恢复闭环；单独做索引版本回滚无法解决真实 NAS 数据恢复问题。 |
| 7 | VM、网络和存储写配置 | 属于整机 appliance 演进，和 Indexer 生产基线耦合较弱；应在 mount readiness 和 API 安全边界稳定后另立路线。 |
| 8 | 直接加入 OCR/PDF/Office 实现 | 解析依赖和资源隔离尚未准备好；先落 extractor contract，再选择首个高价值格式。 |

## Recommended Sequence

```text
P0  备份与恢复闭环 + Root/mount readiness
P0  Indexer 健康控制面、结构化日志与告警
P1  定向重索引作业（API/CLI、锁、去重、取消）
P1  API 安全边界（在开放控制类端点前完成）
P1  Search 2.0（过滤、分页、排序、新鲜度）
P2  extractor 插件平台
P2  watcher -> durable queue -> targeted reindex
P2  有限并发和大 NAS 性能治理（以指标驱动）
```

## Session Log

- 2026-09-03: Initial ideation — 30 个原始候选经过去重和批判筛选，7 个方向保留，8 个方向拒绝或合并。
