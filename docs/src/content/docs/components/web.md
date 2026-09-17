---
title: Web UI
description: React/Vite 工作区、预览、设置和管理面板。
type: reference
status: current
audience: [developer]
sourceOfTruth: [apps/web/src/App.tsx, apps/web/src/api.ts, apps/web/src/components/workspace/WorkspacePane.tsx, apps/web/src/components/workspace/HttpDownloaderPanel.tsx, apps/web/package.json]
sidebar:
  order: 1
---

`apps/web` 是 React 19 + Vite 7 单页应用，负责文件浏览、预览、chat、approval、operations、terminal、HTTP 下载、Docker/VM/share/storage 管理和设置。API 契约在 `apps/web/src/api.ts` 与共享类型中维护。

前端通过 REST 读取状态，通过 SSE 订阅 agent/job/download 事件，通过 WebSocket 连接终端和 console。文件预览有大小限制，视频可使用 API 的 FFmpeg cache，界面支持中英文和明暗主题。
