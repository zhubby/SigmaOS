---
title: Raspberry Pi CM5 部署
description: 在 arm64 CM5 上原生构建、安装、验收和回滚 SigmaOS。
type: operation
status: current
audience: [operator]
sourceOfTruth: [packaging/scripts/build-deb.sh, packaging/scripts/install.sh, packaging/debian/rules]
sidebar:
  order: 2
---

CM5 必须在目标 arm64 主机上构建 Debian 包，以匹配 `better-sqlite3` 和 `node-pty` 等原生模块。部署步骤使用参数化的目标主机、staging、release archive 和 backup 路径；密码只能交互输入。

升级前停止 timers，备份配置、SQLite 和 state files，再安装新包。恢复服务时先启动核心服务，再串行运行 indexer、scheduler、health，最后重新启用 timers。保留旧包和部署前备份，直到浏览器、API、终端身份和任务结果全部验收通过。
