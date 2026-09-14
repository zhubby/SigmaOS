---
title: Indexer
description: NAS 遍历、增量索引、FTS5 和失败保护。
type: explanation
status: current
audience: [developer, operator]
sourceOfTruth: [apps/indexer/src/run.ts, apps/indexer/src/scanner.ts, apps/indexer/src/file-reader.ts, packages/db/src/repositories/indexed-file-maintenance.ts]
sidebar:
  order: 4
---

Indexer 对每个 root 独立执行扫描，跳过 symbolic links，检查文件身份，按 size + mtime 跳过未变化文件，并把有限大小的文本写入 `indexed_text` FTS5 表。

单文件失败不会删除已有索引；目录遍历不完整时不会执行 stale cleanup。当前基线不包含 watcher、OCR、PDF/Office 正文抽取或 mutation-triggered reindex。
