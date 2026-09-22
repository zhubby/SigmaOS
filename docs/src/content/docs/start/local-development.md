---
title: 本地开发
description: 在开发机上运行 SigmaOS 的 API、worker、Web 和索引任务。
type: tutorial
status: current
audience: [developer]
sourceOfTruth: [README.md, package.json, apps/api/src/index.ts, apps/worker/src/index.ts, apps/photo-worker/src/index.ts]
sidebar:
  order: 2
---

SigmaOS 使用 Node.js 22.12 或更高版本、npm workspaces 和严格 TypeScript。API 默认绑定 `127.0.0.1:3010`，Vite Web 默认运行在 `127.0.0.1:5173`。

开发时需要配置独立的 NAS root。`npm run dev` 启动 API、agent worker、photo worker、downloader 和 Web；indexer、scheduler、maintenance 仍通过单独脚本运行，便于观察每次任务结果。处理 HEIC/HEIF 需要系统安装 `libheif-examples`；其他支持格式由 Sharp 处理。

完成开发验证后，应通过根级 typecheck、lint、test 和 build 检查所有 workspace 与文档站。
