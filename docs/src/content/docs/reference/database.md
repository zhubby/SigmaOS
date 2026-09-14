---
title: SQLite 与迁移参考
description: SQLite WAL、表域和 migration policy。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [packages/db/src/schema.ts, packages/db/src/connection.ts, packages/db/src/migrations/core.ts, packages/db/src/migrations/production.ts]
sidebar:
  order: 5
---

SQLite 位于 data directory，使用 WAL、foreign keys 和 busy timeout。迁移按递增 ID 执行并写入 `schema_migrations`；新增持久化状态必须同时更新 migration、repository、shared type 和测试。

FTS5 正文索引、index run history、backup runs、health alerts 和 execution locks 都属于同一数据库的运维状态，不应另起 Redis 或外部队列。
