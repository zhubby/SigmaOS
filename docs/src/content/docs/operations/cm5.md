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

CM5 必须在目标 arm64 主机上构建 Debian 包，以匹配 `better-sqlite3` 和 `node-pty` 等原生模块。不要在 x64 开发机编译后直接复制 `node_modules` 到 CM5。

## CM5 前置条件

- 运行 Debian 12/bookworm 或兼容的 arm64 系统；
- 至少准备一个非 root 本地用户作为 terminal-helper 身份；
- 将 NAS 数据盘挂载到 `/srv/nas`，需要备份时将仓库放在与 NAS、`/var/lib/sigmaos` 不重叠的 `/srv/backup`；
- 确保构建阶段可以访问 APT、Node.js release 和 npm registry，或传入内部镜像；
- 预留足够空间用于 `.sigmaos/deb-build`、`docs/node_modules` 和 Debian 产物。

## 原生构建与安装

在 CM5 checkout 根目录执行：

```bash
git fetch --tags origin
git checkout <release-ref>
npm ci
npm --prefix docs ci
SIGMAOS_NPM_REGISTRY=https://registry.npmmirror.com \
  ./packaging/scripts/build-deb.sh
```

若系统 Node.js 版本不满足要求，可让安装脚本下载并校验 Node.js 22.23.2：

```bash
sudo SIGMAOS_TERMINAL_USER=<terminal-user> \
  SIGMAOS_NAS_ROOT_PATH=/srv/nas \
  SIGMAOS_ENABLE_NGINX=1 \
  ./packaging/scripts/install.sh
```

安装脚本支持 `SIGMAOS_APT_MIRROR`、`SIGMAOS_APT_SECURITY_MIRROR`、`SIGMAOS_RPI_MIRROR`、`SIGMAOS_NODE_MIRROR` 和 `SIGMAOS_NPM_REGISTRY`。它会先备份并修改已知源，再构建当前 checkout 的 Debian 包；在生产主机上应保存脚本输出和 `.sigmaos` 产物。

## CM5 验收清单

```bash
sudo systemctl is-active sigmaos-api.service sigmaos-worker@1.service
sudo systemctl is-active sigmaos-terminal-helper.service sigmaos-share-helper.service
sudo systemctl list-timers 'sigmaos-*'
curl -fsS http://127.0.0.1:3010/health
curl -fsS http://127.0.0.1:3010/api/roots/readiness
curl -fsS http://127.0.0.1:3010/api/system/health
```

然后从浏览器验证 Web 和 `/docs/`，选择 NAS root，打开终端，上传一个小文件，执行一次索引并确认 `/api/indexer/status` 有完成记录。不要只以 systemd 的 `active` 判断 oneshot 任务成功；请查看对应 journal 和数据库状态。

## 升级、保留与回滚

升级前停止 indexer、scheduler、maintenance、health、daily/weekly backup timers，并备份：

```bash
sudo systemctl stop sigmaos-indexer.timer sigmaos-scheduler.timer \
  sigmaos-maintenance.timer sigmaos-health.timer \
  sigmaos-backup-daily.timer sigmaos-backup-weekly.timer
sudo tar -C /etc -czf /srv/backup/sigmaos-config-before-upgrade.tgz sigmaos
sudo tar -C /var/lib -czf /srv/backup/sigmaos-state-before-upgrade.tgz sigmaos
```

安装新包后先启动 API、worker 和 helpers，再串行运行 `sigmaos-indexer.service`、`sigmaos-scheduler.service`、`sigmaos-health.service`，最后重新启用 timers。保留旧 `.deb` 与备份，直到浏览器、API、终端身份、root readiness、索引和备份结果全部通过验收。

降级不会自动回滚数据库 migration。若新版本已执行 schema migration，使用与旧包匹配的 SQLite/state 备份恢复，再安装旧包；不要在没有备份的情况下直接覆盖生产数据库。

## 固定构建来源

从计划部署的 checkout 构建时，显式传递待验收的提交：

```bash
SOURCE_COMMIT="$(git rev-parse HEAD)"
SIGMAOS_BUILD_COMMIT_SHA="$SOURCE_COMMIT" \
  SIGMAOS_BUILD_BRANCH="$(git branch --show-current)" \
  packaging/scripts/build-deb.sh
```

tagged release 应同时设置 `SIGMAOS_BUILD_TAG=v<version>` 和 `SIGMAOS_BUILD_SOURCE=release`。普通 CM5 checkout 构建会自动记录为 `local`，无需伪装成正式发布。

## 部署后追溯验收

安装并启动服务后，同时校验 dpkg 版本、构建元数据文件和 API。以下命令要求当前 shell 中仍保留构建时的 `SOURCE_COMMIT`：

```bash
EXPECTED_VERSION="$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version')"
INSTALLED_VERSION="$(dpkg-query -W -f='${Version}' sigmaos)"
test "$INSTALLED_VERSION" = "$EXPECTED_VERSION"

curl -fsS http://127.0.0.1:3010/api/system/build-info > /tmp/sigmaos-build-info.json
node -e '
  const fs = require("node:fs");
  const build = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).build;
  if (build.version !== process.argv[2] || build.commitSha !== process.argv[3]) process.exit(1);
' /tmp/sigmaos-build-info.json "$EXPECTED_VERSION" "$SOURCE_COMMIT"
```

验收还应确认设置弹窗的“版本”分类显示相同版本和完整 commit SHA。任一值不一致时停止扩大部署范围，保留旧包，并按部署前备份执行回滚。
