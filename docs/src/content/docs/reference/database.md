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

FTS5 正文索引、照片资源与处理任务、index run history、backup runs、health alerts 和 execution locks 都属于同一数据库的运维状态，不应另起 Redis 或外部队列。

照片库配置保存在 `system_settings.photo_library`；`photo_assets` 保存 root-relative 路径、hash、EXIF 时间、尺寸、衍生图 key 和每次扫描的 `library_updated_at/indexed_at`；`photo_jobs` 保存完整扫描和路径刷新的租约与进度。上传通过独立的 `photo_upload_reservations` 表事务性预留 hash 和目标路径，避免 worker 建索引前的重复或并发上传。设置变化会事务性失效旧资源、上传预留和未完成任务；worker 只有在完整且挂载身份稳定的遍历后才清理 stale 资源、预留及不再引用的旧衍生图缓存。
