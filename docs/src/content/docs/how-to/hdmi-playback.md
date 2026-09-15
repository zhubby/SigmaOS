---
title: HDMI 本地播放
description: 在无桌面 Debian NAS 设备上使用 SigmaOS 将视频直接输出到 HDMI。
type: how-to
status: current
audience: [user, operator]
sourceOfTruth: [apps/player-helper/src/player.ts, apps/api/src/routes/player.ts, apps/web/src/components/preview/PlayerControls.tsx, packaging/systemd/sigmaos-player-helper.service]
sidebar:
  order: 2
---

## 启用播放器

通用安装默认不启用 HDMI 播放器。安装或重新安装时显式启用：

```bash
sudo SIGMAOS_ENABLE_PLAYER=1 \
  SIGMAOS_PLAYER_USER=sigmaos \
  SIGMAOS_NAS_ROOT_PATH=/srv/nas \
  ./packaging/scripts/install.sh
```

安装脚本会安装 `mpv` 和 `seatd`，生成 `sigmaos-player-helper.service` 的权限 drop-in，并启用播放器服务。播放器以非 root 用户运行，只读访问配置的 NAS root。

构建 appliance rootfs 时使用 `SIGMAOS_ENABLE_PLAYER=1`，镜像会启用播放器配置和 systemd 服务；默认值为 `0`。

如果只是修改配置，可以在 `/etc/sigmaos/config.toml` 中设置：

```toml
[player]
enabled = true
helper_socket_path = "/run/sigmaos/player-helper.sock"
video_output = "drm"
drm_connector = ""
audio_output = "alsa"
audio_device = ""
hwdec = "auto-safe"
user = "sigmaos"
```

修改后执行：

```bash
sudo /usr/lib/sigmaos/scripts/sigmaos-refresh-player.sh
sudo systemctl daemon-reload
sudo systemctl restart sigmaos-player-helper.service
```

## 使用 Web UI

在文件面板选择视频后，点击预览标题栏中的 HDMI 播放按钮。视频会由设备本机的 mpv 读取 NAS 文件并输出到 HDMI；浏览器中的视频预览仍然独立工作。

播放器条支持播放/暂停、停止、进度跳转、前进/后退 10 秒和音量。SigmaOS 首版只维护当前播放器状态，不保存播放队列或字幕选择。

## 检查设备能力

播放器使用 mpv 的 DRM/KMS 视频输出，不依赖 X11 或 Wayland。先检查设备和服务：

```bash
ls -l /dev/dri /dev/snd
systemctl is-active sigmaos-player-helper.service
journalctl -u sigmaos-player-helper.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3010/api/player/status
```

常见问题：

- `mpv is not installed`：安装 `mpv`，或用 `SIGMAOS_ENABLE_PLAYER=1` 重新运行安装脚本。
- `No DRM device found`：内核没有暴露 `/dev/dri/card*`，或设备没有加载 GPU/HDMI 驱动。
- `permission denied`：确认播放器用户属于存在的 `video`、`render` 和 `audio` 组，并重新运行 `sigmaos-refresh-player.sh`。
- 没有声音：检查 `/proc/asound`，然后把 `audio_device` 设置为对应的 ALSA HDMI 设备。

`hwdec = "auto-safe"` 会优先尝试可用硬件解码，驱动不支持时由 mpv 回退软件解码。具体硬件的解码能力仍需在目标板卡上验证。
