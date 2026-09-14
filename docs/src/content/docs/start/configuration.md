---
title: 配置与环境变量
description: SigmaOS TOML 配置、环境变量覆盖规则和安全默认值。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth: [packages/shared/src/config.ts, config.example.toml, packaging/etc/config.toml]
sidebar:
  order: 2
---

生产配置默认位于 `/etc/sigmaos/config.toml`，可通过 `SIGMAOS_CONFIG` 覆盖。环境变量优先于 TOML；解析后会规范化路径、端口、超时、NAS roots、备份、Docker、VM、terminal 和 health 设置。

最重要的约束是：API 只能绑定 loopback；生产 NAS root 默认要求 mount readiness；Docker 默认关闭；备份仓库必须显式初始化；provider secret 只返回“是否已配置”。完整字段和环境变量应以 `packages/shared/src/config.ts` 为准。
