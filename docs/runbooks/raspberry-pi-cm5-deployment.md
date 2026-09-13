# Raspberry Pi CM5 远程部署 Runbook

本文档用于从本仓库向 Raspberry Pi CM5 部署 SigmaOS，覆盖首次安装、已安装设备的重新部署、验收、回滚和故障排查。

## 固定环境

| 项目 | 值 |
| --- | --- |
| 目标主机 | `zhubby@192.168.11.91` |
| 系统 | Debian 13 / `arm64` |
| Node.js | 22.x；当前安装脚本默认 `v22.23.2` |
| Web 入口 | `http://192.168.11.91/` |
| API 监听 | `http://127.0.0.1:3010`，仅由 Nginx 反向代理 |
| 配置 | `/etc/sigmaos/config.toml` |
| 持久数据 | `/var/lib/sigmaos` |
| 发布包归档 | `/home/zhubby/sigmaos-deployments/<时间戳>/` |
| 部署前备份 | `/var/backups/sigmaos/deploy-<时间戳>/` |

SSH 和 `sudo` 密码只能在提示符中交互输入，不得写入本文档、脚本、环境变量或 shell 历史。目标机禁用 root SSH；所有特权操作使用 `zhubby` 登录后执行 `sudo`。推荐提前配置 SSH key。

## 部署原则

- 必须在目标 CM5 上原生构建 `arm64` Debian 包。不要在 macOS 或其他架构上构建后复制到 CM5；`better-sqlite3`、`node-pty` 等原生模块必须与目标架构匹配。
- `packaging/scripts/install.sh` 仅用于首次安装。它会调用 `sigmaos-first-boot.sh`，并重写 `/etc/sigmaos/config.toml`；已安装设备重部署时不得运行它。
- 每次部署使用新的 `mktemp` staging 目录，并排除 `.git`、`node_modules`、`.sigmaos`、`dist` 和 `coverage`。
- Debian 包版本当前保持不变，安装时必须使用 `--reinstall`。使用 `--force-confold` 保留现有配置。
- indexer、scheduler 和 health 是一次性任务。部署后按顺序运行，避免 indexer 与 scheduler 并发写 SQLite 导致 `SQLITE_BUSY`。
- 在浏览器验收完成前，不删除新旧 Debian 包和部署前备份。

## 通用准备

以下命令在本地仓库根目录运行：

```bash
export SIGMAOS_TARGET='zhubby@192.168.11.91'
export SIGMAOS_HOST='192.168.11.91'
export SIGMAOS_RELEASE="$(date +%Y%m%d-%H%M%S)"

test -x packaging/scripts/build-deb.sh
ssh -t "$SIGMAOS_TARGET" 'sudo -v'
ssh "$SIGMAOS_TARGET" 'set -eu; test "$(dpkg --print-architecture)" = arm64; uname -a; if command -v node >/dev/null 2>&1; then node --version; else echo "Node.js is not installed yet"; fi; df -h /'
```

确认本地将要部署的内容。`rsync` 会包含当前工作区中的未提交修改：

```bash
git status --short
git rev-parse HEAD
npm run typecheck
npm run lint
npm test
npm run build
```

创建独立 staging 目录并同步源码：

```bash
export SIGMAOS_STAGE="$(ssh "$SIGMAOS_TARGET" "mktemp -d '/home/zhubby/sigmaos-stage-${SIGMAOS_RELEASE}.XXXXXX'")"

rsync -az --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.sigmaos/' \
  --exclude='dist/' \
  --exclude='coverage/' \
  ./ "$SIGMAOS_TARGET:$SIGMAOS_STAGE/"

printf 'release=%s\nstage=%s\n' "$SIGMAOS_RELEASE" "$SIGMAOS_STAGE"
```

## 首次安装

仅在 `sigmaos` 包尚未安装、且不需要保留现有 `/etc/sigmaos/config.toml` 时执行本节。

```bash
ssh "$SIGMAOS_TARGET" 'if dpkg-query -W sigmaos >/dev/null 2>&1; then echo "sigmaos is already installed; use the redeployment procedure" >&2; exit 1; fi'

ssh -t "$SIGMAOS_TARGET" \
  "cd '$SIGMAOS_STAGE' && sudo env SIGMAOS_NAS_ROOT_PATH=/srv/nas packaging/scripts/install.sh"
```

