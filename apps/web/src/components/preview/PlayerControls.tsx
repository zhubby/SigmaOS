import { useTranslation } from "react-i18next";
import { AlertTriangle, Pause, Play, RefreshCw, RotateCcw, RotateCw, Square, Volume2, VolumeX } from "lucide-react";
import type { PlayerCommand, PlayerStatus } from "../../api.js";

export function PlayerControls({
  status,
  onCommand,
  onRetry
}: {
  status: PlayerStatus;
  onCommand: (command: Exclude<PlayerCommand, { type: "play" }>) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (!status.fileName && status.state === "idle") {
    return null;
  }

  const duration = status.durationSeconds ?? 0;
  const position = Math.min(status.positionSeconds, duration || status.positionSeconds);
  const isPlaying = status.state === "playing";
  const isPaused = status.state === "paused";
  const isError = status.state === "error" || Boolean(status.error);
  const errorMessage = status.errorCode
    ? t(`preview.hdmiPlayer.errors.${status.errorCode}`, { defaultValue: status.error ?? t("preview.hdmiPlayer.playbackError") })
    : status.error ?? t("preview.hdmiPlayer.playbackError");

  return (
    <section className="hdmi-player-controls" aria-label={t("preview.hdmiPlayer.label")}>
      <div className="hdmi-player-heading">
        <div className="hdmi-player-title">
          <span className="eyebrow">{t("preview.hdmiPlayer.label")}</span>
          <strong title={status.relativePath ?? status.fileName ?? undefined}>{status.fileName ?? t("preview.hdmiPlayer.unknownFile")}</strong>
        </div>
        <span className={`hdmi-player-state${isError ? " is-error" : ""}`} role="status">
          {isError ? t("preview.hdmiPlayer.error") : t(`preview.hdmiPlayer.states.${status.state}`)}
        </span>
      </div>

      {isError ? (
        <div className="hdmi-player-error">
          <AlertTriangle aria-hidden="true" size={15} />
          <span>{errorMessage}</span>
          <button type="button" className="preview-tool-button" onClick={onRetry} title={t("preview.retry")} aria-label={t("preview.retry")}>
            <RefreshCw aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}

      <label className="hdmi-player-progress">
        <span className="sr-only">{t("preview.hdmiPlayer.seek")}</span>
        <input
          type="range"
          min="0"
          max={Math.max(duration, 1)}
          step="0.1"
          value={position}
          disabled={!status.durationSeconds || isError}
          onChange={(event) => onCommand({ type: "seek", seconds: Number(event.target.value) })}
        />
        <span>{formatTime(position)} / {formatTime(status.durationSeconds)}</span>
      </label>

      <div className="hdmi-player-actions">
        <button type="button" className="preview-tool-button" onClick={() => onCommand({ type: "seek", seconds: Math.max(0, status.positionSeconds - 10) })} disabled={isError} title={t("preview.hdmiPlayer.rewind")} aria-label={t("preview.hdmiPlayer.rewind")}>
          <RotateCcw aria-hidden="true" size={15} />
        </button>
        <button type="button" className="preview-tool-button is-primary" onClick={() => onCommand({ type: isPlaying ? "pause" : "resume" })} disabled={isError || (!isPlaying && !isPaused)} title={isPlaying ? t("preview.hdmiPlayer.pause") : t("preview.hdmiPlayer.resume")} aria-label={isPlaying ? t("preview.hdmiPlayer.pause") : t("preview.hdmiPlayer.resume")}>
          {isPlaying ? <Pause aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
        </button>
        <button type="button" className="preview-tool-button" onClick={() => onCommand({ type: "seek", seconds: status.positionSeconds + 10 })} disabled={isError} title={t("preview.hdmiPlayer.forward")} aria-label={t("preview.hdmiPlayer.forward")}>
          <RotateCw aria-hidden="true" size={15} />
        </button>
        <button type="button" className="preview-tool-button" onClick={() => onCommand({ type: "stop" })} disabled={status.state === "stopped" || status.state === "idle"} title={t("preview.hdmiPlayer.stop")} aria-label={t("preview.hdmiPlayer.stop")}>
          <Square aria-hidden="true" size={14} />
        </button>
        <label className="hdmi-player-volume">
          <span className="sr-only">{t("preview.hdmiPlayer.volume")}</span>
          {status.volume === 0 ? <VolumeX aria-hidden="true" size={15} /> : <Volume2 aria-hidden="true" size={15} />}
          <input type="range" min="0" max="100" step="1" value={status.volume} onChange={(event) => onCommand({ type: "set_volume", volume: Number(event.target.value) })} disabled={isError} />
        </label>
      </div>
    </section>
  );
}

function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  const hours = Math.floor(minutes / 60);
  const minutePart = hours > 0 ? minutes % 60 : minutes;
  return hours > 0
    ? `${hours}:${String(minutePart).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutePart}:${String(remaining).padStart(2, "0")}`;
}
