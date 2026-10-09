---
title: 本地开发
description: 在开发机上运行 SigmaOS 的 API、worker、Web 和索引任务。
type: tutorial
status: current
audience: [developer]
sourceOfTruth: [README.md, package.json, apps/api/src/index.ts, apps/worker/src/index.ts, apps/photo-worker/src/index.ts, apps/downloader/src/main.rs]
sidebar:
  order: 2
---

SigmaOS 使用 Node.js 22.12 或更高版本、npm workspaces、严格 TypeScript 和 `rust-toolchain.toml` 固定的 Rust 1.95。API 默认绑定 `127.0.0.1:3010`，Vite Web 默认运行在 `127.0.0.1:5173`。

开发时需要配置独立的 NAS root。`npm run dev` 启动 API、agent worker、photo worker、Rust downloader 和 Web；downloader 会等待 API 应用 migration 022 后再领取任务。indexer、scheduler、maintenance 仍通过单独脚本运行，便于观察每次任务结果。处理 HEIC/HEIF 需要 `libheif-examples`，处理 RAW 需要 `libraw-bin`，视频海报和播放需要 `ffmpeg`。

完成开发验证后，应通过根级 typecheck、lint、test 和 build 检查所有 workspace 与文档站。