安装脚本会配置软件源、Node.js、构建依赖、Nginx、SigmaOS 配置和核心服务。首次安装完成后，显式运行一次 indexer、scheduler 和 health，再启动全部 timers：

```bash
ssh -t "$SIGMAOS_TARGET" 'sudo systemctl start sigmaos-indexer.service'
ssh -t "$SIGMAOS_TARGET" 'sudo systemctl start sigmaos-scheduler.service'
ssh -t "$SIGMAOS_TARGET" 'sudo systemctl start sigmaos-health.service'
ssh -t "$SIGMAOS_TARGET" 'sudo systemctl enable --now sigmaos-indexer.timer sigmaos-scheduler.timer sigmaos-maintenance.timer sigmaos-backup-daily.timer sigmaos-backup-weekly.timer sigmaos-health.timer'
```

随后按“归档新包”和“部署验收”两节操作。

## 已安装设备重新部署

### 1. 远端原生构建

确认目标机已有构建依赖；首次安装脚本通常已安装这些依赖：

```bash
ssh "$SIGMAOS_TARGET" 'set -eu; dpkg-query -W sigmaos build-essential debhelper dpkg-dev fakeroot rsync nodejs npm; test "$(node --version | cut -d. -f1)" = v22'
```

在 CM5 staging 目录中构建并运行打包测试：

```bash
ssh "$SIGMAOS_TARGET" "cd '$SIGMAOS_STAGE' && packaging/scripts/build-deb.sh"
```

### 2. 归档新包

每个新包必须先归档并生成校验和，不能只保留 staging 中的临时文件：

```bash
export SIGMAOS_BUILT_DEB="$(ssh "$SIGMAOS_TARGET" "find '$SIGMAOS_STAGE/.sigmaos' -maxdepth 1 -type f -name 'sigmaos_*_arm64.deb' ! -name '*dbgsym*' | sort | tail -n 1")"
test -n "$SIGMAOS_BUILT_DEB"

export SIGMAOS_DEB_NAME="${SIGMAOS_BUILT_DEB##*/}"
export SIGMAOS_RELEASE_DIR="/home/zhubby/sigmaos-deployments/$SIGMAOS_RELEASE"
export SIGMAOS_REMOTE_DEB="$SIGMAOS_RELEASE_DIR/$SIGMAOS_DEB_NAME"

ssh "$SIGMAOS_TARGET" "set -eu; test ! -e '$SIGMAOS_RELEASE_DIR'; install -d '$SIGMAOS_RELEASE_DIR'; install -m 0644 '$SIGMAOS_BUILT_DEB' '$SIGMAOS_REMOTE_DEB'; sha256sum '$SIGMAOS_REMOTE_DEB' > '$SIGMAOS_RELEASE_DIR/SHA256SUMS'"
git rev-parse HEAD | ssh "$SIGMAOS_TARGET" "cat > '$SIGMAOS_RELEASE_DIR/SOURCE_COMMIT'"
git status --short | ssh "$SIGMAOS_TARGET" "cat > '$SIGMAOS_RELEASE_DIR/SOURCE_STATUS'"
ssh "$SIGMAOS_TARGET" "cat '$SIGMAOS_RELEASE_DIR/SHA256SUMS'"
```

首次安装也应执行本节，归档安装脚本生成的 Debian 包。

### 3. 停写、备份并安装

先检查数据量和可用空间。备份与发布包位于系统盘，必须预留足够空间：

```bash
ssh -t "$SIGMAOS_TARGET" 'sudo du -sh /var/lib/sigmaos; sudo df -h /var/lib/sigmaos /var/backups'
```

打开保留发布变量的远端 root shell：

```bash
ssh -t "$SIGMAOS_TARGET" \
  "sudo env SIGMAOS_RELEASE='$SIGMAOS_RELEASE' SIGMAOS_DEB='$SIGMAOS_REMOTE_DEB' bash"
```

以下整段在该远端 root shell 中运行。构建阶段不影响在线服务；从停止 timers 开始进入维护窗口：

