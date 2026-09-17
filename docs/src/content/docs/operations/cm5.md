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

- 运行 Debian 12/bookworm 或兼容的 arm64 系统（Debian 13/trixie 也需在目标主机验收）；
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

share-helper 的 root 状态目录应为 `/var/lib/sigmaos/docker-daemon`，不能声明共享父目录或共享 LogsDirectory。父目录和数据库仍由 `sigmaos` 使用，恢复子目录为 `root:root 0700`。现有相同配置的 host drop-in 可保留，升级后检查实际合并 unit；在维护窗口按两种启动顺序验证，并观察 helper 重启是否影响 API/worker。详见[目录所有权排查](/docs/operations/troubleshooting/#服务目录所有权与启动顺序)。

## 升级、保留与回滚

升级前停止 indexer、scheduler、maintenance、health、daily/weekly backup timers，并备份：

```bash
sudo systemctl stop sigmaos-indexer.timer sigmaos-scheduler.timer \
  sigmaos-maintenance.timer sigmaos-health.timer \
  sigmaos-backup-daily.timer sigmaos-backup-weekly.timer
```

停止 timer 不会停止正在运行的任务。确认所有 oneshot 已退出，再停止 API、所有实际启用的 worker 实例、scheduler 和其他状态写入进程，确认 SQLite 没有写入者后才执行以下冷备份。不要对活跃数据库目录直接 tar，也不要只复制 `.sqlite` 而遗漏尚未 checkpoint 的 WAL。在独立备份介质上使用新的受限目录，保留旧包并记录此前启用的服务/timers：

```bash
sudo install -d -o root -g root -m 0700 /srv/backup/sigmaos-upgrade
sudo tar -C /etc -czf /srv/backup/sigmaos-upgrade/config-before-upgrade.tgz sigmaos
sudo tar -C /var/lib -czf /srv/backup/sigmaos-upgrade/state-before-upgrade.tgz sigmaos
```

示例目录必须未被之前升级占用，避免覆盖恢复材料。配置/state 包可能包含未加密秘密，限制权限并转存到加密备份仓库。它不包含默认 Docker volume 数据，容器工作负载需另行备份。

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

## Docker 与 RustFS 分层验收

把结果分为“通过”“失败”“未验证”，记录版本、commit、Engine/API 版本、镜像 digest、时间与脱敏证据。一次创建成功和 HTTP `200` 只能作为冒烟通过，不代表生产验收完成。

1. **基础部署**：核对 dpkg/build-info/Web 版本，检查失败 unit、重启计数、NAS readiness、索引、终端身份及 `/docs/`。终端应以部署指定的非 root 用户（例如 `zhubby`）从其 home 启动 passwd shell 的交互登录模式，而不是 `/var/lib/sigmaos`。
2. **网络与镜像**：从 CM5 检查 DNS/TLS、mirror `/v2/` 和真实 pull；确认 daemon 已加载 `registry-mirrors`。使用不可变的 `rustfs/rustfs@sha256:<verified-digest>` 并确认 arm64，`latest` 仅用于探索，不作为可重复发布依据。
3. **功能路径**：使用临时、最小权限 Registry 账号分别验证手动私有 pull、创建容器的 `missing/always`、Compose `pull/up`；轮换/删除凭证后验证下一次执行使用新状态，并测试拉取失败不泄密。摘要中有镜像不能证明认证成功，匿名可拉取的公开镜像也不能验证凭证集成。
4. **容器与应用**：通过页面创建独立测试 volume/容器，明确 `/data` 命令、非 root 用户、非 privileged、资源能力与重启策略。使用独立名字和测试端口；仅在 LAN 地址绑定 S3/console，不默认暴露到所有接口。确认 inspect、容器状态、重启数、实际日志、S3 health、浏览器登录与对象上传/下载，而非只检查“创建成功”。
5. **删除保护与边界**：确认运行和已停止容器的 ImageID 占用都被统计；未知占用禁用 UI 删除，服务端占用冲突为 `409`。用独立未占用的多标签测试镜像检查具体 tag 删除、确认步骤、取消与失败；不要删除 RustFS 生产镜像。
6. **持久化与恢复**：用隔离对象做 SHA-256 校验，验证测试容器重启、重建后数据保留；执行备份检查并恢复到新 volume，再读回校验。单独安排设备重启窗口，核对服务恢复、数据挂载、volume 与对象可读。执行方法见[Docker 数据备份演练](/docs/how-to/backup-restore/#docker-工作负载的数据)。

CM5 的 0.3.0 初次 RustFS 冒烟中，运行版本为 `1.0.0-rc.6`：S3 `http://192.168.11.91:9000/health` 返回 `ok`；console 登录入口为 `http://192.168.11.91:9001/rustfs/console/auth/login/`，登录后进入 `/rustfs/console/browser/`。直接访问 9001 根路径可能返回 `403`，不能据此判定 console 故障。升级 RustFS 后重新核对版本对应路由；凭证不得放入 URL、截图或 Git。

初次运行中 Engine 26 的镜像容器数和部分内存统计为未知，且内存限制不受支持。新版从 ImageID 补齐占用，并显示/校验资源能力，不会自动启用 CM5 内核 memory controller。初次冒烟并未证明私有 Registry 全路径、设备重启、对象持久化或备份恢复成功；这四项需独立验收。

## 部署后观察与回滚触发

由执行部署的运维人员在维护窗口内，分别在启动后、helper 重启后以及串行任务结束后检查：

```bash
sudo systemctl --failed
sudo systemctl show sigmaos-api.service sigmaos-worker@1.service sigmaos-share-helper.service -p NRestarts -p ExecMainStatus
sudo journalctl -u sigmaos-api.service -u sigmaos-worker@1.service -u sigmaos-share-helper.service --since '15 minutes ago' --no-pager
curl -fsS http://127.0.0.1:3010/api/docker/summary
curl -fsS http://127.0.0.1:3010/api/backup/status
```

健康信号：版本与来源一致、服务重启计数稳定、无 `Permission denied`/`SQLITE_CANTOPEN`、Engine ready、已知 ImageID 的占用数准确、不可用限制被拒绝、应用 health/登录/对象读取正常。新出现的目录所有权变化、反复重启、数据不可读或迁移错误应停止验收和 timers，保留现场并按匹配旧包的状态备份恢复；不要盲目降级数据库或 reset-failed。部署前已存在的 backup 失败单独记录与处理，生产 Go 必须有真实备份与恢复证据。