```bash
set -euo pipefail

test -f "$SIGMAOS_DEB"
test -f /etc/sigmaos/config.toml
test -d /var/lib/sigmaos

SIGMAOS_BACKUP_DIR="/var/backups/sigmaos/deploy-$SIGMAOS_RELEASE"
test ! -e "$SIGMAOS_BACKUP_DIR"
install -d -m 0700 "$SIGMAOS_BACKUP_DIR"
dpkg-query -W -f='${Package} ${Version} ${Architecture}\n' sigmaos \
  > "$SIGMAOS_BACKUP_DIR/installed-package.txt"

systemctl stop \
  sigmaos-indexer.timer \
  sigmaos-scheduler.timer \
  sigmaos-maintenance.timer \
  sigmaos-backup-daily.timer \
  sigmaos-backup-weekly.timer \
  sigmaos-health.timer

systemctl stop \
  sigmaos-worker@1.service \
  sigmaos-api.service \
  sigmaos-share-helper.service \
  sigmaos-indexer.service \
  sigmaos-scheduler.service \
  sigmaos-maintenance.service \
  sigmaos-backup-daily.service \
  sigmaos-backup-weekly.service \
  sigmaos-health.service

cp -a /etc/sigmaos/config.toml "$SIGMAOS_BACKUP_DIR/config.toml"
sqlite3 /var/lib/sigmaos/sigmaos.sqlite \
  ".backup '$SIGMAOS_BACKUP_DIR/sigmaos.sqlite'"
tar \
  --exclude='./sigmaos.sqlite' \
  --exclude='./sigmaos.sqlite-wal' \
  --exclude='./sigmaos.sqlite-shm' \
  -C /var/lib/sigmaos \
  -czf "$SIGMAOS_BACKUP_DIR/state-files.tar.gz" .
sha256sum "$SIGMAOS_BACKUP_DIR"/* > "$SIGMAOS_BACKUP_DIR/SHA256SUMS"

apt-get \
  -o Dpkg::Options::=--force-confold \
  install -y --no-install-recommends --reinstall "$SIGMAOS_DEB"

if ! cmp -s "$SIGMAOS_BACKUP_DIR/config.toml" /etc/sigmaos/config.toml; then
  cp -a "$SIGMAOS_BACKUP_DIR/config.toml" /etc/sigmaos/config.toml
  echo 'config.toml changed during package install; restored backup' >&2
  exit 1
fi

systemctl daemon-reload
/usr/lib/sigmaos/scripts/sigmaos-refresh-groups.sh

systemctl enable \
  sigmaos-share-helper.service \
  sigmaos-api.service \
  sigmaos-worker@1.service \
  sigmaos-indexer.timer \
  sigmaos-scheduler.timer \
  sigmaos-maintenance.timer \
  sigmaos-backup-daily.timer \
  sigmaos-backup-weekly.timer \
  sigmaos-health.timer \
  nginx.service

systemctl start sigmaos-share-helper.service
systemctl start sigmaos-api.service
systemctl start sigmaos-worker@1.service
systemctl start nginx.service

# 必须串行；systemctl 会等待每个 oneshot 完成。
systemctl start sigmaos-indexer.service
systemctl start sigmaos-scheduler.service
systemctl start sigmaos-health.service

# 手动任务成功后再启动 timers，避免首次激活时并发运行。
systemctl start \
  sigmaos-indexer.timer \
  sigmaos-scheduler.timer \
  sigmaos-maintenance.timer \
  sigmaos-backup-daily.timer \
  sigmaos-backup-weekly.timer \
  sigmaos-health.timer

printf 'deployment backup: %s\n' "$SIGMAOS_BACKUP_DIR"
exit
```

如果 `apt-get` 或任务恢复失败，不要删除 staging、新包和备份；先查看日志并按“回滚”处理。

## 部署验收

### 服务和 API

在目标机检查核心服务、timers 和一次性任务结果：

```bash
ssh "$SIGMAOS_TARGET" 'systemctl is-active nginx.service sigmaos-share-helper.service sigmaos-api.service sigmaos-worker@1.service'
ssh "$SIGMAOS_TARGET" 'systemctl is-active sigmaos-indexer.timer sigmaos-scheduler.timer sigmaos-maintenance.timer sigmaos-backup-daily.timer sigmaos-backup-weekly.timer sigmaos-health.timer'
ssh "$SIGMAOS_TARGET" 'systemctl show -p Result sigmaos-indexer.service sigmaos-scheduler.service sigmaos-health.service'
ssh "$SIGMAOS_TARGET" 'systemctl list-timers --all --no-pager sigmaos-indexer.timer sigmaos-scheduler.timer sigmaos-maintenance.timer sigmaos-backup-daily.timer sigmaos-backup-weekly.timer sigmaos-health.timer'
ssh "$SIGMAOS_TARGET" 'systemctl --failed --no-pager'
ssh "$SIGMAOS_TARGET" 'curl -fsS http://127.0.0.1:3010/health'
```

`systemctl show` 中三个任务的 `Result` 都应为 `success`。oneshot 完成后显示 `inactive (dead)` 是正常状态。

### Web 和缓存行为

从本地验证 LAN 入口：

```bash
curl -sS -D - -o /dev/null "http://$SIGMAOS_HOST/"
curl -sS -o /dev/null -w '%{http_code}\n' \
  "http://$SIGMAOS_HOST/assets/deployment-stale-check.js"
```

验收条件：

- `/` 返回 `200`，并带有 `Cache-Control: no-store`。
- 不存在或已从新版本删除的 `/assets/*.js` 返回 `404`，不能回退为 `index.html`。
- 使用浏览器无痕窗口打开 `http://192.168.11.91/`，页面应离开 Loading 并进入工作区。
- 浏览器开发者工具的 Network 面板中，不应有 HTML 被当作 JavaScript 返回，也不应持续出现失败的 API 请求。

验收通过后才可删除 staging：

```bash
case "$SIGMAOS_STAGE" in
  "/home/zhubby/sigmaos-stage-$SIGMAOS_RELEASE".*) ;;
  *) echo "refusing to remove unexpected staging path: $SIGMAOS_STAGE" >&2; exit 1 ;;
esac
ssh "$SIGMAOS_TARGET" "test -d '$SIGMAOS_STAGE' && rm -rf -- '$SIGMAOS_STAGE'"
```

保留最近几个 `/home/zhubby/sigmaos-deployments/<时间戳>/` 和对应的 `/var/backups/sigmaos/deploy-<时间戳>/`。清理时先用 `ls -ld` 确认具体目录，再逐个删除；不要对父目录使用通配符递归删除。

## 回滚

默认只回滚应用包，并保留当前配置和数据。先选择部署前的旧包，而不是刚部署的新包：

```bash
ssh "$SIGMAOS_TARGET" 'ls -1dt /home/zhubby/sigmaos-deployments/*'
```

登录目标机后设置明确路径并检查校验和：

```bash
export SIGMAOS_ROLLBACK_DEB='/home/zhubby/sigmaos-deployments/<旧时间戳>/sigmaos_<版本>_arm64.deb'
export SIGMAOS_PRE_DEPLOY_BACKUP='/var/backups/sigmaos/deploy-<新版本部署时间戳>'

test -f "$SIGMAOS_ROLLBACK_DEB"
test -d "$SIGMAOS_PRE_DEPLOY_BACKUP"
sha256sum -c "$(dirname "$SIGMAOS_ROLLBACK_DEB")/SHA256SUMS"
```

停止 timers 和服务，然后安装旧包：

```bash
sudo systemctl stop \
  sigmaos-indexer.timer sigmaos-scheduler.timer sigmaos-maintenance.timer \
  sigmaos-backup-daily.timer sigmaos-backup-weekly.timer sigmaos-health.timer
sudo systemctl stop \
  sigmaos-worker@1.service sigmaos-api.service sigmaos-share-helper.service \
  sigmaos-indexer.service sigmaos-scheduler.service sigmaos-maintenance.service \
  sigmaos-backup-daily.service sigmaos-backup-weekly.service sigmaos-health.service

sudo apt-get \
  -o Dpkg::Options::=--force-confold \
  install -y --no-install-recommends --allow-downgrades --reinstall \
  "$SIGMAOS_ROLLBACK_DEB"
```

通常不需要回滚数据。只有新版本执行了不向后兼容的数据迁移，或旧版本无法读取当前数据库时，才恢复部署前状态。以下操作会把当前状态移到一个可恢复目录，而不是直接删除：

```bash
export SIGMAOS_FAILED_STATE="/var/lib/sigmaos.failed-$(date +%Y%m%d-%H%M%S)"

sudo test -f "$SIGMAOS_PRE_DEPLOY_BACKUP/config.toml"
sudo test -f "$SIGMAOS_PRE_DEPLOY_BACKUP/sigmaos.sqlite"
sudo test -f "$SIGMAOS_PRE_DEPLOY_BACKUP/state-files.tar.gz"
sudo mv /var/lib/sigmaos "$SIGMAOS_FAILED_STATE"
sudo install -d -o sigmaos -g sigmaos -m 0750 /var/lib/sigmaos
sudo tar -xzf "$SIGMAOS_PRE_DEPLOY_BACKUP/state-files.tar.gz" -C /var/lib/sigmaos
sudo install -o sigmaos -g sigmaos -m 0600 \
  "$SIGMAOS_PRE_DEPLOY_BACKUP/sigmaos.sqlite" \
  /var/lib/sigmaos/sigmaos.sqlite
sudo install -o sigmaos -g sigmaos -m 0600 \
  "$SIGMAOS_PRE_DEPLOY_BACKUP/config.toml" \
  /etc/sigmaos/config.toml
sudo chown -R sigmaos:sigmaos /var/lib/sigmaos
```

最后按重新部署第 3 节中从 `systemctl daemon-reload` 开始的顺序恢复服务：先核心服务，再串行运行 indexer、scheduler、health，最后启动 timers。重新执行完整验收。

## 故障排查

### 页面始终停在 Loading

先确认服务器是否提供了新入口文件和正确的缓存策略：

```bash
curl -sS -D - -o /dev/null http://192.168.11.91/
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://192.168.11.91/assets/deployment-stale-check.js
ssh "$SIGMAOS_TARGET" 'sudo journalctl -u nginx.service -u sigmaos-api.service -n 200 --no-pager'
```

- `/` 没有 `Cache-Control: no-store`：运行的仍是旧 API/web 包，重新部署并确认归档包校验和。
- 不存在的 `/assets/*.js` 返回 `200` 或 `text/html`：旧静态资源回退逻辑仍在运行；确认 `sigmaos-api.service` 已重启并加载新包。
- API 返回正常但当前浏览器仍 Loading：用无痕窗口验证，再清除该站点缓存并刷新。
- Nginx 返回 `502`：检查 `systemctl status sigmaos-api.service` 和 API 日志。

### timer 显示 `active (elapsed)` 且没有 NEXT

长时间运行的机器首次激活 monotonic timer 时可能出现此状态。停止相关 timers，串行运行一次任务，再重新启动 timers：

```bash
sudo systemctl stop sigmaos-indexer.timer sigmaos-scheduler.timer sigmaos-health.timer
sudo systemctl start sigmaos-indexer.service
sudo systemctl start sigmaos-scheduler.service
sudo systemctl start sigmaos-health.service
sudo systemctl start sigmaos-indexer.timer sigmaos-scheduler.timer sigmaos-health.timer
```

### `SQLITE_BUSY: database is locked`

不要并发启动 indexer 和 scheduler。停止 timers 和两个任务，确认任务已退出后再串行运行：

```bash
sudo systemctl stop sigmaos-indexer.timer sigmaos-scheduler.timer
sudo systemctl stop sigmaos-indexer.service sigmaos-scheduler.service
sudo systemctl reset-failed sigmaos-indexer.service sigmaos-scheduler.service
sudo systemctl start sigmaos-indexer.service
sudo systemctl start sigmaos-scheduler.service
sudo systemctl start sigmaos-health.service
sudo systemctl start sigmaos-indexer.timer sigmaos-scheduler.timer
```

### 构建或服务失败

```bash
ssh "$SIGMAOS_TARGET" 'sudo journalctl -u sigmaos-api.service -u sigmaos-worker@1.service -u sigmaos-indexer.service -u sigmaos-scheduler.service -u sigmaos-health.service -n 300 --no-pager'
ssh "$SIGMAOS_TARGET" 'sudo systemctl status sigmaos-api.service sigmaos-worker@1.service --no-pager'
ssh "$SIGMAOS_TARGET" 'dpkg-query -W sigmaos nodejs; node --version; dpkg --print-architecture'
```

原生模块加载失败时，首先确认 Debian 包确实在该 CM5 staging 目录中构建，而不是从其他架构复制而来。
